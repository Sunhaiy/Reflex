import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electron', {
  getConnections: () => ipcRenderer.invoke('get-connections'),
  saveConnection: (connection: any) => ipcRenderer.invoke('save-connection', connection),
  deleteConnection: (id: string) => ipcRenderer.invoke('delete-connection', id),
  
  connectSSH: (connection: any) => ipcRenderer.invoke('ssh-connect', connection),
  disconnectSSH: (id: string) => ipcRenderer.invoke('ssh-disconnect', id),
  
  onTerminalData: (callback: (event: any, payload: { id: string, data: string }) => void) => {
    const subscription = (event: any, payload: any) => callback(event, payload);
    ipcRenderer.on('terminal-data', subscription);
    return () => ipcRenderer.removeListener('terminal-data', subscription);
  },
  
  onSSHStatus: (callback: (event: any, payload: { id: string, status: string }) => void) => {
    const subscription = (event: any, payload: any) => callback(event, payload);
    ipcRenderer.on('ssh-status', subscription);
    return () => ipcRenderer.removeListener('ssh-status', subscription);
  },
  
  writeTerminal: (id: string, data: string) => ipcRenderer.send('term-write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.send('term-resize', { id, cols, rows }),
  startMonitoring: (id: string) => ipcRenderer.send('start-monitoring', id),
  stopMonitoring: (id: string) => ipcRenderer.send('stop-monitoring', id),
  onStatsUpdate: (callback: (event: any, payload: { id: string; stats: any }) => void) => ipcRenderer.on('stats-update', callback),

  // SFTP
  sftpList: (id: string, path: string) => ipcRenderer.invoke('sftp-list', { id, path }),
  sftpUpload: (id: string, localPath: string, remotePath: string) => ipcRenderer.invoke('sftp-upload', { id, localPath, remotePath }),
  sftpDownload: (id: string, remotePath: string, localPath: string) => ipcRenderer.invoke('sftp-download', { id, remotePath, localPath }),
  sftpDelete: (id: string, path: string) => ipcRenderer.invoke('sftp-delete', { id, path }),
  sftpRename: (id: string, oldPath: string, newPath: string) => ipcRenderer.invoke('sftp-rename', { id, oldPath, newPath }),
  sftpMkdir: (id: string, path: string) => ipcRenderer.invoke('sftp-mkdir', { id, path }),
  getPwd: (id: string) => ipcRenderer.invoke('get-pwd', id),
  
  openDialog: () => ipcRenderer.invoke('dialog-open'),
  saveDialog: (defaultName: string) => ipcRenderer.invoke('dialog-save', defaultName),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Extended System Info
  getSystemInfo: (id: string) => ipcRenderer.invoke('get-system-info', id),
});
