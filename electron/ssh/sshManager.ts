import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { logger } from '../logger';

import type { ActivityLevel, ActivityLine, ActivityScope, SSHConnection } from '../../src/shared/types';
import { CommandService } from './commandService';
import { MonitorService } from './monitorService';
import { SftpService, type TransferProgressCallback } from './sftpService';
import type { WebContents } from 'electron';
import { readFileSync } from 'fs';

export class SSHManager {
    private connections: Map<string, Client> = new Map();
    private streams: Map<string, ClientChannel> = new Map();
    private readonly commands = new CommandService({
        execCommand: (id, command, maxOutputBytes) => this.execCommand(id, command, maxOutputBytes),
        getConnection: (id) => this.connections.get(id),
    });

    private readonly monitor = new MonitorService({
        getConnection: (id) => this.connections.get(id),
        emitActivity: (id, text, level, webContents, scope) =>
            this.emitActivity(id, text, level, webContents, scope),
    });

    private readonly sftp = new SftpService({
        getConnection: (id) => this.connections.get(id),
    });
    private nextActivityId = 0;

    // Stored so we can reconnect automatically
    private connectionConfigs: Map<string, SSHConnection> = new Map();
    private webContentsBySession: Map<string, WebContents> = new Map();

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
        logger.info(`[SSH] New connection request: session=${sessionId}`);
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
        logger.info(`[SSH] Auto-reconnect attempt for session=${sessionId}`);
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

    private _buildConfig(connection: SSHConnection): ConnectConfig {
        const config: ConnectConfig & { tryKeyboard?: boolean } = {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            // 30s x 3 attempts left the user waiting a minute and a half before any
            // failure surfaced. A reachable host completes this phase in seconds.
            readyTimeout: 15000,
            keepaliveInterval: 10000,
            keepaliveCountMax: 3,
            // ssh2 reads compression from algorithms.compress; a top-level `compress`
            // was silently ignored, so this never took effect. Interactive terminal
            // traffic gains little from zlib, and ssh2 can emit "Invalid Zlib instance"
            // tearing a compressed session down, so offer only `none`.
            algorithms: { compress: ['none'] },
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

            // The file browser mounts with the session and lists a directory immediately.
            // Opening the SFTP subsystem now spends those round trips while the UI is
            // still settling instead of inside that first listing.
            this.sftp.prewarm(sessionId);

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
            try { conn.connect(this._buildConfig(connection)); } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                this.emitActivity(sessionId, `Could not start connection: ${reason}`, 'error', webContents);
                this.cleanup(sessionId);
                this.emitStatus(sessionId, 'disconnected', webContents);
                reject(err);
            }
        });
    }

    cleanup(id: string) {
        const hasResources = this.connections.has(id) || this.streams.has(id);
        if (hasResources) logger.info(`[SSH] Cleaning up resources for session: ${id}`);
        this.monitor.dispose(id);
        this.sftp.close(id);

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

    // --- Remote files -------------------------------------------------------
    // Thin pass-throughs so the IPC surface stays flat while the implementation lives
    // in SftpService.
    listFiles(id: string, remotePath: string) { return this.sftp.listFiles(id, remotePath); }
    uploadFile(id: string, localPath: string, remotePath: string, onProgress?: TransferProgressCallback) {
        return this.sftp.uploadFile(id, localPath, remotePath, onProgress);
    }
    downloadFile(id: string, remotePath: string, localPath: string, onProgress?: TransferProgressCallback) {
        return this.sftp.downloadFile(id, remotePath, localPath, onProgress);
    }
    resumeDownloadFile(id: string, remotePath: string, localPath: string, onProgress?: TransferProgressCallback) {
        return this.sftp.resumeDownloadFile(id, remotePath, localPath, onProgress);
    }
    resumeUploadFile(id: string, localPath: string, remotePath: string, onProgress?: TransferProgressCallback) {
        return this.sftp.resumeUploadFile(id, localPath, remotePath, onProgress);
    }
    deleteFile(id: string, remotePath: string) { return this.sftp.deleteFile(id, remotePath); }
    createFolder(id: string, remotePath: string) { return this.sftp.createFolder(id, remotePath); }
    renameFile(id: string, oldPath: string, newPath: string) { return this.sftp.renameFile(id, oldPath, newPath); }
    readFile(id: string, remotePath: string) { return this.sftp.readFile(id, remotePath); }
    writeFile(id: string, remotePath: string, content: string, encoding?: string) {
        return this.sftp.writeFile(id, remotePath, content, encoding);
    }

    // --- Monitoring ---------------------------------------------------------
    startMonitoring(id: string, webContents: WebContents) { this.monitor.startMonitoring(id, webContents); }
    stopMonitoring(id: string) { this.monitor.stopMonitoring(id); }

    // --- Processes and Docker -----------------------------------------------
    getProcesses(id: string) { return this.commands.getProcesses(id); }
    killProcess(id: string, pid: number) { return this.commands.killProcess(id, pid); }
    getDockerContainers(id: string) { return this.commands.getDockerContainers(id); }
    dockerAction(id: string, containerId: string, action: Parameters<CommandService['dockerAction']>[2]) {
        return this.commands.dockerAction(id, containerId, action);
    }
    dockerLogs(id: string, containerId: string, tail?: number) { return this.commands.dockerLogs(id, containerId, tail); }
    dockerImages(id: string) { return this.commands.dockerImages(id); }
    dockerRemoveImage(id: string, imageId: string) { return this.commands.dockerRemoveImage(id, imageId); }
    dockerPrune(id: string, target: Parameters<CommandService['dockerPrune']>[1]) {
        return this.commands.dockerPrune(id, target);
    }
    dockerDiskUsage(id: string) { return this.commands.dockerDiskUsage(id); }
}
