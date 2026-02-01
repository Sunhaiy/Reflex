import { Client } from 'ssh2';
import { readFileSync } from 'fs';
export class SSHManager {
    constructor() {
        Object.defineProperty(this, "connections", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "streams", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "intervals", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "prevCpu", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    // ... (existing connect, write, resize, disconnect methods - keep them)
    // Since I am overwriting the file, I must include ALL code.
    // Connect to SSH
    async connect(connection, webContents) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                this.connections.set(connection.id, conn);
                // Open shell immediately upon connection
                conn.shell((err, stream) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    this.streams.set(connection.id, stream);
                    stream.on('close', () => {
                        this.streams.delete(connection.id);
                        this.connections.delete(connection.id);
                        this.stopMonitoring(connection.id);
                        webContents.send('ssh-status', { id: connection.id, status: 'disconnected' });
                    });
                    stream.on('data', (data) => {
                        webContents.send('terminal-data', { id: connection.id, data: data.toString() });
                    });
                });
                resolve();
            });
            conn.on('error', (err) => {
                reject(err);
            });
            conn.on('close', () => {
                this.connections.delete(connection.id);
                this.streams.delete(connection.id);
                this.stopMonitoring(connection.id);
                webContents.send('ssh-status', { id: connection.id, status: 'disconnected' });
            });
            try {
                const config = {
                    host: connection.host,
                    port: connection.port,
                    username: connection.username,
                };
                if (connection.authType === 'password') {
                    config.password = connection.password;
                }
                else if (connection.privateKeyPath) {
                    config.privateKey = readFileSync(connection.privateKeyPath);
                }
                conn.connect(config);
            }
            catch (err) {
                reject(err);
            }
        });
    }
    // Write data to the shell stream
    write(id, data) {
        const stream = this.streams.get(id);
        if (stream) {
            stream.write(data);
        }
    }
    // Resize the terminal
    resize(id, cols, rows) {
        const stream = this.streams.get(id);
        if (stream) {
            stream.setWindow(rows, cols, 0, 0);
        }
    }
    // Disconnect
    disconnect(id) {
        const conn = this.connections.get(id);
        if (conn) {
            conn.end();
        }
    }
    // Get active connection client (for SFTP usage later)
    getClient(id) {
        return this.connections.get(id);
    }
    startMonitoring(id, webContents) {
        if (this.intervals.has(id))
            return;
        const interval = setInterval(() => {
            const conn = this.connections.get(id);
            if (!conn) {
                this.stopMonitoring(id);
                return;
            }
            // Execute command to get Mem and CPU info
            // /proc/meminfo for memory
            // /proc/stat for CPU
            conn.exec('cat /proc/meminfo; echo "CPU_SEP"; head -n 1 /proc/stat', (err, stream) => {
                if (err)
                    return;
                let output = '';
                stream.on('data', (data) => output += data.toString());
                stream.on('close', () => {
                    const stats = this.parseStats(output);
                    if (stats) {
                        webContents.send('stats-update', { id, stats });
                    }
                });
            });
        }, 2000);
        this.intervals.set(id, interval);
    }
    stopMonitoring(id) {
        const interval = this.intervals.get(id);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(id);
        }
        this.prevCpu = null;
    }
    parseStats(output) {
        try {
            const [memPart, cpuPart] = output.split('CPU_SEP');
            if (!memPart || !cpuPart)
                return null;
            // Parse Memory
            const memTotalMatch = memPart.match(/MemTotal:\s+(\d+)\s+kB/);
            const memAvailableMatch = memPart.match(/MemAvailable:\s+(\d+)\s+kB/);
            let memory = { used: 0, total: 0, percentage: 0 };
            if (memTotalMatch && memAvailableMatch) {
                const total = parseInt(memTotalMatch[1], 10);
                const available = parseInt(memAvailableMatch[1], 10);
                const used = total - available;
                memory = {
                    used: Math.round(used / 1024), // MB
                    total: Math.round(total / 1024), // MB
                    percentage: Math.round((used / total) * 100)
                };
            }
            // Parse CPU
            // cpu  user nice system idle iowait irq softirq steal guest guest_nice
            const cpuMatch = cpuPart.match(/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
            let cpuUsage = 0;
            if (cpuMatch) {
                const currentCpu = {
                    user: parseInt(cpuMatch[1], 10),
                    nice: parseInt(cpuMatch[2], 10),
                    system: parseInt(cpuMatch[3], 10),
                    idle: parseInt(cpuMatch[4], 10),
                    iowait: parseInt(cpuMatch[5], 10),
                    irq: parseInt(cpuMatch[6], 10),
                    softirq: parseInt(cpuMatch[7], 10),
                    steal: parseInt(cpuMatch[8], 10)
                };
                if (this.prevCpu) {
                    const prevTotal = this.prevCpu.user + this.prevCpu.nice + this.prevCpu.system + this.prevCpu.idle + this.prevCpu.iowait + this.prevCpu.irq + this.prevCpu.softirq + this.prevCpu.steal;
                    const currTotal = currentCpu.user + currentCpu.nice + currentCpu.system + currentCpu.idle + currentCpu.iowait + currentCpu.irq + currentCpu.softirq + currentCpu.steal;
                    const prevIdle = this.prevCpu.idle + this.prevCpu.iowait;
                    const currIdle = currentCpu.idle + currentCpu.iowait;
                    const totalDiff = currTotal - prevTotal;
                    const idleDiff = currIdle - prevIdle;
                    if (totalDiff > 0) {
                        cpuUsage = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
                    }
                    else {
                        cpuUsage = 0;
                    }
                }
                this.prevCpu = currentCpu;
            }
            return { cpu: cpuUsage, memory };
        }
        catch (e) {
            console.error('Error parsing stats', e);
            return null;
        }
    }
    // Get current working directory
    async getPwd(id) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.exec('pwd', (err, stream) => {
                if (err)
                    return reject(err);
                let output = '';
                stream.on('data', (data) => output += data.toString());
                stream.on('close', () => {
                    resolve(output.trim());
                });
            });
        });
    }
    // Get Extended System Info
    async getSystemInfo(id) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve) => {
            // Run commands independently and sequentially to ensure stability
            const info = { os: 'N/A', cpu: {}, network: {} };
            // Helper to run command with timeout
            const runCmd = (cmd) => {
                return new Promise((res) => {
                    conn.exec(cmd, (err, stream) => {
                        if (err) {
                            res('');
                            return;
                        }
                        let out = '';
                        stream.on('data', (d) => out += d.toString());
                        stream.on('close', () => res(out.trim()));
                        // Simple timeout safety (not real timeout, but close handling)
                        stream.stderr.on('data', () => { });
                    });
                });
            };
            (async () => {
                try {
                    // 1. OS
                    const osOut = await runCmd('cat /etc/os-release');
                    info.os = osOut.match(/PRETTY_NAME="([^"]+)"/)?.[1] || 'Unknown Linux';
                    // 2. CPU
                    const cpuOut = await runCmd('lscpu');
                    info.cpu.model = cpuOut.match(/Model name:\s+(.+)/)?.[1] || 'Unknown CPU';
                    info.cpu.cores = parseInt(cpuOut.match(/CPU\(s\):\s+(\d+)/)?.[1] || '0');
                    info.cpu.frequency = cpuOut.match(/CPU max MHz:\s+([\d.]+)/)?.[1] ||
                        cpuOut.match(/CPU MHz:\s+([\d.]+)/)?.[1] || 'N/A';
                    // 3. Network (Local IP)
                    const localIpOut = await runCmd('hostname -I');
                    info.network.localIp = localIpOut.split(' ')[0] || 'N/A';
                    // 4. Network (Public IP - with timeout via curl params)
                    // Use ip-api.com as fallback or ipinfo.io
                    const publicIpOut = await runCmd('curl -s --connect-timeout 3 http://ip-api.com/json/');
                    try {
                        const geo = JSON.parse(publicIpOut);
                        info.network.publicIp = geo.query || 'N/A';
                        info.network.location = geo.city ? `${geo.city}, ${geo.country}` : 'Unknown';
                    }
                    catch (e) {
                        info.network.publicIp = 'N/A';
                        info.network.location = 'Unknown';
                    }
                    resolve(info);
                }
                catch (e) {
                    console.error('System info error:', e);
                    resolve(info); // Return what we have
                }
            })();
        });
    }
    // SFTP Methods
    async listFiles(id, remotePath) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err)
                    return reject(err);
                sftp.readdir(remotePath, (err, list) => {
                    sftp.end();
                    if (err)
                        return reject(err);
                    const files = list.map(item => ({
                        name: item.filename,
                        type: item.longname.startsWith('d') ? 'd' : '-', // Simple heuristic
                        size: item.attrs.size,
                        date: new Date(item.attrs.mtime * 1000).toISOString()
                    }));
                    // Sort directories first
                    files.sort((a, b) => {
                        if (a.type === b.type)
                            return a.name.localeCompare(b.name);
                        return a.type === 'd' ? -1 : 1;
                    });
                    resolve(files);
                });
            });
        });
    }
    async uploadFile(id, localPath, remotePath) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err)
                    return reject(err);
                sftp.fastPut(localPath, remotePath, (err) => {
                    sftp.end();
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        });
    }
    async downloadFile(id, remotePath, localPath) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err)
                    return reject(err);
                sftp.fastGet(remotePath, localPath, (err) => {
                    sftp.end();
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        });
    }
    async deleteFile(id, path) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err)
                    return reject(err);
                const deleteRecursive = (p) => {
                    return new Promise((res, rej) => {
                        sftp.stat(p, (err, stats) => {
                            if (err)
                                return rej(err);
                            if (stats.isDirectory()) {
                                sftp.readdir(p, async (err, list) => {
                                    if (err)
                                        return rej(err);
                                    try {
                                        for (const item of list) {
                                            await deleteRecursive(`${p}/${item.filename}`);
                                        }
                                        sftp.rmdir(p, (err) => {
                                            if (err)
                                                rej(err);
                                            else
                                                res();
                                        });
                                    }
                                    catch (e) {
                                        rej(e);
                                    }
                                });
                            }
                            else {
                                sftp.unlink(p, (err) => {
                                    if (err)
                                        rej(err);
                                    else
                                        res();
                                });
                            }
                        });
                    });
                };
                deleteRecursive(path)
                    .then(() => {
                    sftp.end();
                    resolve();
                })
                    .catch((err) => {
                    sftp.end();
                    reject(err);
                });
            });
        });
    }
    async renameFile(id, oldPath, newPath) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err)
                    return reject(err);
                sftp.rename(oldPath, newPath, (err) => {
                    sftp.end();
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        });
    }
    async createDirectory(id, path) {
        const conn = this.connections.get(id);
        if (!conn)
            throw new Error('Not connected');
        return new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => {
                if (err)
                    return reject(err);
                sftp.mkdir(path, (err) => {
                    sftp.end();
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        });
    }
}
//# sourceMappingURL=sshManager.js.map