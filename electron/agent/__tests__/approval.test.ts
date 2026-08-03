import { describe, expect, it } from 'vitest';
import { commandGroup, decide, type AgentMode } from '../approval';

const NOTHING_ALLOWED = new Set<string>();

function verdict(command: string, mode: AgentMode, allowed = NOTHING_ALLOWED) {
  return decide({ tool: 'shell', command, mode, allowedGroups: allowed }).verdict;
}

describe('read-only mode', () => {
  it('allows commands that only read', () => {
    expect(verdict('ls -la /var/www', 'readonly')).toBe('allow');
    expect(verdict('df -h', 'readonly')).toBe('allow');
    expect(verdict('cat /etc/os-release', 'readonly')).toBe('allow');
  });

  it('allows a pipeline when every stage reads', () => {
    expect(verdict('ps aux | grep nginx', 'readonly')).toBe('allow');
  });

  it('rejects a read command with a write chained onto it', () => {
    // The whole reason segments are checked individually rather than just the first word.
    expect(verdict('ls; rm -rf /tmp/build', 'readonly')).toBe('deny');
    expect(verdict('cat x && npm install', 'readonly')).toBe('deny');
  });

  it('rejects command substitution and output redirection', () => {
    // Either one can smuggle a write past a first-word allowlist.
    expect(verdict('cat $(find / -name id_rsa)', 'readonly')).toBe('deny');
    expect(verdict('echo pwned > /etc/motd', 'readonly')).toBe('deny');
    expect(verdict('ls `whoami`', 'readonly')).toBe('deny');
  });

  it('still allows redirecting stderr into stdout', () => {
    expect(verdict('cat /etc/shadow 2>&1', 'readonly')).toBe('allow');
  });

  it('rejects sudo outright', () => {
    expect(verdict('sudo ls /root', 'readonly')).toBe('deny');
  });

  it('separates a program’s reading subcommands from its writing ones', () => {
    expect(verdict('git log --oneline', 'readonly')).toBe('allow');
    expect(verdict('git push origin main', 'readonly')).toBe('deny');
    expect(verdict('systemctl status nginx', 'readonly')).toBe('allow');
    expect(verdict('systemctl restart nginx', 'readonly')).toBe('deny');
    expect(verdict('docker ps -a', 'readonly')).toBe('allow');
    expect(verdict('docker rm -f web', 'readonly')).toBe('deny');
  });

  it('rejects writing tools regardless of any command', () => {
    const decision = decide({ tool: 'write_file', mode: 'readonly', allowedGroups: NOTHING_ALLOWED });
    expect(decision.verdict).toBe('deny');
  });
});

describe('ask mode', () => {
  it('asks before a command that changes anything', () => {
    const decision = decide({
      tool: 'shell', command: 'npm install', mode: 'ask', allowedGroups: NOTHING_ALLOWED,
    });
    expect(decision).toEqual({ verdict: 'ask', reason: 'needs approval', group: 'npm' });
  });

  it('stops asking once that kind has been approved', () => {
    expect(verdict('npm run build', 'ask', new Set(['npm']))).toBe('allow');
  });

  it('does not let approving one program approve another', () => {
    expect(verdict('apt install nginx', 'ask', new Set(['npm']))).toBe('ask');
  });

  it('never asks about reading a file', () => {
    const decision = decide({ tool: 'read_file', mode: 'ask', allowedGroups: NOTHING_ALLOWED });
    expect(decision.verdict).toBe('allow');
  });
});

describe('auto mode', () => {
  it('runs ordinary work without interrupting', () => {
    expect(verdict('npm install && npm run build', 'auto')).toBe('allow');
    expect(verdict('systemctl restart myapp', 'auto')).toBe('allow');
  });
});

describe('free mode', () => {
  it('runs anything, including what every other mode stops for', () => {
    // This is the whole point of the mode, and the reason it is worth a test: a change
    // that quietly reinstated the always-confirm list here would look like a safety fix
    // and would actually be a broken promise.
    expect(verdict('rm -rf /', 'free')).toBe('allow');
    expect(verdict('systemctl stop sshd', 'free')).toBe('allow');
    expect(verdict('mkfs.ext4 /dev/sda1', 'free')).toBe('allow');
    expect(verdict('shutdown -h now', 'free')).toBe('allow');
  });

  it('needs no group to have been approved first', () => {
    expect(verdict('apt install nginx', 'free', NOTHING_ALLOWED)).toBe('allow');
  });

  it('allows the writing tools too', () => {
    const decision = decide({ tool: 'write_file', mode: 'free', allowedGroups: NOTHING_ALLOWED });
    expect(decision.verdict).toBe('allow');
  });
});

describe('always-confirm list', () => {
  const dangerous = [
    ['rm -rf /', 'recursive delete at the filesystem root'],
    ['rm -rf /*', 'recursive delete at the filesystem root'],
    ['rm -fr / ', 'recursive delete at the filesystem root'],
    ['mkfs.ext4 /dev/sda1', 'formats a filesystem'],
    ['dd if=/dev/zero of=/dev/sda', 'writes directly to a block device'],
    ['shutdown -h now', 'stops the machine'],
    ['systemctl stop sshd', 'would disconnect this session for good'],
    ['systemctl disable ssh', 'would disconnect this session for good'],
    ['iptables -F', 'flushes firewall rules and can lock you out'],
    ['userdel deploy', 'changes user accounts'],
  ] as const;

  it.each(dangerous)('asks about %s even in auto mode', (command) => {
    expect(verdict(command, 'auto')).toBe('ask');
  });

  it('asks again every time, with no group to remember', () => {
    // Approving `systemctl` for a restart must not pre-approve stopping sshd.
    const decision = decide({
      tool: 'shell',
      command: 'systemctl stop sshd',
      mode: 'auto',
      allowedGroups: new Set(['systemctl']),
    });
    expect(decision).toEqual({
      verdict: 'ask',
      reason: 'would disconnect this session for good',
      group: '',
    });
  });

  it('denies rather than asks in read-only mode', () => {
    expect(verdict('rm -rf /', 'readonly')).toBe('deny');
  });

  it('leaves an ordinary delete alone', () => {
    expect(verdict('rm -rf /tmp/build-cache', 'auto')).toBe('allow');
    expect(verdict('rm -rf node_modules', 'auto')).toBe('allow');
  });
});

describe('commandGroup', () => {
  it('uses the program name', () => {
    expect(commandGroup('npm install express')).toBe('npm');
  });

  it('looks past sudo so it groups with the program being run', () => {
    expect(commandGroup('sudo apt install nginx')).toBe('apt');
  });

  it('looks past leading environment assignments', () => {
    expect(commandGroup('NODE_ENV=production npm run build')).toBe('npm');
    expect(commandGroup('DEBIAN_FRONTEND=noninteractive sudo apt install -y git')).toBe('apt');
  });

  it('strips the directory from an absolute path', () => {
    expect(commandGroup('/usr/bin/docker compose up -d')).toBe('docker');
  });

  it('groups by the first command in a chain', () => {
    expect(commandGroup('npm ci && npm run build')).toBe('npm');
  });
});
