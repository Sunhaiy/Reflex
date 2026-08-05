import type { Client, SFTPWrapper } from 'ssh2';
import { logger } from '../logger';
import {
  planUpload,
  uploadFile,
  uploadFiles,
  type TransferPlan,
  type UploadProgress,
} from './transfer';

/** The agent needs the authenticated connection and nothing else from the session layer. */
export interface FilesHost {
  getConnection(sessionId: string): Client | undefined;
}

export interface ReadResult {
  content: string;
  /** 1-based line the content starts at, so the model can quote positions back. */
  startLine: number;
  totalLines: number;
  truncated: boolean;
}

/** Past this a file is a job for `sed -n` through the shell, not for the context window. */
const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const DEFAULT_LINE_LIMIT = 2000;
const BINARY_SNIFF_BYTES = 4096;

/**
 * The agent's own file access, on its own SFTP channel.
 *
 * Separate from the file browser's channel on purpose: an agent uploading a project would
 * otherwise stall the user's browsing behind it, since operations on one channel are
 * serialised.
 *
 * Reading and writing go over SFTP rather than through the shell because a heredoc is not
 * safe for content the agent did not author — quotes, `$`, backticks and CRLF all get
 * mangled on the way, and a corrupted config file is a failure that surfaces much later.
 */
export class AgentFiles {
  private session: Promise<SFTPWrapper> | null = null;

  constructor(
    private readonly host: FilesHost,
    private readonly sessionId: string,
  ) { }

  private open(): Promise<SFTPWrapper> {
    if (this.session) return this.session;

    const conn = this.host.getConnection(this.sessionId);
    if (!conn) return Promise.reject(new Error('Not connected'));

    const pending = new Promise<SFTPWrapper>((resolve, reject) => {
      conn.sftp((error, sftp) => {
        if (error) {
          this.session = null;
          logger.error(`[Agent] SFTP open failed for ${this.sessionId}`, error);
          return reject(error);
        }
        const drop = () => {
          if (this.session === pending) this.session = null;
        };
        sftp.on('close', drop);
        sftp.on('end', drop);
        sftp.on('error', drop);
        resolve(sftp);
      });
    });

    this.session = pending;
    return pending;
  }

  private async withSftp<T>(operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.open());
    } catch (error) {
      // A broken channel must not be reused; the next call re-opens it.
      this.dispose();
      throw error;
    }
  }

  async read(path: string, options: { offset?: number; limit?: number } = {}): Promise<ReadResult> {
    const raw = await this.withSftp((sftp) => new Promise<Buffer>((resolve, reject) => {
      sftp.stat(path, (statError, stats) => {
        if (statError) return reject(statError);
        if (stats.isDirectory()) return reject(new Error(`${path} is a directory`));

        const chunks: Buffer[] = [];
        let read = 0;
        const stream = sftp.createReadStream(path, { start: 0, end: MAX_READ_BYTES - 1 });
        stream.on('data', (chunk: Buffer | string) => {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          read += buffer.length;
          chunks.push(buffer);
        });
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks, read)));
      });
    }));

    // A NUL in the first pages means binary; letting it through would fill the context
    // window with mojibake and tell the model nothing.
    if (raw.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      throw new Error(`${path} looks like a binary file`);
    }

    const text = raw.toString('utf-8');
    const lines = text.split('\n');
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(1, options.limit ?? DEFAULT_LINE_LIMIT);
    const window = lines.slice(offset, offset + limit);

    return {
      content: window.join('\n'),
      startLine: offset + 1,
      totalLines: lines.length,
      truncated: raw.length >= MAX_READ_BYTES || offset + limit < lines.length,
    };
  }

  async write(path: string, content: string): Promise<void> {
    const data = Buffer.from(content, 'utf-8');
    if (data.length > MAX_WRITE_BYTES) {
      throw new Error(`Refusing to write ${data.length} bytes; keep it under ${MAX_WRITE_BYTES}`);
    }

    await this.withSftp(async (sftp) => {
      await mkdirp(sftp, parentOf(path));
      return new Promise<void>((resolve, reject) => {
        sftp.writeFile(path, data, (error) => (error ? reject(error) : resolve()));
      });
    });
  }

  /**
   * Replaces one exact occurrence.
   *
   * Requiring the match to be unique is the staleness check: if the file moved on since
   * the agent read it, `oldString` now matches zero times or several, and either way the
   * edit is refused rather than applied to the wrong place. That is also why this is a
   * tool rather than a `sed -i` the agent could have run through the shell.
   */
  async edit(path: string, oldString: string, newString: string): Promise<{ replacedAt: number }> {
    if (oldString === '') throw new Error('old_string must not be empty');
    if (oldString === newString) throw new Error('old_string and new_string are identical');

    const current = await this.readWhole(path);
    const first = current.indexOf(oldString);
    if (first === -1) {
      throw new Error(`old_string was not found in ${path}; re-read the file and try again`);
    }
    if (current.indexOf(oldString, first + 1) !== -1) {
      throw new Error(
        `old_string appears more than once in ${path}; include enough surrounding context to make it unique`,
      );
    }

    const next = current.slice(0, first) + newString + current.slice(first + oldString.length);
    await this.write(path, next);
    return { replacedAt: current.slice(0, first).split('\n').length };
  }

  /**
   * Pushes a whole project up. The channel stays owned here while the walking and the
   * exclusion rules live in transfer.ts, which keeps that logic testable without a socket.
   */
  async uploadDirectory(
    localRoot: string,
    remoteRoot: string,
    onProgress: (progress: UploadProgress) => void,
    options: { maxFiles?: number; signal?: AbortSignal } = {},
  ): Promise<TransferPlan> {
    const plan = await planUpload(localRoot);
    // Checked against the plan, before a single byte moves — refusing afterwards would
    // report a limit that had already been exceeded.
    if (options.maxFiles !== undefined && plan.files.length > options.maxFiles) {
      throw new Error(
        `${plan.files.length} files is more than one upload should carry; narrow the folder `
        + 'or add exclusions to .gitignore',
      );
    }

    await this.withSftp((sftp) =>
      uploadFiles(sftp, localRoot, remoteRoot, plan.files, onProgress, options.signal));
    return plan;
  }

  /** Uploads one local file, including archives that are intentionally not read as text. */
  async uploadFile(localPath: string, remotePath: string, signal?: AbortSignal): Promise<void> {
    await this.withSftp((sftp) => uploadFile(sftp, localPath, remotePath, signal));
  }

  private async readWhole(path: string): Promise<string> {
    const result = await this.read(path, { limit: Number.MAX_SAFE_INTEGER });
    if (result.truncated) {
      throw new Error(`${path} is too large to edit in place; use the shell instead`);
    }
    return result.content;
  }

  dispose() {
    const pending = this.session;
    this.session = null;
    if (!pending) return;
    void pending
      .then((sftp) => { try { sftp.end(); } catch { /* already gone */ } })
      .catch(() => undefined);
  }
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

/** Creates every missing segment. `mkdir` on an existing directory is not an error here. */
async function mkdirp(sftp: SFTPWrapper, directory: string): Promise<void> {
  if (directory === '/' || directory === '') return;

  const exists = await new Promise<boolean>((resolve) => {
    sftp.stat(directory, (error) => resolve(!error));
  });
  if (exists) return;

  await mkdirp(sftp, parentOf(directory));
  await new Promise<void>((resolve, reject) => {
    // A concurrent create is fine; only report a failure the directory does not explain.
    sftp.mkdir(directory, (error) => {
      if (!error) return resolve();
      sftp.stat(directory, (statError) => (statError ? reject(error) : resolve()));
    });
  });
}
