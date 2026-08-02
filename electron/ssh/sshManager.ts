import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import { logger } from '../logger';

import type { ActivityLevel, ActivityLine, ActivityScope, SSHConnection, SystemStats, FileEntry, CpuCore } from '../../src/shared/types';
import { normalizeTimezone } from '../../src/shared/timezone';
import type { WebContents } from 'electron';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'fs';
import * as iconv from 'iconv-lite';

interface CpuTimes {
    total: number;
    idle: number;
}

interface CpuSnapshot {
    total: CpuTimes;
    cores: Map<number, CpuTimes>;
}

type TransferProgressCallback = (transferred: number, total: number) => void;

export class SSHManager {
    private connections: Map<string, Client> = new Map();
    private streams: Map<string, ClientChannel> = new Map();
    private sftpSessions: Map<string, Promise<SFTPWrapper>> = new Map();
    private intervals: Map<string, NodeJS.Timeout> = new Map();
    private prevCpuBySession: Map<string, CpuSnapshot> = new Map();
    private prevNetBySession: Map<string, { time: number; rx: number; tx: number }> = new Map();
    private monitorSectionsBySession: Map<string, Record<string, string>> = new Map();
    private monitorTokens: Map<string, number> = new Map();
    private monitorChannels: Map<string, ClientChannel> = new Map();
    private monitorBuffers: Map<string, string> = new Map();
    private monitorWaiters: Map<string, {
        sentinel: string;
        resolve: (output: string) => void;
        reject: (error: Error) => void;
    }> = new Map();
    private nextMonitorToken = 0;
    private nextMonitorSeq = 0;
    private nextActivityId = 0;

    // Stored so we can reconnect automatically
    private connectionConfigs: Map<string, SSHConnection> = new Map();
    private webContentsBySession: Map<string, WebContents> = new Map();

    private assertSafeIdentifier(value: string, label: string) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
            throw new Error(`Invalid ${label}`);
        }
    }

    private async execCommand(
        id: string,
        command: string,
        maxOutputBytes = 4 * 1024 * 1024,
    ): Promise<{ stdout: string; stderr: string }> {
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');

        return new Promise((resolve, reject) => {
            conn.exec(command, (error, stream) => {
                if (error) return reject(error);

                let stdout = '';
                let stderr = '';
                let capturedBytes = 0;
                let truncated = false;
                let settled = false;

                const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
                    const text = chunk.toString();
                    const remaining = maxOutputBytes - capturedBytes;
                    if (remaining <= 0) {
                        truncated = true;
                        return;
                    }
                    const slice = Buffer.from(text).subarray(0, remaining).toString();
                    capturedBytes += Buffer.byteLength(slice);
                    if (slice.length < text.length) truncated = true;
                    if (target === 'stdout') stdout += slice;
                    else stderr += slice;
                };

                stream.on('data', (chunk: Buffer) => append('stdout', chunk));
                stream.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
                stream.on('error', (streamError: Error) => {
                    if (settled) return;
                    settled = true;
                    reject(streamError);
                });
                stream.on('close', (code: number | null, signal?: string) => {
                    if (settled) return;
                    settled = true;
                    const suffix = truncated ? '\n[output truncated]' : '';
                    if (suffix) stdout += suffix;
                    if (signal || (typeof code === 'number' && code !== 0)) {
                        reject(new Error(stderr.trim() || stdout.trim() || `Command failed (${signal || code})`));
                        return;
                    }
                    resolve({ stdout, stderr });
                });
            });
        });
    }

    async connect(connection: SSHConnection, webContents: WebContents, sessionId: string): Promise<void> {
        console.log(`[SSH] New connection request: session=${sessionId}`);
        // A retry arrives on the same sessionId. If the previous attempt's socket is
        // still winding down, two sockets race to the same host — which is exactly what
        // a server enforcing MaxStartups aborts. Tear the old one down first.
        this.cleanup(sessionId);
        // Store for auto-reconnect
        this.connectionConfigs.set(sessionId, connection);
        this.webContentsBySession.set(sessionId, webContents);
        this.emitStatus(sessionId, 'connecting', webContents);

        return this._connectDirect(connection, webContents, sessionId);
    }

    /** Re-establish the SSH connection using the stored config. */
    async reconnect(sessionId: string): Promise<void> {
        const connection = this.connectionConfigs.get(sessionId);
        const webContents = this.webContentsBySession.get(sessionId);
        if (!connection || !webContents) {
            throw new Error(`No stored config for session ${sessionId}`);
        }
        console.log(`[SSH] Auto-reconnect attempt for session=${sessionId}`);
        this.cleanup(sessionId);
        await this.connect(connection, webContents, sessionId);
    }

    private emitStatus(sessionId: string, status: 'connecting' | 'connected' | 'disconnected', webContents?: WebContents) {
        const target = webContents || this.webContentsBySession.get(sessionId);
        if (!target || target.isDestroyed()) return;
        target.send('ssh-status', { id: sessionId, status });
    }

    /** Streams a real progress line to the renderer and mirrors it into the log file. */
    private emitActivity(
        sessionId: string,
        text: string,
        level: ActivityLevel = 'info',
        webContents?: WebContents,
        scope: ActivityScope = 'session',
    ) {
        const line: ActivityLine = { id: ++this.nextActivityId, text, level, at: Date.now() };
        if (level === 'error') logger.error(`[${scope} ${sessionId}] ${text}`);
        else logger.info(`[${scope} ${sessionId}] ${text}`);

        const target = webContents || this.webContentsBySession.get(sessionId);
        if (!target || target.isDestroyed()) return;
        target.send('ssh-activity', { id: sessionId, scope, line });
    }

    private _buildConfig(connection: SSHConnection): any {
        const config: any = {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            // 30s x 3 attempts left the user waiting a minute and a half before any
            // failure surfaced. A reachable host completes this phase in seconds.
            readyTimeout: 15000,
            keepaliveInterval: 10000,
            keepaliveCountMax: 3,
            // Interactive terminal traffic gains little from forced zlib, while
            // ssh2 can emit "Invalid Zlib instance" during compressed teardown.
            compress: false,
        };
        if (connection.authType === 'privateKey' && connection.privateKeyPath) {
            config.privateKey = readFileSync(connection.privateKeyPath);
            if (connection.passphrase) config.passphrase = connection.passphrase;
        } else {
            config.password = connection.password;
            config.tryKeyboard = true;
        }
        return config;
    }

    private _attachShell(conn: Client, webContents: WebContents, sessionId: string, resolve: () => void, reject: (error: Error) => void) {
        this.connections.set(sessionId, conn);
        this.emitActivity(sessionId, 'Requesting interactive shell...', 'info', webContents);
        conn.shell((err, stream) => {
            if (err) {
                this.emitActivity(sessionId, `Shell request failed: ${err.message}`, 'error', webContents);
                this.cleanup(sessionId);
                return reject(err);
            }
            this.streams.set(sessionId, stream);
            this.emitActivity(sessionId, 'Shell channel open — session ready.', 'ok', webContents);
            this.emitStatus(sessionId, 'connected', webContents);

            // 16ms batch buffer (~60 fps) to prevent IPC floods from high-frequency output
            let buf = '';
            let flushTimer: NodeJS.Timeout | null = null;

            const flushBuf = () => {
                if (buf && !webContents.isDestroyed()) {
                    webContents.send('terminal-data', { id: sessionId, data: buf });
                }
                buf = '';
                flushTimer = null;
            };

            stream.on('close', () => {
                const isCurrentStream = this.streams.get(sessionId) === stream;
                // Flush any remaining buffered output before disconnecting
                if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
                flushBuf();
                if (isCurrentStream) {
                    this.cleanup(sessionId);
                    this.emitStatus(sessionId, 'disconnected', webContents);
                }
            });
            stream.on('data', (data: Buffer) => {
                buf += data.toString('utf-8');
                if (!flushTimer) {
                    flushTimer = setTimeout(flushBuf, 16);
                }
            });
            resolve();
        });
    }

    private _connectDirect(connection: SSHConnection, webContents: WebContents, sessionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            const port = connection.port || 22;
            const username = connection.username || 'root';
            const authLabel = connection.authType === 'privateKey' ? 'publickey' : 'password';

            this.connections.set(sessionId, conn);
            this.emitActivity(sessionId, `$ ssh ${username}@${connection.host} -p ${port}`, 'cmd', webContents);
            this.emitActivity(sessionId, `Resolving and connecting to ${connection.host}:${port}...`, 'info', webContents);

            conn.on('handshake', (negotiated) => {
                this.emitActivity(sessionId, 'Transport handshake complete.', 'ok', webContents);
                this.emitActivity(sessionId, `kex: ${negotiated.kex}`, 'dim', webContents);
                this.emitActivity(sessionId, `host key: ${negotiated.serverHostKey}`, 'dim', webContents);
                this.emitActivity(sessionId, `cipher: ${negotiated.cs.cipher} / mac: ${negotiated.cs.mac || 'aead'}`, 'dim', webContents);
                this.emitActivity(sessionId, `Authenticating as ${username} (${authLabel})...`, 'info', webContents);
            });
            conn.on('greeting', (greeting) => {
                const text = greeting.trim();
                if (text) this.emitActivity(sessionId, text, 'dim', webContents);
            });
            conn.on('banner', (message) => {
                const text = message.trim();
                if (text) this.emitActivity(sessionId, text, 'dim', webContents);
            });
            conn.on('ready', () => {
                this.emitActivity(sessionId, `Authentication succeeded (${authLabel}).`, 'ok', webContents);
                this._attachShell(conn, webContents, sessionId, resolve, reject);
            });
            conn.on('error', (err) => {
                const currentConn = this.connections.get(sessionId);
                if (currentConn && currentConn !== conn) return;
                this.emitActivity(
                    sessionId,
                    `Connection to ${connection.host}:${port} failed (auth=${authLabel}): ${err.message}`,
                    'error',
                    webContents,
                );
                this.cleanup(sessionId);
                this.emitStatus(sessionId, 'disconnected', webContents);
                reject(err);
            });
            conn.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
                this.emitActivity(
                    sessionId,
                    `Server requested keyboard-interactive (${prompts.length} prompt${prompts.length === 1 ? '' : 's'}).`,
                    'info',
                    webContents,
                );
                finish([connection.password || '']);
            });
            conn.on('close', () => {
                if (this.connections.get(sessionId) === conn) {
                    this.cleanup(sessionId);
                    this.emitStatus(sessionId, 'disconnected', webContents);
                }
            });
            try { conn.connect(this._buildConfig(connection)); } catch (err: any) {
                this.emitActivity(sessionId, `Could not start connection: ${err?.message || err}`, 'error', webContents);
                this.cleanup(sessionId);
                this.emitStatus(sessionId, 'disconnected', webContents);
                reject(err);
            }
        });
    }

    cleanup(id: string) {
        const hasResources = this.connections.has(id) || this.streams.has(id) || this.intervals.has(id);
        if (hasResources) console.log(`[SSH] Cleaning up resources for session: ${id}`);
        this.stopMonitoring(id);
        this.prevCpuBySession.delete(id);
        this.prevNetBySession.delete(id);
        this.closeSftpSession(id);

        const stream = this.streams.get(id);
        if (stream) {
            this.streams.delete(id);
            // Best effort: the stream is being discarded either way.
            try { stream.end(); } catch { /* already closed */ }
        }

        const conn = this.connections.get(id);
        if (conn) {
            this.connections.delete(id);
            try { conn.end(); } catch { /* already closed */ }
            // end() negotiates a clean SSH disconnect and simply never completes on a
            // half-open socket, leaving the descriptor alive to collide with the next
            // attempt. Force it closed shortly after asking nicely.
            setTimeout(() => {
                try { conn.destroy(); } catch { /* already destroyed */ }
            }, 250);
        }

        // Note: do NOT clear connectionConfigs / webContentsBySession here —
        // they are needed for reconnect() after a drop.
    }

    disconnect(id: string) {
        this.cleanup(id);
        this.connectionConfigs.delete(id);
        this.webContentsBySession.delete(id);
    }

    write(id: string, data: string) {
        const stream = this.streams.get(id);
        if (stream) stream.write(data);
    }

    resize(id: string, cols: number, rows: number) {
        const stream = this.streams.get(id);
        if (stream) stream.setWindow(rows, cols, 0, 0);
    }

    /**
     * Opening an SFTP subsystem costs a channel open plus a version handshake — several
     * round trips. Doing that per operation made every directory listing feel slow on
     * high-latency links, so the session is opened once and reused until it drops.
     */
    private openSftpSession(id: string): Promise<SFTPWrapper> {
        const existing = this.sftpSessions.get(id);
        if (existing) return existing;

        const conn = this.connections.get(id);
        if (!conn) return Promise.reject(new Error('Not connected'));

        const pending = new Promise<SFTPWrapper>((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err) {
                    this.sftpSessions.delete(id);
                    logger.error(`[SFTP] Subsystem open failed for ${id}`, err);
                    return reject(err);
                }

                const drop = () => {
                    if (this.sftpSessions.get(id) === pending) this.sftpSessions.delete(id);
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

        this.sftpSessions.set(id, pending);
        return pending;
    }

    private closeSftpSession(id: string) {
        const pending = this.sftpSessions.get(id);
        if (!pending) return;
        this.sftpSessions.delete(id);
        void pending.then((sftp) => { try { sftp.end(); } catch { /* already gone */ } }).catch(() => undefined);
    }

    // SFTP Operations
    async sftpOperation(id: string, operation: (sftp: any) => Promise<any>): Promise<any> {
        try {
            const sftp = await this.openSftpSession(id);
            return await operation(sftp);
        } catch (error) {
            // A broken channel must not be reused; the next call re-opens it.
            this.closeSftpSession(id);
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
        const conn = this.connections.get(id);
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
    private closeMonitorChannel(id: string, error?: Error) {
        const waiter = this.monitorWaiters.get(id);
        if (waiter) {
            this.monitorWaiters.delete(id);
            waiter.reject(error || new Error('Monitor channel closed'));
        }
        this.monitorBuffers.delete(id);

        const channel = this.monitorChannels.get(id);
        if (!channel) return;
        this.monitorChannels.delete(id);
        try {
            channel.removeAllListeners();
            channel.on('error', () => { }); // swallow anything raised during teardown
            channel.destroy();
        } catch { /* the channel is being discarded; failures here change nothing */ }
    }

    private openMonitorChannel(id: string): Promise<ClientChannel> {
        const existing = this.monitorChannels.get(id);
        if (existing) return Promise.resolve(existing);

        const conn = this.connections.get(id);
        if (!conn) return Promise.reject(new Error('Not connected'));

        return new Promise((resolve, reject) => {
            // A bare `sh` with no PTY: nothing echoes what we write and there is no
            // prompt, so the channel carries only the output we asked for.
            conn.exec('/bin/sh', (error, channel) => {
                if (error) return reject(error);
                this.monitorChannels.set(id, channel);
                this.monitorBuffers.set(id, '');
                channel.on('data', (chunk: Buffer) => this.onMonitorData(id, chunk.toString()));
                channel.stderr.on('data', () => { /* command noise is not part of a sample */ });
                channel.on('close', () => this.closeMonitorChannel(id, new Error('Monitor channel closed')));
                channel.on('error', (channelError: Error) => this.closeMonitorChannel(id, channelError));
                resolve(channel);
            });
        });
    }

    private onMonitorData(id: string, chunk: string) {
        const buffer = (this.monitorBuffers.get(id) || '') + chunk;
        const waiter = this.monitorWaiters.get(id);
        if (!waiter) {
            this.monitorBuffers.set(id, buffer);
            return;
        }

        const marker = buffer.indexOf(waiter.sentinel);
        if (marker === -1) {
            this.monitorBuffers.set(id, buffer);
            return;
        }

        this.monitorWaiters.delete(id);
        this.monitorBuffers.set(id, '');
        waiter.resolve(buffer.slice(0, marker));
    }

    /**
     * Runs one batch on the session's long-lived shell channel. Opening a fresh channel
     * per sample cost an extra round trip every three seconds, which dominates the cost
     * on a high-latency link. The trailing sentinel echo is what frames one sample's
     * output from the next.
     */
    private async runOnMonitorChannel(id: string, command: string, timeoutMs: number): Promise<string> {
        const channel = await this.openMonitorChannel(id);
        const sentinel = `__RFX_SAMPLE_${++this.nextMonitorSeq}__`;

        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                // A half-read frame would corrupt the next sample, so the channel goes
                // with it rather than being reused in an unknown state.
                this.closeMonitorChannel(id, new Error(`Collection timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.monitorWaiters.set(id, {
                sentinel,
                resolve: (output) => { clearTimeout(timer); resolve(output); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });

            try {
                channel.write(`${command}\necho "${sentinel}"\n`);
            } catch (error: any) {
                this.closeMonitorChannel(id, error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    startMonitoring(id: string, webContents: WebContents) {
        if (this.intervals.has(id)) return;

        this.prevCpuBySession.delete(id);
        this.prevNetBySession.delete(id);
        this.monitorSectionsBySession.delete(id);

        const monitorToken = ++this.nextMonitorToken;
        this.monitorTokens.set(id, monitorToken);

        const staticCommand = `
    echo ">>>OS"; cat /etc/os-release;
    echo ">>>TZ"; (cat /etc/timezone 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##' || timedatectl show -p Timezone --value 2>/dev/null) | head -1;
    echo ">>>CPU_INFO"; grep -m 1 "model name" /proc/cpuinfo; grep -m 1 "cpu MHz" /proc/cpuinfo;
    `;
        const dynamicCommand = `
    echo ">>>CPU"; grep '^cpu' /proc/stat;
    echo ">>>MEM"; grep -E '^(MemTotal|MemAvailable|Cached|Buffers):' /proc/meminfo;
    echo ">>>NET"; cat /proc/net/dev;
    echo ">>>UPTIME"; uptime -p;
    `;
        // df walks every mount and is by far the slowest part of a cycle on a busy or
        // high-latency host. Everything above reads /proc and returns immediately, so
        // the panel can paint without waiting on this one.
        const slowCommand = `
    echo ">>>DISK"; df -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs;
    `;

        let pending = false; // prevent overlapping execs when network is slow
        let cycle = 0;

        const collect = () => {
            if (this.monitorTokens.get(id) !== monitorToken) return;
            const conn = this.connections.get(id);
            if (!conn) return this.stopMonitoring(id);
            if (pending) return; // skip this tick if the previous one is still running
            pending = true;

            const includeStatic = cycle === 0;
            // Never on the first cycle: disks ride the 700ms primer instead, so the first
            // reading reaches the panel a whole df sooner.
            const includeSlow = cycle === 1 || (cycle > 0 && cycle % 5 === 0);
            const firstCycle = cycle === 0;
            cycle += 1;
            const cmd = `${includeStatic ? staticCommand : ''}${dynamicCommand}${includeSlow ? slowCommand : ''}`;

            if (firstCycle) {
                this.emitActivity(id, 'Reading /etc/os-release, /proc/cpuinfo...', 'info', webContents, 'monitor');
                this.emitActivity(id, 'Reading /proc/stat, /proc/meminfo, /proc/net/dev, uptime...', 'info', webContents, 'monitor');
            }

            this.runOnMonitorChannel(id, cmd, 5000).then((output) => {
                pending = false;
                if (this.monitorTokens.get(id) !== monitorToken) return;
                if (webContents.isDestroyed()) {
                    this.stopMonitoring(id);
                    return;
                }

                const stats = this.parseStats(id, output);
                if (!stats) {
                    if (firstCycle) {
                        this.emitActivity(id, 'Sample received but could not be parsed.', 'error', webContents, 'monitor');
                    }
                    return;
                }

                if (firstCycle) {
                    this.emitActivity(id, `Detected ${stats.os.distro}, ${stats.cpu.cores.length} cores.`, 'ok', webContents, 'monitor');
                }
                webContents.send('stats-update', { id, stats });

                // CPU and network are deltas between two readings, so the first sample
                // can only report zero. Take a second one right away rather than leaving
                // the panel empty for a whole interval. A primer that fires after
                // stopMonitoring is harmless: the token check at the top discards it.
                if (firstCycle) setTimeout(collect, 700);
            }).catch((error: Error) => {
                pending = false;
                if (this.monitorTokens.get(id) !== monitorToken) return;
                this.emitActivity(id, `Sample failed: ${error.message}`, 'error', webContents, 'monitor');
            });
        };

        const interval = setInterval(collect, 3000);
        this.intervals.set(id, interval);
        collect();
    }

    stopMonitoring(id: string) {
        this.closeMonitorChannel(id);
        this.monitorTokens.delete(id);
        const interval = this.intervals.get(id);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(id);
        }
        this.prevCpuBySession.delete(id);
        this.prevNetBySession.delete(id);
        this.monitorSectionsBySession.delete(id);
    }

    async getProcesses(id: string): Promise<any[]> {
        const { stdout } = await this.execCommand(
            id,
            'ps -ax -o pid,user,%cpu,%mem,comm,args',
            2 * 1024 * 1024,
        );
        const lines = stdout.trim().split('\n');
        return lines.slice(1).map((line) => {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 6) return null;
            const pid = Number.parseInt(parts[0], 10);
            const cpu = Number.parseFloat(parts[2]);
            const mem = Number.parseFloat(parts[3]);
            if (!Number.isSafeInteger(pid) || !Number.isFinite(cpu) || !Number.isFinite(mem)) return null;
            return {
                pid,
                user: parts[1],
                cpu,
                mem,
                command: parts[4],
                args: parts.slice(5).join(' '),
            };
        }).filter((process) => process !== null);
    }

    async killProcess(id: string, pid: number): Promise<void> {
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process ID');

        return new Promise((resolve, reject) => {
            conn.exec(`kill -9 ${pid}`, (err, stream) => {
                if (err) return reject(err);
                stream.on('close', (code: any) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Process exited with code ${code}`));
                });
            });
        });
    }

    async getDockerContainers(id: string): Promise<any[]> {
        const command = 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}|{{.Label \\"com.docker.compose.project\\"}}"';
        const { stdout } = await this.execCommand(id, command, 2 * 1024 * 1024);
        return stdout.trim().split('\n').filter((line) => line.trim()).map((line) => {
            const parts = line.split('|');
            return {
                id: parts[0] || '',
                name: parts[1] || '',
                image: parts[2] || '',
                status: parts[3] || '',
                state: parts[4] || '',
                ports: parts[5] || '',
                composeProject: parts[6] || '',
            };
        });
    }

    async dockerAction(id: string, containerId: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove'): Promise<void> {
        this.assertSafeIdentifier(containerId, 'container ID');
        const allowedActions = new Set(['start', 'stop', 'restart', 'pause', 'unpause', 'remove']);
        if (!allowedActions.has(action)) throw new Error('Invalid Docker action');

        const cmd = action === 'remove' ? `docker rm -f ${containerId}` : `docker ${action} ${containerId}`;
        await this.execCommand(id, cmd);
    }

    async dockerLogs(id: string, containerId: string, lines: number = 200): Promise<string> {
        this.assertSafeIdentifier(containerId, 'container ID');
        const safeLines = Math.min(10_000, Math.max(1, Math.trunc(lines)));
        const { stdout, stderr } = await this.execCommand(
            id,
            `docker logs --tail ${safeLines} ${containerId}`,
        );
        return `${stdout}${stderr}`;
    }

    async dockerImages(id: string): Promise<any[]> {
        const { stdout } = await this.execCommand(
            id,
            'docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedSince}}"',
            2 * 1024 * 1024,
        );
        return stdout.trim().split('\n').filter((line) => line.trim()).map((line) => {
            const [imageId, repository, tag, size, created] = line.split('|');
            return { id: imageId, repository, tag, size, created };
        });
    }

    async dockerRemoveImage(id: string, imageId: string): Promise<string> {
        this.assertSafeIdentifier(imageId, 'image ID');
        const { stdout, stderr } = await this.execCommand(id, `docker rmi ${imageId}`);
        return `${stdout}${stderr}`;
    }

    async dockerPrune(id: string, type: 'system' | 'images' | 'volumes' | 'containers'): Promise<string> {
        const cmds: Record<string, string> = {
            system: 'docker system prune -af --volumes',
            images: 'docker image prune -af',
            volumes: 'docker volume prune -af',
            containers: 'docker container prune -f',
        };
        const command = cmds[type];
        if (!command) throw new Error('Invalid Docker prune type');
        const { stdout, stderr } = await this.execCommand(id, command);
        return `${stdout}${stderr}`;
    }

    async dockerDiskUsage(id: string): Promise<string> {
        const { stdout, stderr } = await this.execCommand(id, 'docker system df');
        return `${stdout}${stderr}`;
    }


    private parseStats(sessionId: string, output: string): SystemStats | null {
        try {
            const parts = output.split('>>>');
            const data: Record<string, string> = {
                ...(this.monitorSectionsBySession.get(sessionId) || {}),
            };
            parts.forEach(p => {
                const lines = p.trim().split('\n');
                const key = lines[0];
                if (!key) return;
                data[key] = lines.slice(1).join('\n');
            });
            this.monitorSectionsBySession.set(sessionId, data);

            // OS
            const osInfo = data['OS'] || '';
            const prettyName = osInfo.match(/PRETTY_NAME="([^"]+)"/)?.[1] || 'Linux';
            const uptime = data['UPTIME'] || '';
            const timezone = normalizeTimezone(data['TZ']);

            // CPU Info
            const cpuInfo = (data['CPU_INFO'] || '').split('\n');
            const cpuModel = cpuInfo.find((l: string) => l.includes('model name'))?.split(':')[1]?.trim() || 'Unknown CPU';
            const cpuSpeed = cpuInfo.find((l: string) => l.includes('cpu MHz'))?.split(':')[1]?.trim() || '';

            // Memory (KB -> GB)
            const memInfo = data['MEM'] || '';
            const memTotal = parseInt(memInfo.match(/MemTotal:\s+(\d+)\s+kB/)?.[1] || '0', 10);
            const memAvailable = parseInt(memInfo.match(/MemAvailable:\s+(\d+)\s+kB/)?.[1] || '0', 10);
            const memCached = parseInt(memInfo.match(/Cached:\s+(\d+)\s+kB/)?.[1] || '0', 10);
            const memBuffers = parseInt(memInfo.match(/Buffers:\s+(\d+)\s+kB/)?.[1] || '0', 10);
            const memUsed = memTotal - memAvailable;

            const toGB = (kb: number) => parseFloat((kb / 1024 / 1024).toFixed(2));

            // CPU Usage Calculation
            const cpuLines = (data['CPU'] || '').split('\n');
            const totalCpuLine = cpuLines[0]; // cpu  ...
            const coreLines = cpuLines.slice(1);

            const parseCpuLine = (line: string): CpuTimes | null => {
                const parts = line.split(/\s+/);
                if (parts.length < 5) return null;
                const values = parts.slice(1).map((value) => Number.parseInt(value, 10));
                if (values.some((value) => !Number.isFinite(value))) return null;
                return {
                    total: values.reduce((sum, value) => sum + value, 0),
                    // Linux reports iowait immediately after idle. Treat both as
                    // idle time so busy I/O does not appear as CPU execution.
                    idle: values[3] + (values[4] || 0),
                };
            };

            const currentTotalCpu = parseCpuLine(totalCpuLine);
            const previousCpu = this.prevCpuBySession.get(sessionId);
            let totalUsage = 0;

            const calculateCpuUsage = (curr: CpuTimes, prev?: CpuTimes) => {
                if (!prev) return 0;
                const totalDiff = curr.total - prev.total;
                const idleDiff = curr.idle - prev.idle;
                return totalDiff > 0
                    ? Math.min(100, Math.max(0, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)))
                    : 0;
            };

            if (currentTotalCpu) {
                totalUsage = calculateCpuUsage(currentTotalCpu, previousCpu?.total);
            }

            const currentCoreTimes = new Map<number, CpuTimes>();
            const cores: CpuCore[] = coreLines.map((line: string, index: number) => {
                const match = line.match(/^cpu(\d+)\s+/);
                const id = match ? parseInt(match[1]) : index;
                const coreStats = parseCpuLine(line);
                if (coreStats) currentCoreTimes.set(id, coreStats);
                const usage = coreStats ? calculateCpuUsage(coreStats, previousCpu?.cores.get(id)) : 0;
                return { id, usage };
            });

            if (currentTotalCpu) {
                this.prevCpuBySession.set(sessionId, { total: currentTotalCpu, cores: currentCoreTimes });
            }

            // Network
            const netInfo = data['NET'] || '';
            const netLines = netInfo.split('\n').filter((l: string) => l.includes(':'));
            let totalRx = 0;
            let totalTx = 0;
            netLines.forEach((line: string) => {
                try {
                    const parts = line.split(':')[1].trim().split(/\s+/);
                    if (parts.length > 1) totalRx += parseInt(parts[0]) || 0;
                    if (parts.length > 8) totalTx += parseInt(parts[8]) || 0;
                } catch (_) { /* skip malformed line */ }
            });

            const now = Date.now();
            let upSpeed = 0;
            let downSpeed = 0;

            const previousNet = this.prevNetBySession.get(sessionId);
            if (previousNet) {
                const timeDiff = (now - previousNet.time) / 1000;
                if (timeDiff > 0) {
                    downSpeed = Math.max(0, Math.round((totalRx - previousNet.rx) / timeDiff));
                    upSpeed = Math.max(0, Math.round((totalTx - previousNet.tx) / timeDiff));
                }
            }
            this.prevNetBySession.set(sessionId, { time: now, rx: totalRx, tx: totalTx });

            // Disk
            const diskInfo = data['DISK'] || '';
            const diskLines = diskInfo.trim().split('\n').slice(1); // Skip header
            const disks = diskLines.map((line: string) => {
                const parts = line.split(/\s+/);
                if (parts.length < 6) return null;
                // df -B1 output: Filesystem 1B-blocks Used Available Use% Mounted on
                const size = parseInt(parts[1]);
                const used = parseInt(parts[2]);
                const available = parseInt(parts[3]);

                return {
                    filesystem: parts[0],
                    size: parseFloat((size / 1024 / 1024 / 1024).toFixed(1)), // GB
                    used: parseFloat((used / 1024 / 1024 / 1024).toFixed(1)), // GB
                    available: parseFloat((available / 1024 / 1024 / 1024).toFixed(1)), // GB
                    usePercent: parseInt(parts[4].replace('%', '')),
                    mount: parts[5]
                };
            }).filter((disk): disk is SystemStats['disks'][number] => disk !== null);

            return {
                os: {
                    distro: prettyName,
                    kernel: 'Linux',
                    uptime: uptime.replace('up ', ''),
                    hostname: 'Server',
                    timezone
                },
                cpu: {
                    totalUsage,
                    cores: cores,
                    model: cpuModel,
                    speed: cpuSpeed ? `${parseFloat(cpuSpeed).toFixed(0)} MHz` : ''
                },
                memory: {
                    total: toGB(memTotal),
                    used: toGB(memUsed),
                    free: toGB(memAvailable),
                    cached: toGB(memCached),
                    buffers: toGB(memBuffers)
                },
                network: {
                    upSpeed,
                    downSpeed,
                    totalTx,
                    totalRx
                },
                disks: disks
            };
        } catch (e: any) {
            console.error('[Monitor] parseStats failed:', e?.message, e?.stack?.split('\n')[1]);
            return null;
        }
    }
}
