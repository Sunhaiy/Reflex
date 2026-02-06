import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script loading...');

contextBridge.exposeInMainWorld('electron', {
  getVersion: () => ipcRenderer.invoke('get-version'),

  connectSSH: ({ connection, sessionId, profileId }: { connection: any, sessionId: string, profileId?: string }) =>
    ipcRenderer.invoke('ssh-connect', { connection, sessionId, profileId }),
  onTerminalData: (callback: (event: any, payload: { id: string, data: string }) => void) => {
    const subscription = (event: any, payload: any) => callback(event, payload);
    ipcRenderer.on('terminal-data', subscription);
    return () => ipcRenderer.removeListener('terminal-data', subscription);
  },
  writeTerminal: (id: string, data: string) => ipcRenderer.send('term-write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.send('term-resize', { id, cols, rows }),

  sftpList: (id: string, path: string) => ipcRenderer.invoke('sftp-list', { id, path }),
  sftpUpload: (id: string, localPath: string, remotePath: string) => ipcRenderer.invoke('sftp-upload', { id, localPath, remotePath }),
  sftpDownload: (id: string, remotePath: string, localPath: string) => ipcRenderer.invoke('sftp-download', { id, remotePath, localPath }),
  sftpDelete: (id: string, path: string) => ipcRenderer.invoke('sftp-delete', { id, path }),
  sftpMkdir: (id: string, path: string) => ipcRenderer.invoke('sftp-mkdir', { id, path }),
  sftpRename: (id: string, oldPath: string, newPath: string) => ipcRenderer.invoke('sftp-rename', { id, oldPath, newPath }),
  sftpReadFile: (id: string, path: string) => ipcRenderer.invoke('sftp-read-file', { id, path }),
  sftpWriteFile: (id: string, path: string, content: string) => ipcRenderer.invoke('sftp-write-file', { id, path, content }),
  getPwd: (id: string) => ipcRenderer.invoke('get-pwd', id),

  openDialog: () => ipcRenderer.invoke('dialog-open'),
  saveDialog: (defaultName: string) => ipcRenderer.invoke('dialog-save', defaultName),

  startMonitoring: (id: string) => ipcRenderer.send('start-monitoring', id),
  stopMonitoring: (id: string) => ipcRenderer.send('stop-monitoring', id),
  onStatsUpdate: (callback: (event: any, payload: { id: string, stats: any }) => void) => {
    const subscription = (event: any, payload: any) => callback(event, payload);
    ipcRenderer.on('stats-update', subscription);
    return () => ipcRenderer.removeListener('stats-update', subscription);
  },

  getProcesses: (id: string) => ipcRenderer.invoke('get-processes', id),
  killProcess: (id: string, pid: number) => ipcRenderer.invoke('kill-process', { id, pid }),

  getDockerContainers: (id: string) => ipcRenderer.invoke('docker-list', id),
  dockerAction: (id: string, containerId: string, action: string) => ipcRenderer.invoke('docker-action', { id, containerId, action }),

  addTunnel: (id: string, type: 'L' | 'R', config: any, name?: string) => ipcRenderer.invoke('tunnel-add', { id, type, config, name }),
  removeTunnel: (id: string, tunnelId: string) => ipcRenderer.invoke('tunnel-remove', { id, tunnelId }),
  tunnelToggle: ({ id, tunnelId, active }: { id: string, tunnelId: string, active: boolean }) => ipcRenderer.invoke('tunnel-toggle', { id, tunnelId, active }),
  getTunnels: (id: string) => ipcRenderer.invoke('tunnel-list', id),

  onSSHStatus: (callback: (event: any, payload: { id: string, status: string }) => void) => {
    const subscription = (event: any, payload: any) => callback(event, payload);
    ipcRenderer.on('ssh-status', subscription);
    return () => ipcRenderer.removeListener('ssh-status', subscription);
  },

  // Window Controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store-delete', key),
  clipboardWriteText: (text: string) => ipcRenderer.send('clipboard-write', text),
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read'),
});

console.log('Preload script loaded');
