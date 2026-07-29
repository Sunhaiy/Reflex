import { Client, type ClientChannel } from 'ssh2';

import type { SSHConnection, SystemStats, FileEntry, CpuCore } from '../../src/shared/types';
import type { WebContents } from 'electron';
import { readFileSync } from 'fs';

interface CpuTimes {
    total: number;
    idle: number;
}

interface CpuSnapshot {
    total: CpuTimes;
    cores: Map<number, CpuTimes>;
}

export class SSHManager {
    private connections: Map<string, Client> = new Map();
    private jumpConnections: Map<string, Client> = new Map();
    private streams: Map<string, ClientChannel> = new Map();
    private intervals: Map<string, NodeJS.Timeout> = new Map();
    private prevCpuBySession: Map<string, CpuSnapshot> = new Map();
    private prevNetBySession: Map<string, { time: number; rx: number; tx: number }> = new Map();

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
        // Store for auto-reconnect
        this.connectionConfigs.set(sessionId, connection);
        this.webContentsBySession.set(sessionId, webContents);
        this.emitStatus(sessionId, 'connecting', webContents);

        if (connection.jumpHost) {
            return this._connectViaJump(connection, webContents, sessionId);
        }
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

    private _buildConfig(connection: SSHConnection): any {
        const config: any = {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            readyTimeout: 30000,
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
        conn.shell((err, stream) => {
            if (err) { this.cleanup(sessionId); return reject(err); }
            this.streams.set(sessionId, stream);
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
            this.connections.set(sessionId, conn);
            conn.on('ready', () => {
                console.log(`[SSH] Connection ready: session=${sessionId}`);
                this._attachShell(conn, webContents, sessionId, resolve, reject);
            });
            conn.on('error', (err) => {
                console.error(`[SSH] Connection error for ${connection.host}:${connection.port} (auth=${connection.authType}): ${err.message}`);
                const currentConn = this.connections.get(sessionId);
                if (currentConn && currentConn !== conn) return;
                this.cleanup(sessionId);
                this.emitStatus(sessionId, 'disconnected', webContents);
                reject(err);
            });
            conn.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
                console.log(`[SSH] keyboard-interactive triggered for ${connection.host}, prompts=${JSON.stringify(prompts)}`);
                finish([connection.password || '']);
            });
            conn.on('close', () => {
                if (this.connections.get(sessionId) === conn) {
                    this.cleanup(sessionId);
                    this.emitStatus(sessionId, 'disconnected', webContents);
                }
            });
            try { conn.connect(this._buildConfig(connection)); } catch (err: any) {
                console.error(`[SSH] Connect threw:`, err);
                this.cleanup(sessionId);
                this.emitStatus(sessionId, 'disconnected', webContents);
                reject(err);
            }
        });
    }

    private _connectViaJump(connection: SSHConnection, webContents: WebContents, sessionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const jump = new Client();
            this.jumpConnections.set(sessionId, jump);
            let jumpConfig: any;
            try {
                jumpConfig = {
                    host: connection.jumpHost,
                    port: connection.jumpPort || 22,
                    username: connection.jumpUsername || connection.username,
                    readyTimeout: 15000,
                };
                if (connection.jumpPrivateKeyPath) {
                    jumpConfig.privateKey = readFileSync(connection.jumpPrivateKeyPath);
                } else {
                    jumpConfig.password = connection.jumpPassword || connection.password;
                }
            } catch (error) {
                this.cleanup(sessionId);
                reject(error);
                return;
            }

            jump.on('ready', () => {
                console.log(`[SSH] Jump host ready, forwarding to ${connection.host}`);
                jump.forwardOut('127.0.0.1', 0, connection.host, connection.port, (err, channel) => {
                    if (err) {
                        this.cleanup(sessionId);
                        this.emitStatus(sessionId, 'disconnected', webContents);
                        return reject(err);
                    }

                    const conn = new Client();
                    this.connections.set(sessionId, conn);
                    let directConfig: any;
                    try {
                        directConfig = this._buildConfig(connection);
                    } catch (error) {
                        this.cleanup(sessionId);
                        reject(error);
                        return;
                    }
                    directConfig.sock = channel; // tunnel through jump
                    delete directConfig.host; delete directConfig.port;

                    conn.on('ready', () => {
                        console.log(`[SSH] Tunneled connection ready: session=${sessionId}`);
                        this._attachShell(conn, webContents, sessionId, resolve, reject);
                    });
                    conn.on('error', (e) => {
                        const currentConn = this.connections.get(sessionId);
                        if (currentConn && currentConn !== conn) return;
                        this.cleanup(sessionId);
                        this.emitStatus(sessionId, 'disconnected', webContents);
                        reject(e);
                    });
                    conn.on('close', () => {
                        if (this.connections.get(sessionId) === conn) {
                            this.cleanup(sessionId);
                            this.emitStatus(sessionId, 'disconnected', webContents);
                        }
                    });
                    try {
                        conn.connect(directConfig);
                    } catch (error) {
                        this.cleanup(sessionId);
                        reject(error);
                    }
                });
            });
            jump.on('error', (err) => {
                if (this.jumpConnections.get(sessionId) !== jump) return;
                this.cleanup(sessionId);
                this.emitStatus(sessionId, 'disconnected', webContents);
                reject(err);
            });
            try {
                jump.connect(jumpConfig);
            } catch (error) {
                this.cleanup(sessionId);
                reject(error);
            }
        });
    }

    cleanup(id: string) {
        const hasResources = this.connections.has(id) || this.jumpConnections.has(id) || this.streams.has(id) || this.intervals.has(id);
        if (hasResources) console.log(`[SSH] Cleaning up resources for session: ${id}`);
        this.stopMonitoring(id);
        this.prevCpuBySession.delete(id);
        this.prevNetBySession.delete(id);

        const stream = this.streams.get(id);
        if (stream) {
            this.streams.delete(id);
            try { stream.end(); } catch (e) { }
        }

        const conn = this.connections.get(id);
        if (conn) {
            this.connections.delete(id);
            try { conn.end(); } catch (e) { }
        }

        const jump = this.jumpConnections.get(id);
        if (jump) {
            this.jumpConnections.delete(id);
            try { jump.end(); } catch (e) { }
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

    // SFTP Operations
    async sftpOperation(id: string, operation: (sftp: any) => Promise<any>): Promise<any> {
        const conn = this.connections.get(id);
        if (!conn) {
            console.error(`SFTP Operation failed: Connection ${id} not found`);
            throw new Error('Not connected');
        }

        console.log(`Starting SFTP Operation for ${id}...`);
        return new Promise((resolve, reject) => {
            conn.sftp(async (err, sftp) => {
                if (err) {
                    console.error('SFTP Subsystem error:', err);
                    return reject(err);
                }
                try {
                    const result = await operation(sftp);
                    console.log(`SFTP Operation for ${id} completed successfully.`);
                    sftp.end();
                    resolve(result);
                } catch (opErr) {
                    console.error('SFTP Operation internal error:', opErr);
                    sftp.end();
                    reject(opErr);
                }
            });
        });
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

    async uploadFile(id: string, localPath: string, remotePath: string): Promise<void> {
        return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (err: any) => {
                if (err) reject(err);
                else resolve(undefined);
            });
        }));
    }

    async downloadFile(id: string, remotePath: string, localPath: string): Promise<void> {
        return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
            sftp.fastGet(remotePath, localPath, (err: any) => {
                if (err) reject(err);
                else resolve(undefined);
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

    async readFile(id: string, remotePath: string): Promise<string> {
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
                        // Return base64 for image files so the renderer can create a data URL
                        const ext = remotePath.split('.').pop()?.toLowerCase() ?? '';
                        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif'].includes(ext);
                        resolve(isImage ? data.toString('base64') : data.toString('utf8'));
                    }
                });
            });
        }));
    }

    async writeFile(id: string, remotePath: string, content: string): Promise<void> {
        return this.sftpOperation(id, (sftp) => new Promise((resolve, reject) => {
            console.log(`Writing to ${remotePath}...`);
            // sftp.writeFile is more reliable for small updates/creation than raw streams
            sftp.writeFile(remotePath, content, (err: any) => {
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
    startMonitoring(id: string, webContents: WebContents) {
        if (this.intervals.has(id)) return;

        const cmd = `
    echo ">>>OS"; cat /etc/os-release; 
    echo ">>>UPTIME"; uptime -p; 
    echo ">>>CPU"; head -n 1 /proc/stat; cat /proc/stat | grep '^cpu[0-9]';
    echo ">>>CPU_INFO"; cat /proc/cpuinfo | grep -E "model name|cpu MHz" | head -2;
    echo ">>>MEM"; cat /proc/meminfo; 
    echo ">>>NET"; cat /proc/net/dev; 
    echo ">>>DISK"; df -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs;
    `;

        let pending = false; // prevent overlapping execs when network is slow

        const collect = () => {
            const conn = this.connections.get(id);
            if (!conn) return this.stopMonitoring(id);
            if (pending) return; // skip this tick if the previous one is still running
            pending = true;

            let stream: any;
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                try {
                    if (stream) {
                        stream.removeAllListeners('error');
                        stream.on('error', () => { }); // swallow post-destroy errors
                        stream.destroy();
                    }
                } catch (_) { }
                pending = false;
            }, 5000); // 5s max per collection cycle

            conn.exec(cmd, (err, s) => {
                if (err) {
                    console.error(`[Monitor] exec error for ${id}:`, err.message);
                    clearTimeout(timeout); pending = false; return;
                }
                stream = s;
                let output = '';
                stream.on('data', (data: any) => output += data.toString());
                stream.on('error', () => {
                    clearTimeout(timeout);
                    pending = false;
                });
                stream.on('close', () => {
                    clearTimeout(timeout);
                    pending = false;
                    if (timedOut) return;
                    const stats = this.parseStats(id, output);
                    if (stats && !webContents.isDestroyed()) {
                        webContents.send('stats-update', { id, stats });
                    }
                });
            });
        };

        const interval = setInterval(collect, 2000);
        this.intervals.set(id, interval);
        collect();
    }

    stopMonitoring(id: string) {
        const interval = this.intervals.get(id);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(id);
        }
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
            const data: any = {};
            parts.forEach(p => {
                const lines = p.trim().split('\n');
                const key = lines[0];
                data[key] = lines.slice(1).join('\n');
            });

            // OS
            const osInfo = data['OS'] || '';
            const prettyName = osInfo.match(/PRETTY_NAME="([^"]+)"/)?.[1] || 'Linux';
            const uptime = data['UPTIME'] || '';

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
            }).filter((d: any) => d !== null);

            return {
                os: {
                    distro: prettyName,
                    kernel: 'Linux',
                    uptime: uptime.replace('up ', ''),
                    hostname: 'Server'
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
