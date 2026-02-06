import { Client, ClientChannel } from 'ssh2';
import { createServer, Server, Socket } from 'net';
import { SSHConnection, SystemStats, FileEntry, CpuCore } from '../../src/shared/types';
import { WebContents, dialog } from 'electron';
import { readFileSync } from 'fs';
import path from 'path';

export class SSHManager {
    private connections: Map<string, Client> = new Map();
    private streams: Map<string, ClientChannel> = new Map();
    private intervals: Map<string, NodeJS.Timeout> = new Map();
    private prevCpu: any = null;
    private prevNet: any = null;
    private tunnels: Map<string, { id: string, name?: string, type: 'L' | 'R', active: boolean, config: any, server?: Server }[]> = new Map();
    private profileIds: Map<string, string> = new Map();
    private store: any;

    constructor(store?: any) {
        this.store = store;
    }

    async connect(connection: SSHConnection, webContents: WebContents, sessionId: string, profileId?: string): Promise<void> {
        console.log(`[SSH] New connection request: session=${sessionId}, profile=${profileId}`);
        return new Promise((resolve, reject) => {
            const conn = new Client();
            let isReady = false;

            conn.on('ready', async () => {
                console.log(`[SSH] Connection ready: session=${sessionId}`);
                this.connections.set(sessionId, conn);
                if (profileId) {
                    this.profileIds.set(sessionId, profileId);
                    try {
                        await this.loadSavedTunnels(sessionId, profileId);
                    } catch (err) {
                        console.error(`[SSH] Failed to load tunnels for session ${sessionId}:`, err);
                    }
                }

                conn.shell((err, stream) => {
                    if (err) {
                        console.error(`[SSH] Shell error for session ${sessionId}:`, err);
                        this.cleanup(sessionId);
                        reject(err);
                        return;
                    }
                    isReady = true;
                    this.streams.set(sessionId, stream);

                    stream.on('close', () => {
                        console.log(`[SSH] Shell closed: session=${sessionId}`);
                        this.cleanup(sessionId);
                        webContents.send('ssh-status', { id: sessionId, status: 'disconnected' });
                    });

                    stream.on('data', (data: Buffer) => {
                        webContents.send('terminal-data', { id: sessionId, data: data.toString() });
                    });

                    resolve();
                });
            });

            conn.on('error', (err) => {
                console.error(`[SSH] Connection error: session=${sessionId}, err=`, err);
                if (!isReady) {
                    this.cleanup(sessionId);
                    reject(err);
                }
            });

            conn.on('close', () => {
                console.log(`[SSH] Connection closed: session=${sessionId}`);
                this.cleanup(sessionId);
            });

            (conn as any).on('tcpip', (accept: any, reject: any, info: any) => {
                const tunnels = this.tunnels.get(sessionId) || [];
                const tunnel = tunnels.find(t => t.type === 'R' && t.config.srcPort === info.destPort);

                if (tunnel) {
                    console.log(`[Tunnel] Incoming R-forwarded connection on port ${info.destPort}`);
                    const stream = accept();
                    const socket = new Socket();

                    socket.on('error', (err) => {
                        console.error(`[Tunnel] Socket error:`, err);
                        stream.end();
                    });
                    stream.on('close', () => socket.end());

                    socket.connect(tunnel.config.dstPort, tunnel.config.dstAddr || '127.0.0.1', () => {
                        stream.pipe(socket);
                        socket.pipe(stream);
                    });
                } else {
                    console.warn(`[Tunnel] Rejected incoming request on port ${info.destPort} (no tunnel found)`);
                    reject();
                }
            });

            try {
                const config: any = {
                    host: connection.host,
                    port: connection.port,
                    username: connection.username,
                    readyTimeout: 30000, // Increased timeout
                    keepaliveInterval: 10000,
                    keepaliveCountMax: 3,
                    compress: true,
                    algorithms: {
                        compress: ['zlib@openssh.com', 'zlib', 'none']
                    }
                };

                if (connection.authType === 'password') {
                    config.password = connection.password;
                } else if (connection.privateKeyPath) {
                    config.privateKey = readFileSync(connection.privateKeyPath);
                }

                conn.connect(config);
            } catch (err) {
                console.error(`[SSH] Initial connect sync error:`, err);
                reject(err);
            }
        });
    }

    cleanup(id: string) {
        if (!this.connections.has(id) && !this.streams.has(id)) return;

        console.log(`[SSH] Cleaning up resources for session: ${id}`);
        this.stopMonitoring(id);

        const stream = this.streams.get(id);
        if (stream) {
            try { stream.end(); } catch (e) { }
            this.streams.delete(id);
        }

        const conn = this.connections.get(id);
        if (conn) {
            try { conn.end(); } catch (e) { }
            this.connections.delete(id);
        }

        // Close local servers
        const tunnels = this.tunnels.get(id);
        if (tunnels) {
            tunnels.forEach(t => {
                if (t.type === 'L' && t.server) {
                    try { t.server.close(); } catch (e) { }
                }
            });
            this.tunnels.delete(id);
        }
        this.profileIds.delete(id);
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
                        resolve(data.toString());
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
    echo ">>>DISK"; df -B1 -x tmpfs -x devtmpfs;
    `;

        const interval = setInterval(() => {
            const conn = this.connections.get(id);
            if (!conn) return this.stopMonitoring(id);

            conn.exec(cmd, (err, stream) => {
                if (err) return;
                let output = '';
                stream.on('data', (data: any) => output += data.toString());
                stream.on('close', () => {
                    const stats = this.parseStats(output);
                    if (stats) webContents.send('stats-update', { id, stats });
                });
            });
        }, 2000);

        this.intervals.set(id, interval);
    }

    stopMonitoring(id: string) {
        const interval = this.intervals.get(id);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(id);
        }
    }

    async getProcesses(id: string): Promise<any[]> {
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');

        return new Promise((resolve, reject) => {
            // ps -ax -o pid,user,%cpu,%mem,comm,args --sort=-%cpu | head -n 50
            const cmd = 'ps -ax -o pid,user,%cpu,%mem,comm,args --sort=-%cpu | head -n 50';
            conn.exec(cmd, (err, stream) => {
                if (err) return reject(err);
                let output = '';
                stream.on('data', (data: any) => output += data.toString());
                stream.on('close', () => {
                    const lines = output.trim().split('\n');
                    // Skip header
                    const processes = lines.slice(1).map(line => {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length < 6) return null;

                        // args can be multiple parts, join them back
                        const args = parts.slice(5).join(' ');

                        return {
                            pid: parseInt(parts[0]),
                            user: parts[1],
                            cpu: parseFloat(parts[2]),
                            mem: parseFloat(parts[3]),
                            command: parts[4],
                            args: args
                        };
                    }).filter(p => p !== null);
                    resolve(processes);
                });
            });
        });
    }

    async killProcess(id: string, pid: number): Promise<void> {
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');

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
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');

        return new Promise((resolve, reject) => {
            // ID, Names, Image, Status, State
            const cmd = 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}"';
            conn.exec(cmd, (err, stream) => {
                if (err) return reject(err);
                let output = '';
                stream.on('data', (data: any) => output += data.toString());
                stream.on('close', () => {
                    try {
                        const containers = output.trim().split('\n').filter(line => line.trim()).map(line => {
                            const [id, names, image, status, state] = line.split('|');
                            return { id, name: names, image, status, state };
                        });
                        resolve(containers);
                    } catch (e) {
                        // docker might not be installed or permission denied
                        resolve([]);
                    }
                });
            });
        });
    }

    async dockerAction(id: string, containerId: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');

        return new Promise((resolve, reject) => {
            conn.exec(`docker ${action} ${containerId}`, (err, stream) => {
                if (err) return reject(err);
                stream.on('close', (code: any) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Docker action failed with code ${code}`));
                });
            });
        });
    }

    async addTunnel(id: string, type: 'L' | 'R', config: { srcAddr: string, srcPort: number, dstAddr: string, dstPort: number }, name?: string): Promise<string> {
        const conn = this.connections.get(id);
        if (!conn) throw new Error('Not connected');

        const tunnelId = Date.now().toString();
        const tunnels = this.tunnels.get(id) || [];
        const profileId = this.profileIds.get(id);

        const newTunnel = { id: tunnelId, name, type, active: true, config };

        // If profile exists, save to store
        if (profileId && this.store) {
            const saved = this.store.get(`tunnels_${profileId}`) || [];
            saved.push(newTunnel);
            this.store.set(`tunnels_${profileId}`, saved);
        }

        if (type === 'L') {
            // Local Forwarding: Local Port -> Remote Host:Port
            // We listen on Local Port (srcPort), and forward to Remote (dstAddr:dstPort) via SSH
            return new Promise((resolve, reject) => {
                const server = createServer((socket) => {
                    console.log(`[Tunnel] New connection on local port ${config.srcPort}`);
                    conn.forwardOut(config.srcAddr || '127.0.0.1', config.srcPort, config.dstAddr, config.dstPort, (err, stream) => {
                        if (err) {
                            console.error(`[Tunnel] Forwarding failed:`, err);
                            socket.end();
                            return;
                        }
                        console.log(`[Tunnel] Forwarding established: local:${config.srcPort} -> remote:${config.dstAddr}:${config.dstPort}`);
                        socket.pipe(stream);
                        stream.pipe(socket);
                        socket.on('close', () => console.log(`[Tunnel] Local connection closed`));
                    });
                });

                server.listen(config.srcPort, config.srcAddr || '127.0.0.1', () => {
                    tunnels.push({ id: tunnelId, name, type, active: true, config, server });
                    this.tunnels.set(id, tunnels);
                    resolve(tunnelId);
                });

                server.on('error', (err) => reject(err));
            });
        } else {
            // Remote Forwarding: Remote Port -> Local Host:Port
            // We ask SSH server to listen on Remote Port (srcPort), and forward to us.
            // When we receive connection, we connect to Local (dstAddr:dstPort).
            return new Promise((resolve, reject) => {
                conn.forwardIn(config.srcAddr || '0.0.0.0', config.srcPort, (err) => {
                    if (err) return reject(err);

                    // Note: We need to handle 'tcpip' event on connection for incoming forwarded connections
                    // But we might already have other tunnels. 
                    // Use a shared handler or check if already listening?
                    // ssh2 emits 'tcpip' for ALL forwarded connections.
                    // We need to ensure we have a listener.
                    // For simplicity, we assume one global listener per connection that routes based on port.
                    // But here we are just adding one.

                    // Actually, let's attach the listener if it's the first remote tunnel
                    // Or we can just attach it. ssh2 supports multiple listeners? No, usually one.
                    // But we can check if it's already listening.
                    // A better approach: The 'tcpip' handler should check against our active 'R' tunnels.

                    tunnels.push({ id: tunnelId, name, type, active: true, config });
                    this.tunnels.set(id, tunnels);
                    resolve(tunnelId);
                });
            });
        }
    }

    async toggleTunnel(id: string, tunnelId: string, active: boolean): Promise<void> {
        const tunnels = this.tunnels.get(id) || [];
        const tunnel = tunnels.find(t => t.id === tunnelId);
        const profileId = this.profileIds.get(id);
        const conn = this.connections.get(id);

        if (!tunnel) throw new Error('Tunnel not found');
        if (tunnel.active === active) return;

        if (active) {
            // Start the tunnel
            if (tunnel.type === 'L') {
                await new Promise<void>((resolve, reject) => {
                    const server = createServer((socket) => {
                        conn!.forwardOut(tunnel.config.srcAddr || '127.0.0.1', tunnel.config.srcPort, tunnel.config.dstAddr, tunnel.config.dstPort, (err, stream) => {
                            if (err) { socket.end(); return; }
                            socket.pipe(stream);
                            stream.pipe(socket);
                        });
                    });
                    server.listen(tunnel.config.srcPort, tunnel.config.srcAddr || '127.0.0.1', () => {
                        tunnel.server = server;
                        resolve();
                    });
                    server.on('error', (err) => reject(err));
                });
            } else {
                await new Promise<void>((resolve, reject) => {
                    conn!.forwardIn(tunnel.config.srcAddr || '0.0.0.0', tunnel.config.srcPort, (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
            }
        } else {
            // Stop the tunnel
            if (tunnel.type === 'L' && tunnel.server) {
                tunnel.server.close();
                tunnel.server = undefined;
            } else if (tunnel.type === 'R' && conn) {
                await new Promise<void>((resolve) => {
                    conn.unforwardIn(tunnel.config.srcAddr || '0.0.0.0', tunnel.config.srcPort, () => resolve());
                });
            }
        }

        tunnel.active = active;

        // Update store
        if (profileId && this.store) {
            const saved = this.store.get(`tunnels_${profileId}`) || [];
            const idx = saved.findIndex((s: any) => s.id === tunnelId);
            if (idx !== -1) {
                saved[idx].active = active;
                this.store.set(`tunnels_${profileId}`, saved);
            }
        }
    }

    async removeTunnel(id: string, tunnelId: string): Promise<void> {
        const tunnels = this.tunnels.get(id);
        if (!tunnels) return;

        const index = tunnels.findIndex(t => t.id === tunnelId);
        if (index === -1) return;

        const tunnel = tunnels[index];
        const conn = this.connections.get(id);

        if (tunnel.type === 'L' && tunnel.server) {
            tunnel.server.close();
        } else if (tunnel.type === 'R' && conn) {
            conn.unforwardIn(tunnel.config.srcAddr || '0.0.0.0', tunnel.config.srcPort, () => { });
        }

        tunnels.splice(index, 1);
        this.tunnels.set(id, tunnels);

        // Update store
        const profileId = this.profileIds.get(id);
        if (profileId && this.store) {
            const saved = this.store.get(`tunnels_${profileId}`) || [];
            const newSaved = saved.filter((s: any) => s.id !== tunnelId);
            this.store.set(`tunnels_${profileId}`, newSaved);
        }
    }

    async getTunnels(id: string): Promise<any[]> {
        return (this.tunnels.get(id) || []).map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
            active: t.active,
            config: t.config
        }));
    }

    private async loadSavedTunnels(connectionId: string, profileId: string) {
        if (!this.store) return;
        const saved = this.store.get(`tunnels_${profileId}`) || [];
        const tunnels: any[] = [];
        this.tunnels.set(connectionId, tunnels);

        const conn = this.connections.get(connectionId);
        if (!conn) return;

        for (const tConfig of saved) {
            const tunnel = { ...tConfig };
            tunnels.push(tunnel);

            if (tunnel.active) {
                try {
                    if (tunnel.type === 'L') {
                        const server = createServer((socket) => {
                            conn.forwardOut(tunnel.config.srcAddr || '127.0.0.1', tunnel.config.srcPort, tunnel.config.dstAddr, tunnel.config.dstPort, (err, stream) => {
                                if (err) { socket.end(); return; }
                                socket.pipe(stream);
                                stream.pipe(socket);
                            });
                        });
                        await new Promise<void>((resolve, reject) => {
                            server.listen(tunnel.config.srcPort, tunnel.config.srcAddr || '127.0.0.1', () => {
                                tunnel.server = server;
                                resolve();
                            });
                            server.on('error', (err) => reject(err));
                        });
                    } else {
                        await new Promise<void>((resolve, reject) => {
                            conn.forwardIn(tunnel.config.srcAddr || '0.0.0.0', tunnel.config.srcPort, (err) => {
                                if (err) return reject(err);
                                resolve();
                            });
                        });
                    }
                } catch (err) {
                    console.error(`Failed to auto-start tunnel ${tunnel.id}:`, err);
                    tunnel.active = false;
                }
            }
        }
    }

    private parseStats(output: string): SystemStats | null {
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

            const parseCpuLine = (line: string) => {
                const parts = line.split(/\s+/);
                if (parts.length < 5) return null;
                return {
                    user: parseInt(parts[1]),
                    nice: parseInt(parts[2]),
                    sys: parseInt(parts[3]),
                    idle: parseInt(parts[4])
                };
            };

            const currentTotalCpu = parseCpuLine(totalCpuLine);
            let totalUsage = 0;

            if (currentTotalCpu && this.prevCpu) {
                const prev = this.prevCpu.total;
                const curr = currentTotalCpu;
                const totalDiff = (curr.user + curr.nice + curr.sys + curr.idle) - (prev.user + prev.nice + prev.sys + prev.idle);
                const idleDiff = curr.idle - prev.idle;
                totalUsage = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0;
            }

            const cores: CpuCore[] = coreLines.map((line: string, index: number) => {
                const match = line.match(/^cpu(\d+)\s+/);
                const id = match ? parseInt(match[1]) : index;
                const coreStats = parseCpuLine(line);
                let usage = 0;
                if (coreStats) {
                    usage = totalUsage; // Placeholder
                }
                return { id, usage };
            });

            if (currentTotalCpu) {
                this.prevCpu = { total: currentTotalCpu };
            }

            // Network
            const netInfo = data['NET'] || '';
            const netLines = netInfo.split('\n').filter((l: string) => l.includes(':'));
            let totalRx = 0;
            let totalTx = 0;
            netLines.forEach((line: string) => {
                const parts = line.split(':')[1].trim().split(/\s+/);
                totalRx += parseInt(parts[0]);
                totalTx += parseInt(parts[8]);
            });

            const now = Date.now();
            let upSpeed = 0;
            let downSpeed = 0;

            if (this.prevNet) {
                const timeDiff = (now - this.prevNet.time) / 1000;
                if (timeDiff > 0) {
                    downSpeed = Math.round((totalRx - this.prevNet.rx) / timeDiff);
                    upSpeed = Math.round((totalTx - this.prevNet.tx) / timeDiff);
                }
            }
            this.prevNet = { time: now, rx: totalRx, tx: totalTx };

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
        } catch (e) {
            console.error(e);
            return null;
        }
    }
}
