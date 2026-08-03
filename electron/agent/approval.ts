/**
 * What the agent is allowed to do, and what has to be asked first.
 *
 * This is a policy layer, not a sandbox. Anything that reaches `shell` runs with the
 * permissions of the SSH user, and a determined prompt injection can phrase a dangerous
 * command in a way no matcher catches. What this does buy is that the ordinary mistakes
 * — an over-broad `rm`, a stray `systemctl stop ssh` — stop and ask.
 */


import type { AgentMode } from '../../src/shared/agent';

export type { AgentMode };

export type Decision =
  | { verdict: 'allow' }
  | { verdict: 'deny'; reason: string }
  /**
   * `group` is what "always allow this kind" remembers. It is empty for the commands on
   * the always-confirm list — those are asked about every single time, and the UI should
   * not offer to stop asking.
   */
  | { verdict: 'ask'; reason: string; group: string };

/** Tools that only ever read; they never need asking about. */
const READ_ONLY_TOOLS = new Set(['read_file', 'list_local', 'read_local']);

/**
 * Commands that would end the session that is running them, destroy the disk, or lock
 * the user out. These ask in every mode, including auto — auto means "don't interrupt me
 * for routine work", not "don't interrupt me before pulling the floor out".
 *
 * `sshd` is on this list for a reason specific to this app: stopping it disconnects the
 * very channel the agent is working through, and nothing can undo that remotely.
 */
const ALWAYS_CONFIRM: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+\/(\s|$|\*)/, reason: 'recursive delete at the filesystem root' },
  { pattern: /\bmkfs(\.|\s)/, reason: 'formats a filesystem' },
  { pattern: /\bdd\b[^|]*\bof=\/dev\//, reason: 'writes directly to a block device' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/, reason: 'stops the machine' },
  { pattern: /\binit\s+[06]\b/, reason: 'stops the machine' },
  { pattern: /\bsystemctl\s+(stop|disable|mask)\s+\S*ssh/, reason: 'would disconnect this session for good' },
  { pattern: /\bservice\s+ssh\S*\s+stop\b/, reason: 'would disconnect this session for good' },
  { pattern: /\b(userdel|usermod|passwd)\b/, reason: 'changes user accounts' },
  { pattern: /\biptables\s+(-F|--flush)/, reason: 'flushes firewall rules and can lock you out' },
  { pattern: /\bufw\s+(disable|reset)\b/, reason: 'disables the firewall' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, reason: 'opens the whole filesystem' },
  { pattern: /:\(\)\s*\{.*\|.*&.*\}\s*;\s*:/, reason: 'fork bomb' },
];

/**
 * Read-only mode's allowlist. `true` means every use is safe; a set means only those
 * subcommands are — `git log` reads, `git push` does not.
 */
const READ_ONLY_COMMANDS: Record<string, true | Set<string>> = {
  ls: true, dir: true, cat: true, head: true, tail: true, file: true, stat: true,
  du: true, df: true, free: true, uptime: true, uname: true, hostname: true,
  whoami: true, id: true, pwd: true, env: true, printenv: true, which: true,
  type: true, ps: true, date: true, wc: true, grep: true, egrep: true, fgrep: true,
  find: true, sort: true, uniq: true, cut: true, tr: true, lsblk: true, lscpu: true,
  netstat: true, ss: true, ip: true, ifconfig: true, echo: true, basename: true,
  dirname: true, readlink: true, realpath: true, nproc: true, arch: true,
  systemctl: new Set(['status', 'show', 'is-active', 'is-enabled', 'list-units', 'list-unit-files', 'cat']),
  docker: new Set(['ps', 'images', 'logs', 'inspect', 'stats', 'version', 'info', 'top']),
  git: new Set(['log', 'status', 'diff', 'show', 'branch', 'remote', 'describe', 'rev-parse']),
  npm: new Set(['ls', 'list', 'view', 'outdated', 'config']),
  pip: new Set(['list', 'show', 'freeze']),
  node: new Set(['--version', '-v']),
  python: new Set(['--version', '-V']),
  python3: new Set(['--version', '-V']),
};

/**
 * Substitution and redirection can smuggle a write past a first-word allowlist, so in
 * read-only mode their presence is itself disqualifying.
 */
const READ_ONLY_FORBIDDEN = /\$\(|`|>>?\s*[^&\s]|\bsudo\b|\bsu\b/;

/** Splits on the operators that start a new command, so every segment can be checked. */
function segments(command: string): string[] {
  return command
    .split(/\|\||&&|;|\||\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * What "always allow this kind" remembers: the program being run, looking past `sudo` and
 * any leading `VAR=value` assignments so `sudo apt install` groups with `apt`.
 */
export function commandGroup(command: string): string {
  const words = segments(command)[0]?.split(/\s+/) ?? [];
  for (const word of words) {
    if (word === 'sudo' || word === 'command' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    return word.replace(/^.*\//, '') || 'command';
  }
  return 'command';
}

function isReadOnlyCommand(command: string): boolean {
  if (READ_ONLY_FORBIDDEN.test(command)) return false;

  return segments(command).every((segment) => {
    const words = segment.split(/\s+/).filter(Boolean);
    const program = words[0]?.replace(/^.*\//, '');
    if (!program) return false;

    const allowed = READ_ONLY_COMMANDS[program];
    if (allowed === true) return true;
    if (!allowed) return false;
    // A subcommand-gated program with no subcommand (`git`) only prints usage; harmless.
    return words.length < 2 || allowed.has(words[1]);
  });
}

export interface ApprovalRequest {
  tool: string;
  command?: string;
  /** Groups the user already said "always allow" to, for this run only. */
  allowedGroups: ReadonlySet<string>;
  mode: AgentMode;
}

export function decide({ tool, command, allowedGroups, mode }: ApprovalRequest): Decision {
  if (READ_ONLY_TOOLS.has(tool)) return { verdict: 'allow' };

  // Free mode is checked before everything, including the always-confirm list. That is
  // the whole of what it means: the user asked for no gate, so there is no gate.
  if (mode === 'free') return { verdict: 'allow' };

  if (command) {
    const dangerous = ALWAYS_CONFIRM.find((rule) => rule.pattern.test(command));
    if (dangerous) {
      return mode === 'readonly'
        ? { verdict: 'deny', reason: `read-only mode, and this ${dangerous.reason}` }
        : { verdict: 'ask', reason: dangerous.reason, group: '' };
    }
  }

  if (mode === 'readonly') {
    if (!command) return { verdict: 'deny', reason: 'read-only mode does not allow writing' };
    return isReadOnlyCommand(command)
      ? { verdict: 'allow' }
      : { verdict: 'deny', reason: 'read-only mode only allows commands that read' };
  }

  if (mode === 'auto') return { verdict: 'allow' };

  const group = command ? commandGroup(command) : tool;
  if (allowedGroups.has(group)) return { verdict: 'allow' };
  return { verdict: 'ask', reason: 'needs approval', group };
}
