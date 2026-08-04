import { createReadStream } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';
import type { SFTPWrapper } from 'ssh2';

/**
 * Never worth sending, or actively dangerous to send.
 *
 * Build output (`dist`, `target`, `coverage`) is deliberately absent: whether it belongs
 * on the server is the project's decision, and the project already states it in its own
 * .gitignore. What is listed here is either useless remotely — platform-specific
 * binaries, caches — or a credential that must not leave the machine by accident.
 */
const DEFAULT_IGNORES = [
  '.git/',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '.venv/',
  'venv/',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '.env',
  '.env.*',
  '!.env.example',
  '!.env.sample',
  '*.pem',
  '*.key',
  'id_rsa*',
  '.ssh/',
];

/** Skips worth telling the user about, because a deploy may well need them. */
const NOTABLE = /^(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*)$/;

export interface PlannedFile {
  /** Relative to the project root, always with forward slashes. */
  relativePath: string;
  size: number;
}

export interface TransferPlan {
  files: PlannedFile[];
  totalBytes: number;
  /** Excluded paths the agent should mention — a missing .env breaks a deploy silently. */
  notableSkips: string[];
}

/**
 * Builds the exclusion filter. Only the project's root .gitignore is read: nested ones
 * would need per-directory rule stacks, and the default list plus the root file covers
 * what a deployment actually needs to leave behind.
 */
export function buildIgnoreFilter(gitignore?: string) {
  const matcher = ignore().add(DEFAULT_IGNORES);
  if (gitignore) matcher.add(gitignore);

  return (relativePath: string, isDirectory: boolean): boolean => {
    const posix = relativePath.split(path.sep).join('/');
    if (!posix || posix === '.') return false;
    // The trailing slash is what lets a `node_modules/` rule match the directory itself.
    return matcher.ignores(isDirectory ? `${posix}/` : posix);
  };
}

/** Walks the project and decides what goes, without touching the network. */
export async function planUpload(localRoot: string): Promise<TransferPlan> {
  const gitignore = await readFile(path.join(localRoot, '.gitignore'), 'utf-8').catch(() => undefined);
  const isIgnored = buildIgnoreFilter(gitignore);

  const files: PlannedFile[] = [];
  const notableSkips: string[] = [];
  let totalBytes = 0;

  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(localRoot, absolute);

      if (isIgnored(relative, entry.isDirectory())) {
        if (NOTABLE.test(entry.name)) notableSkips.push(relative.split(path.sep).join('/'));
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        files.push({ relativePath: relative.split(path.sep).join('/'), size: info.size });
        totalBytes += info.size;
      }
      // Symlinks are skipped: what they point at is meaningless on the other machine.
    }
  };

  await walk(localRoot);
  return { files, totalBytes, notableSkips };
}

export interface UploadProgress {
  done: number;
  total: number;
  path: string;
}

/**
 * How many files are in flight at once.
 *
 * Sequential upload spends nearly all its time on the per-file round trip — three hundred
 * files on a 100ms link is thirty seconds of pure latency. Eight at a time cuts that to a
 * few seconds without opening enough parallel work to upset a server.
 */
const CONCURRENCY = 8;

export async function uploadFiles(
  sftp: SFTPWrapper,
  localRoot: string,
  remoteRoot: string,
  files: PlannedFile[],
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Every directory is created once up front; doing it per file would serialise the
  // upload behind a stat/mkdir round trip each time.
  const directories = new Set<string>();
  for (const file of files) {
    const parent = path.posix.dirname(file.relativePath);
    let current = parent;
    while (current && current !== '.' && current !== '/') {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }

  for (const directory of [...directories].sort()) {
    await ensureDirectory(sftp, path.posix.join(remoteRoot, directory));
  }
  await ensureDirectory(sftp, remoteRoot);

  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (signal?.aborted) throw new Error('Upload cancelled');
      await putFile(
        sftp,
        path.join(localRoot, next.relativePath.split('/').join(path.sep)),
        path.posix.join(remoteRoot, next.relativePath),
      );
      done += 1;
      onProgress({ done, total: files.length, path: next.relativePath });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );
}

function putFile(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const source = createReadStream(local);
    const sink = sftp.createWriteStream(remote);
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      try { source.destroy(); } catch { /* transfer already torn down */ }
      try { sink.destroy(); } catch { /* transfer already torn down */ }
      reject(new Error(`${remote}: ${error.message}`));
    };

    source.on('error', fail);
    sink.on('error', fail);
    sink.on('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    source.pipe(sink);
  });
}

function ensureDirectory(sftp: SFTPWrapper, directory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(directory, (error) => {
      if (!error) return resolve();
      // Already there is the common case, not a failure worth surfacing.
      sftp.stat(directory, (statError) => (statError ? reject(error) : resolve()));
    });
  });
}
