import { contextBridge, ipcRenderer } from 'electron';
console.log('Preload script loaded');
contextBridge.exposeInMainWorld('electron', {
    getConnections: () => ipcRenderer.invoke('get-connections'),
    saveConnection: (connection) => ipcRenderer.invoke('save-connection', connection),
    deleteConnection: (id) => ipcRenderer.invoke('delete-connection', id),
    connectSSH: (connection) => ipcRenderer.invoke('ssh-connect', connection),
    disconnectSSH: (id) => ipcRenderer.invoke('ssh-disconnect', id),
    onTerminalData: (callback) => {
        const subscription = (event, payload) => callback(event, payload);
        ipcRenderer.on('terminal-data', subscription);
        return () => ipcRenderer.removeListener('terminal-data', subscription);
    },
    onSSHStatus: (callback) => {
        const subscription = (event, payload) => callback(event, payload);
        ipcRenderer.on('ssh-status', subscription);
        return () => ipcRenderer.removeListener('ssh-status', subscription);
    },
    writeTerminal: (id, data) => ipcRenderer.send('term-write', { id, data }),
    resizeTerminal: (id, cols, rows) => ipcRenderer.send('term-resize', { id, cols, rows }),
    startMonitoring: (id) => ipcRenderer.send('start-monitoring', id),
    stopMonitoring: (id) => ipcRenderer.send('stop-monitoring', id),
    onStatsUpdate: (callback) => ipcRenderer.on('stats-update', callback),
    // SFTP
    sftpList: (id, path) => ipcRenderer.invoke('sftp-list', { id, path }),
    sftpUpload: (id, localPath, remotePath) => ipcRenderer.invoke('sftp-upload', { id, localPath, remotePath }),
    sftpDownload: (id, remotePath, localPath) => ipcRenderer.invoke('sftp-download', { id, remotePath, localPath }),
    sftpDelete: (id, path) => ipcRenderer.invoke('sftp-delete', { id, path }),
    sftpRename: (id, oldPath, newPath) => ipcRenderer.invoke('sftp-rename', { id, oldPath, newPath }),
    sftpMkdir: (id, path) => ipcRenderer.invoke('sftp-mkdir', { id, path }),
    getPwd: (id) => ipcRenderer.invoke('get-pwd', id),
    openDialog: () => ipcRenderer.invoke('dialog-open'),
    saveDialog: (defaultName) => ipcRenderer.invoke('dialog-save', defaultName),
    // Window Controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    // Extended System Info
    getSystemInfo: (id) => ipcRenderer.invoke('get-system-info', id),
});
//# sourceMappingURL=preload.js.map