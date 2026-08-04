import { randomBytes } from 'crypto';
import type { Client, ClientChannel } from 'ssh2';
import { logger } from '../logger';

/** The agent needs the authenticated connection and nothing else from the session layer. */
export interface ShellHost {
  getConnection(sessionId: string): Client | undefined;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  /** Null when the command never reported one — it was killed or the channel died. */
  exitCode: number | null;
  timedOut: boolean;
  /** True when the middle of the output was elided to keep it in the context window. */
  truncated: boolean;
}

/**
 * Streamed live so a long build is watchable rather than a three-minute blank.
 * `chunk` retains ANSI for xterm; `plainChunk` is safe for the model and React text.
 */
export type ShellOutputListener = (
  chunk: string,
  stream: 'stdout' | 'stderr',
  plainChunk: string,
) => void;

export interface RunOptions {
  /** Runs in this directory without moving the persistent one. */
  cwd?: string;
  timeoutMs?: number;
  onOutput?: ShellOutputListener;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 900_000;
/** Batched at roughly one frame, matching how terminal output is forwarded. */
const STREAM_FLUSH_MS = 16;
/** Late stderr can trail the stdout sentinel by a hair; wait for it before resolving. */
const STDERR_DRAIN_MS = 30;

const HEAD_LINES = 100;
const TAIL_LINES = 200;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

/**
 * Initialises colour without sourcing a user's shell profile. Profiles can print text,
 * start prompt helpers or run interactive commands, all of which would corrupt command
 * framing. These probes only install aliases the remote utilities actually support.
 */
export function colourShellSetup(readyMarker: string): string {
  return [
    'export PS1= PS2= PS4= PROMPT_COMMAND=',
    'if command -v dircolors >/dev/null 2>&1; then eval "$(dircolors -b 2>/dev/null)" || true; fi',
    "if ls --color=auto -d . >/dev/null 2>&1; then alias ls='ls --color=auto'; alias ll='ls -alF'; alias la='ls -A'; fi",
    "if grep --help 2>&1 | grep -q -- '--color'; then alias grep='grep --color=auto'; fi",
    "if diff --help 2>&1 | grep -q -- '--color'; then alias diff='diff --color=auto'; fi",
    `echo ${readyMarker}`,
    '',
  ].join('\n');
}

/** Removes terminal styling without flattening the actual command output. */
export function stripTerminalFormatting(text: string): string {
  return text
    // OSC sequences include terminal titles and hyperlinks and end in BEL or ST.
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    // CSI and the remaining two-byte escape sequences.
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '');
}

/**
 * Keeps the two ends of a long output and drops the middle.
 *
 * A failed `npm install` is five thousand lines of which the model needs the invocation
 * at the top and the error at the bottom; feeding it the whole thing wastes the context
 * window and buries the part that matters.
 */
export function clampOutput(text: string): { text: string; truncated: boolean } {
  if (text.length > MAX_CAPTURE_BYTES) {
    const half = Math.floor(MAX_CAPTURE_BYTES / 2);
    text = `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
  }

  const lines = text.split('\n');
  if (lines.length <= HEAD_LINES + TAIL_LINES) return { text, truncated: false };

  const elided = lines.length - HEAD_LINES - TAIL_LINES;
  return {
    text: [
      ...lines.slice(0, HEAD_LINES),
      `… ${elided} lines elided …`,
      ...lines.slice(-TAIL_LINES),
    ].join('\n'),
    truncated: true,
  };
}

/**
 * Splits one command's output from the frame marker that terminates it.
 *
 * TCP does not respect our framing: a marker can be cut in half across two reads, and the
 * exit code that trails it can arrive a read later still. Returns the text that is safe
 * to show now, whatever must be carried into the next read, and — only once the marker
 * line is whole — the exit code it carried.
 */
export function consumeFrame(buffer: string, sentinel: string): {
  visible: string;
  rest: string;
  exitCode?: number | null;
} {
  const marker = buffer.indexOf(sentinel);
  if (marker === -1) {
    // Complete lines go out at once and only the unfinished tail is held back. Holding a
    // fixed-size window instead would keep a command that prints one line and then works
    // for a minute silent for that whole minute. A very long unbroken line is released
    // anyway, so a progress bar that never emits a newline still moves.
    const guard = sentinel.length + 16;
    let keep = buffer.lastIndexOf('\n') + 1;
    if (buffer.length - keep > guard) keep = buffer.length - guard;
    return { visible: buffer.slice(0, keep), rest: buffer.slice(keep) };
  }

  const after = buffer.slice(marker + sentinel.length);
  const newline = after.indexOf('\n');
  // The marker is here but its exit code is still in flight; wait for the whole line.
  if (newline === -1) return { visible: buffer.slice(0, marker), rest: buffer.slice(marker) };

  const code = Number.parseInt(after.slice(0, newline).replace(/^:/, '').trim(), 10);
  return {
    visible: buffer.slice(0, marker),
    rest: after.slice(newline + 1),
    exitCode: Number.isNaN(code) ? null : code,
  };
}

interface PendingCommand {
  sentinel: string;
  stdout: string;
  stderr: string;
  onOutput?: ShellOutputListener;
  /** Output waiting for the next flush, batched so one write is not one IPC message. */
  queued: string;
  flushTimer: NodeJS.Timeout | null;
  settle: (result: ShellResult) => void;
  fail: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * One long-lived `/bin/sh` per agent run.
 *
 * A fresh channel per command — which is what the session layer's `execCommand` does —
 * costs a round trip each time and, worse, has no memory: `cd /var/www` is forgotten by
 * the next call. A deployment is a sequence that builds on itself, so the shell is kept
 * open and each command is framed by a random sentinel that carries the exit code back.
 *
 * A quiet PTY makes programs use their normal terminal colours. Echo is disabled before
 * the persistent shell starts, so framing commands never leak into the output. ANSI is
 * retained for xterm and stripped from the separate model-facing capture.
 */
export class AgentShell {
  private channel: ClientChannel | null = null;
  private pending: PendingCommand | null = null;
  /** Per-instance and random, so command output cannot forge a frame boundary. */
  private readonly token = randomBytes(8).toString('hex');
  private sequence = 0;
  /** A shell is serial; commands queue behind one another rather than interleaving. */
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly host: ShellHost,
    private readonly sessionId: string,
  ) { }

  private openChannel(): Promise<ClientChannel> {
    if (this.channel) return Promise.resolve(this.channel);

    const conn = this.host.getConnection(this.sessionId);
    if (!conn) return Promise.reject(new Error('Not connected'));

    return new Promise((resolve, reject) => {
      const readyMarker = `__RFX_READY_${this.token}__`;
      conn.exec(
        'stty -echo 2>/dev/null || true; '
          + 'export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 CLICOLOR_FORCE=1 '
          + 'FORCE_COLOR=1 SYSTEMD_COLORS=1; unset NO_COLOR; exec /bin/sh -i',
        { pty: { term: 'xterm-256color', cols: 160, rows: 40 } },
        (error, channel) => {
          if (error) return reject(error);
          let buffer = '';
          let readyBuffer = '';
          let ready = false;

          channel.on('data', (data: Buffer) => {
            const text = data.toString('utf-8');
            if (!ready) {
              readyBuffer += text;
              const marker = readyBuffer.indexOf(readyMarker);
              if (marker === -1) return;
              const lineEnd = readyBuffer.indexOf('\n', marker + readyMarker.length);
              if (lineEnd === -1) return;
              ready = true;
              this.channel = channel;
              const afterReady = readyBuffer.slice(lineEnd + 1);
              readyBuffer = '';
              resolve(channel);
              if (afterReady) buffer = this.consumeStdout(afterReady);
              return;
            }
            buffer = this.consumeStdout(buffer + text);
          });

          channel.stderr.on('data', (data: Buffer) => {
            const text = data.toString('utf-8');
            const plain = stripTerminalFormatting(text);
            const pending = this.pending;
            if (!pending) return;
            pending.stderr += plain;
            // stderr is low-volume next to stdout, so it goes straight out unbatched.
            pending.onOutput?.(text, 'stderr', plain);
          });

          channel.on('close', () => {
            const loss = new Error('Shell channel closed');
            if (!ready) reject(loss);
            else this.handleChannelLoss(loss);
          });
          channel.on('error', (channelError: Error) => {
            if (!ready) reject(channelError);
            else this.handleChannelLoss(channelError);
          });

          try {
            // Defining aliases inside the persistent interactive shell makes them apply
            // to later Agent commands. The setup itself is hidden by stty -echo and all
            // pre-marker output is discarded by the readiness gate above.
            channel.write(colourShellSetup(readyMarker));
          } catch (writeError) {
            reject(writeError instanceof Error ? writeError : new Error(String(writeError)));
          }
        },
      );
    });
  }

  private consumeStdout(buffer: string): string {
    const pending = this.pending;
    // Output with nothing waiting on it belongs to a command that already settled.
    if (!pending) return '';

    const frame = consumeFrame(buffer, pending.sentinel);
    if (frame.visible) {
      pending.stdout += stripTerminalFormatting(frame.visible);
      this.queue(pending, frame.visible);
    }
    if (frame.exitCode !== undefined) this.finish(pending, frame.exitCode, false);
    return frame.rest;
  }

  private queue(pending: PendingCommand, chunk: string) {
    if (!pending.onOutput) return;
    pending.queued += chunk;
    if (!pending.flushTimer) {
      pending.flushTimer = setTimeout(() => this.flush(pending), STREAM_FLUSH_MS);
    }
  }

  private flush(pending: PendingCommand) {
    if (pending.flushTimer) {
      clearTimeout(pending.flushTimer);
      pending.flushTimer = null;
    }
    if (!pending.queued) return;
    const chunk = pending.queued;
    pending.queued = '';
    pending.onOutput?.(chunk, 'stdout', stripTerminalFormatting(chunk));
  }

  private settle(pending: PendingCommand, exitCode: number | null, timedOut: boolean) {
    // Flushed synchronously before the command ends, so a batch in flight cannot land
    // after the next command has started and be attributed to it.
    this.flush(pending);
    const stdout = clampOutput(pending.stdout);
    const stderr = clampOutput(pending.stderr);
    pending.settle({
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode,
      timedOut,
      truncated: stdout.truncated || stderr.truncated,
    });
  }

  private finish(pending: PendingCommand, exitCode: number | null, timedOut: boolean) {
    if (this.pending !== pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    // stderr is a separate stream and can land just after the stdout sentinel.
    setTimeout(() => this.settle(pending, exitCode, timedOut), STDERR_DRAIN_MS);
  }

  private handleChannelLoss(error: Error) {
    this.resetChannel();
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (pending.flushTimer) clearTimeout(pending.flushTimer);
    pending.fail(error);
  }

  /**
   * Runs one command and waits for it. A non-zero exit is a normal return value, not a
   * rejection — to an agent an exit code is evidence, and throwing it away as an
   * exception string is how a fixable failure becomes an opaque one.
   */
  run(command: string, options: RunOptions = {}): Promise<ShellResult> {
    const next = this.tail.then(() => this.runExclusive(command, options));
    // The queue must survive a failed command, or one rejection stalls every later call.
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async runExclusive(command: string, options: RunOptions): Promise<ShellResult> {
    if (this.disposed) throw new Error('Agent shell has been closed');

    const channel = await this.openChannel();
    const sentinel = `__RFX_${this.token}_${++this.sequence}__`;
    const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    // A subshell keeps `cwd` scoped to this one command while leaving a bare `cd` the
    // agent runs itself persistent, which is the behaviour a shell is chosen for.
    const body = options.cwd
      ? `( cd ${shellQuote(options.cwd)} && { ${command}\n} )`
      : command;

    return new Promise<ShellResult>((settle, fail) => {
      const pending: PendingCommand = {
        sentinel,
        stdout: '',
        stderr: '',
        onOutput: options.onOutput,
        queued: '',
        flushTimer: null,
        settle,
        fail,
        timer: setTimeout(() => {
          // Without a PTY there is no signal to send, so the channel goes. The remote
          // process may outlive it — the result says so, and the agent can go kill it.
          logger.error(`[Agent] Command timed out after ${timeoutMs}ms: ${command.slice(0, 120)}`);
          this.pending = null;
          this.resetChannel();
          this.settle(pending, null, true);
        }, timeoutMs),
      };

      this.pending = pending;
      try {
        channel.write(`${body}\n__rfx_ec=$?\necho "${sentinel}:$__rfx_ec"\n`);
      } catch (error) {
        this.pending = null;
        clearTimeout(pending.timer);
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private resetChannel() {
    const channel = this.channel;
    this.channel = null;
    if (!channel) return;
    try {
      channel.removeAllListeners();
      channel.on('error', () => { /* swallow anything raised while tearing down */ });
      channel.destroy();
    } catch { /* already gone */ }
  }

  /** Ends the run's shell. Any state the agent built up in it goes with it, by design. */
  dispose() {
    this.disposed = true;
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      if (pending.flushTimer) clearTimeout(pending.flushTimer);
      pending.fail(new Error('Agent shell closed'));
    }
    this.resetChannel();
  }
}

/** Single-quotes a path for `sh`, closing and reopening around any embedded quote. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
