import type { Client, SFTPWrapper } from 'ssh2';
import { logger } from '../logger';
import { createReadStream, createWriteStream, existsSync, statSync } from 'fs';
import * as iconv from 'iconv-lite';
import type { ActivityLevel, ActivityScope, FileEntry } from '../../src/shared/types';
import type { WebContents } from 'electron';

export type TransferProgressCallback = (transferred: number, total: number) => void;

/**
 * What the SFTP work needs from the session manager. Declaring it as an interface keeps
 * the dependency one-way: the service knows nothing about connection lifecycle,
 * monitoring or Docker, and the manager does not need to know how a resumed upload
 * works.
 */
export interface SftpHost {
  getConnection(id: string): Client | undefined;
  execCommand(id: string, command: string): Promise<{ stdout: string; stderr: string }>;
  emitActivity(
    sessionId: string,
    text: string,
    level?: ActivityLevel,
    webContents?: WebContents,
    scope?: ActivityScope,
  ): void;
}

function assertSafeIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

/** Remote file operations for every session, each with one pooled SFTP channel. */
export class SftpService {
  private sessions: Map<string, Promise<SFTPWrapper>> = new Map();

  constructor(private host: SftpHost) { }

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

  close(id: string) {
      const pending = this.sessions.get(id);
      if (!pending) return;
      this.sessions.delete(id);
      void pending.then((sftp) => { try { sftp.end(); } catch { /* already gone */ } }).catch(() => undefined);
  }

  // SFTP Operations
  async sftpOperation(id: string, operation: (sftp: any) => Promise<any>): Promise<any> {
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
      sftp.readdir(remotePath, (err: any, list: any[]) => {
          if (err) return reject(err);
          const files: FileEntry[] = list.map(item => ({
              name: item.filename,
              type: item.longname.startsWith('d') ? 'd' as const : '-' as const,
              size: item.attrs.size,
              date: new Date(item.attrs.mtime * 1000).toISOString()
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
      }, (err: any) => {
          if (err) reject(err);
          else resolve(undefined);
      });
      }));
  }

  async downloadFile(id: string, remotePath: string, localPath: string, onProgress?: TransferProgressCallback): Promise<void> {
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {
          step: (transferred: number, _chunk: number, total: number) => onProgress?.(transferred, total),
      }, (err: any) => {
          if (err) reject(err);
          else resolve(undefined);
      });
      }));
  }

  async resumeDownloadFile(id: string, remotePath: string, localPath: string, onProgress?: TransferProgressCallback): Promise<void> {
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.stat(remotePath, (statError: any, remoteStats: any) => {
          if (statError) return reject(statError);

          const total = Number(remoteStats?.size) || 0;
          let offset = 0;
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

      sftp.stat(remotePath, (error: any, stats: any) => {
          if (error && error.code !== 2) {
              reject(error);
              return;
          }
          begin(error ? 0 : Number(stats?.size) || 0);
      });
      }));
  }

  async deleteFile(id: string, remotePath: string): Promise<void> {
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      // Check if directory first
      sftp.stat(remotePath, (err: any, stats: any) => {
          if (err) return reject(err);
          if (stats.isDirectory()) {
              sftp.rmdir(remotePath, (err: any) => err ? reject(err) : resolve(undefined));
          } else {
              sftp.unlink(remotePath, (err: any) => err ? reject(err) : resolve(undefined));
          }
      });
      }));
  }

  async createFolder(id: string, remotePath: string): Promise<void> {
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err: any) => {
          if (err) {
              console.error(`sftp.mkdir failed for ${remotePath}:`, err);
              reject(err);
          } else {
              resolve(undefined);
          }
      });
      }));
  }

  async renameFile(id: string, oldPath: string, newPath: string): Promise<void> {
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err: any) => err ? reject(err) : resolve(undefined));
      }));
  }

  async readFile(id: string, remotePath: string): Promise<{ base64: string; size: number }> {
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      console.log(`Reading ${remotePath}...`);
      // Check size first to avoid crashing on huge files
      sftp.stat(remotePath, (err: any, stats: any) => {
          if (err) return reject(err);
          if (stats.size > 10 * 1024 * 1024) return reject(new Error('File too large (>10MB)'));

          sftp.readFile(remotePath, (err: any, data: Buffer) => {
              if (err) {
                  console.error(`sftp.readFile failed for ${remotePath}:`, err);
                  reject(err);
              } else {
                  resolve({ base64: data.toString('base64'), size: data.length });
              }
          });
      });
      }));
  }

  async writeFile(id: string, remotePath: string, content: string, encoding = 'utf-8'): Promise<void> {
      if (!iconv.encodingExists(encoding)) throw new Error(`Unsupported text encoding: ${encoding}`);
      return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
      console.log(`Writing to ${remotePath}...`);
      // sftp.writeFile is more reliable for small updates/creation than raw streams
      sftp.writeFile(remotePath, iconv.encode(content, encoding), (err: any) => {
          if (err) {
              console.error(`sftp.writeFile failed for ${remotePath}:`, err);
              reject(err);
          } else {
              resolve(undefined);
          }
      });
      }));
  }

  async getPwd(id: string): Promise<string> {
      const conn = this.host.getConnection(id);
      if (!conn) throw new Error('Not connected');
      return new Promise((resolve) => {
      conn.exec('pwd', (err, stream) => {
          if (err) return resolve('.');
          let data = '';
          stream.on('data', (chunk: any) => data += chunk.toString());
          stream.on('close', () => resolve(data.trim()));
      });
      });
  }


  // Monitoring
  /** Drops the sampling channel; the next collection opens a fresh one. */
}
