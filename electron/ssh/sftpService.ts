import type { Client, FileEntry as SftpDirEntry, SFTPWrapper } from 'ssh2';
import { logger } from '../logger';
import { createReadStream, createWriteStream, existsSync, statSync } from 'fs';
import * as iconv from 'iconv-lite';
import type { FileEntry } from '../../src/shared/types';

export type TransferProgressCallback = (transferred: number, total: number) => void;

/** Refusing anything larger keeps a stray `cat` of a disk image out of the renderer. */
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

/** ssh2 attaches an SFTP status code to its errors; 2 is "no such file". */
const SFTP_NO_SUCH_FILE = 2;
function sftpErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'number'
    ? (error as { code: number }).code
    : undefined;
}

/**
 * What the SFTP work needs from the session manager, and nothing more. Declaring it as
 * an interface keeps the dependency one-way: the service knows nothing about connection
 * lifecycle, monitoring or Docker, and the manager does not need to know how a resumed
 * upload works.
 */
export interface SftpHost {
  getConnection(id: string): Client | undefined;
}

/** Remote file operations for every session, each with one pooled SFTP channel. */
export class SftpService {
  private sessions: Map<string, Promise<SFTPWrapper>> = new Map();

  constructor(private host: SftpHost) { }

  /**
   * Opening an SFTP subsystem costs a channel open plus a version handshake — several
   * round trips. Doing that per operation made every directory listing feel slow on
   * high-latency links, so the session is opened once and reused until it drops.
   */
  private openSftpSession(id: string): Promise<SFTPWrapper> {
    const existing = this.sessions.get(id);
    if (existing) return existing;

    const conn = this.host.getConnection(id);
    if (!conn) return Promise.reject(new Error('Not connected'));

    const pending = new Promise<SFTPWrapper>((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          this.sessions.delete(id);
          logger.error(`[SFTP] Subsystem open failed for ${id}`, err);
          return reject(err);
        }

        const drop = () => {
          if (this.sessions.get(id) === pending) this.sessions.delete(id);
        };
        sftp.on('close', drop);
        sftp.on('end', drop);
        sftp.on('error', (sftpError: Error) => {
          logger.error(`[SFTP] Session error for ${id}`, sftpError);
          drop();
        });

        resolve(sftp);
      });
    });

    this.sessions.set(id, pending);
    return pending;
  }

  /**
   * Opens the channel ahead of the first real request. The file browser mounts as soon
   * as the shell is up, so without this its opening listing pays for the subsystem
   * handshake — several round trips that are free to spend while the UI is still
   * settling. A failure here is not reported: the next operation re-opens and surfaces
   * its own error.
   */
  prewarm(id: string) {
    void this.openSftpSession(id).catch(() => undefined);
  }

  close(id: string) {
    const pending = this.sessions.get(id);
    if (!pending) return;
    this.sessions.delete(id);
    void pending.then((sftp) => { try { sftp.end(); } catch { /* already gone */ } }).catch(() => undefined);
  }

  async sftpOperation<T>(id: string, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    try {
      const sftp = await this.openSftpSession(id);
      return await operation(sftp);
    } catch (error) {
      // A broken channel must not be reused; the next call re-opens it.
      this.close(id);
      logger.error(`[SFTP] Operation failed for ${id}`, error);
      throw error;
    }
  }

  async listFiles(id: string, remotePath: string): Promise<FileEntry[]> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list: SftpDirEntry[]) => {
        if (err) return reject(err);
        const files: FileEntry[] = list.map((item) => ({
          name: item.filename,
          type: item.longname.startsWith('d') ? 'd' as const : '-' as const,
          size: item.attrs.size,
          date: new Date(item.attrs.mtime * 1000).toISOString(),
        })).sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'd' ? -1 : 1;
        });
        resolve(files);
      });
    }));
  }

  async uploadFile(id: string, localPath: string, remotePath: string, onProgress?: TransferProgressCallback): Promise<void> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {
        step: (transferred: number, _chunk: number, total: number) => onProgress?.(transferred, total),
      }, (err) => {
        if (err) reject(err);
        else resolve(undefined);
      });
    }));
  }

  async downloadFile(id: string, remotePath: string, localPath: string, onProgress?: TransferProgressCallback): Promise<void> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {
        step: (transferred: number, _chunk: number, total: number) => onProgress?.(transferred, total),
      }, (err) => {
        if (err) reject(err);
        else resolve(undefined);
      });
    }));
  }

  async resumeDownloadFile(id: string, remotePath: string, localPath: string, onProgress?: TransferProgressCallback): Promise<void> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.stat(remotePath, (statError, remoteStats) => {
        if (statError) return reject(statError);

        const total = Number(remoteStats?.size) || 0;
        let offset: number;
        try {
          offset = existsSync(localPath) ? statSync(localPath).size : 0;
        } catch (error) {
          reject(error);
          return;
        }
        if (offset > total) return reject(new Error('Local partial file is larger than the remote file'));
        if (offset === total) {
          onProgress?.(total, total);
          resolve(undefined);
          return;
        }

        let reader;
        let writer;
        try {
          reader = sftp.createReadStream(remotePath, { start: offset });
          writer = createWriteStream(localPath, { flags: offset > 0 ? 'a' : 'w' });
        } catch (error) {
          reject(error);
          return;
        }
        let transferred = offset;
        let settled = false;

        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          try { reader.destroy(); } catch { /* transfer already torn down */ }
          try { writer.destroy(); } catch { /* transfer already torn down */ }
          reject(error);
        };

        reader.on('data', (chunk: string | Buffer) => {
          transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
          onProgress?.(transferred, total);
        });
        reader.on('error', fail);
        writer.on('error', fail);
        writer.on('finish', () => {
          if (settled) return;
          settled = true;
          onProgress?.(total, total);
          resolve(undefined);
        });
        reader.pipe(writer);
      });
    }));
  }

  async resumeUploadFile(id: string, localPath: string, remotePath: string, onProgress?: TransferProgressCallback): Promise<void> {
    const total = statSync(localPath).size;
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      const begin = (offset: number) => {
        if (offset > total) return reject(new Error('Remote partial file is larger than the local file'));
        if (offset === total) {
          onProgress?.(total, total);
          resolve(undefined);
          return;
        }

        let reader;
        let writer;
        try {
          reader = createReadStream(localPath, { start: offset });
          writer = sftp.createWriteStream(remotePath, { flags: offset > 0 ? 'a' : 'w' });
        } catch (error) {
          reject(error);
          return;
        }
        let transferred = offset;
        let settled = false;

        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          try { reader.destroy(); } catch { /* transfer already torn down */ }
          try { writer.destroy(); } catch { /* transfer already torn down */ }
          reject(error);
        };

        reader.on('data', (chunk: string | Buffer) => {
          transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
          onProgress?.(transferred, total);
        });
        reader.on('error', fail);
        writer.on('error', fail);
        writer.on('finish', () => {
          if (settled) return;
          settled = true;
          onProgress?.(total, total);
          resolve(undefined);
        });
        reader.pipe(writer);
      };

      sftp.stat(remotePath, (error, stats) => {
        if (error && sftpErrorCode(error) !== SFTP_NO_SUCH_FILE) {
          reject(error);
          return;
        }
        begin(error ? 0 : Number(stats?.size) || 0);
      });
    }));
  }

  async deleteFile(id: string, remotePath: string): Promise<void> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        if (stats.isDirectory()) {
          sftp.rmdir(remotePath, (rmError) => rmError ? reject(rmError) : resolve(undefined));
        } else {
          sftp.unlink(remotePath, (unlinkError) => unlinkError ? reject(unlinkError) : resolve(undefined));
        }
      });
    }));
  }

  async createFolder(id: string, remotePath: string): Promise<void> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) {
          logger.error(`[SFTP] mkdir failed for ${remotePath}`, err);
          reject(err);
        } else {
          resolve(undefined);
        }
      });
    }));
  }

  async renameFile(id: string, oldPath: string, newPath: string): Promise<void> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => err ? reject(err) : resolve(undefined));
    }));
  }

  /**
   * Returns the raw bytes rather than base64. The payload crosses the IPC boundary by
   * structured clone, which carries a Uint8Array natively — base64 inflated every
   * preview by a third and cost an encode here plus a decode in the renderer.
   */
  async readFile(id: string, remotePath: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; size: number }> {
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      // Checked before reading so a huge file is never pulled into memory at all.
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        if (stats.size > MAX_PREVIEW_BYTES) return reject(new Error('File too large (>10MB)'));

        sftp.readFile(remotePath, (readError, data) => {
          if (readError) {
            logger.error(`[SFTP] readFile failed for ${remotePath}`, readError);
            reject(readError);
          } else {
            resolve({ bytes: new Uint8Array(data), size: data.length });
          }
        });
      });
    }));
  }

  async writeFile(id: string, remotePath: string, content: string, encoding = 'utf-8'): Promise<void> {
    if (!iconv.encodingExists(encoding)) throw new Error(`Unsupported text encoding: ${encoding}`);
    return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      // sftp.writeFile is more reliable for small updates/creation than raw streams.
      sftp.writeFile(remotePath, iconv.encode(content, encoding), (err) => {
        if (err) {
          logger.error(`[SFTP] writeFile failed for ${remotePath}`, err);
          reject(err);
        } else {
          resolve(undefined);
        }
      });
    }));
  }
}
