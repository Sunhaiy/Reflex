import { spawn } from 'child_process';

export interface LocalShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export interface LocalShellOptions {
  cwd: string;
  timeoutMs?: number;
  signal: AbortSignal;
  onOutput(chunk: string): void;
}

const MAX_CAPTURE_CHARS = 1024 * 1024;
const FORCE_KILL_DELAY_MS = 2_000;

/** Runs a non-interactive command on the computer hosting Reflex. */
export function runLocalShell(
  command: string,
  options: LocalShellOptions,
): Promise<LocalShellResult> {
  const windows = process.platform === 'win32';
  const executable = windows ? 'powershell.exe' : '/bin/sh';
  const args = windows
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
    : ['-lc', command];

  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new Error('Local command cancelled'));
      return;
    }

    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: process.env,
      detached: !windows,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const append = (current: string, chunk: string) => {
      const remaining = MAX_CAPTURE_CHARS - current.length;
      if (remaining <= 0) {
        truncated = true;
        return current;
      }
      if (chunk.length > remaining) truncated = true;
      return current + chunk.slice(0, remaining);
    };

    child.stdout.on('data', (data: Buffer | string) => {
      const chunk = data.toString();
      options.onOutput(chunk);
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (data: Buffer | string) => {
      const chunk = data.toString();
      options.onOutput(chunk);
      stderr = append(stderr, chunk);
    });

    let forceKillTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (windows) {
        if (!child.killed) child.kill();
        return;
      }

      const pid = child.pid;
      if (!pid) return;
      try {
        process.kill(-pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
        console.warn(`[LocalShell] Failed to terminate process group ${pid}:`, error);
        if (!child.killed) child.kill('SIGTERM');
      }
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              console.warn(`[LocalShell] Failed to kill process group ${pid}:`, error);
            }
          }
        }, FORCE_KILL_DELAY_MS);
        forceKillTimer.unref();
      }
    };
    const onAbort = () => stop();
    options.signal.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs ?? 120_000);

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal.removeEventListener('abort', onAbort);
    };

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (options.signal.aborted) {
        reject(new Error('Local command cancelled'));
        return;
      }
      resolve({ stdout, stderr, exitCode: code, timedOut, truncated });
    });
  });
}
