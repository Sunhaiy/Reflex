import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { SSHConnection, SystemStats, UsageDelta, UsageStats } from '../src/shared/types';

contextBridge.exposeInMainWorld('electron', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  openFileDialog: (opts?: { title?: string; filters?: Electron.FileFilter[] }) => ipcRenderer.invoke('open-file-dialog', opts),

  connectSSH: (payload: { connection: SSHConnection; sessionId: string }) => ipcRenderer.invoke('ssh-connect', payload),
  onTerminalData: (callback: (event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => void) => {
    const subscription = (event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => callback(event, payload);
    ipcRenderer.on('terminal-data', subscription);
    return () => ipcRenderer.removeListener('terminal-data', subscription);
  },
  writeTerminal: (id: string, data: string) => ipcRenderer.send('term-write', { id, data }),
  sshReconnect: (id: string) => ipcRenderer.invoke('ssh-reconnect', id),
  disconnectSSH: (id: string) => ipcRenderer.invoke('ssh-disconnect', id),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.send('term-resize', { id, cols, rows }),

  sftpList: (id: string, path: string) => ipcRenderer.invoke('sftp-list', { id, path }),
  sftpUpload: (id: string, localPath: string, remotePath: string) => ipcRenderer.invoke('sftp-upload', { id, localPath, remotePath }),
  sftpDownload: (id: string, remotePath: string, localPath: string) => ipcRenderer.invoke('sftp-download', { id, remotePath, localPath }),
  sftpDelete: (id: string, path: string) => ipcRenderer.invoke('sftp-delete', { id, path }),
  sftpMkdir: (id: string, path: string) => ipcRenderer.invoke('sftp-mkdir', { id, path }),
  sftpRename: (id: string, oldPath: string, newPath: string) => ipcRenderer.invoke('sftp-rename', { id, oldPath, newPath }),
  sftpReadFile: (id: string, path: string) => ipcRenderer.invoke('sftp-read-file', { id, path }),
  sftpWriteFile: (id: string, path: string, content: string) => ipcRenderer.invoke('sftp-write-file', { id, path, content }),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getPwd: (id: string) => ipcRenderer.invoke('get-pwd', id),
  openDialog: () => ipcRenderer.invoke('dialog-open'),
  saveDialog: (defaultName: string) => ipcRenderer.invoke('dialog-save', defaultName),

  startMonitoring: (id: string) => ipcRenderer.send('start-monitoring', id),
  stopMonitoring: (id: string) => ipcRenderer.send('stop-monitoring', id),
  onStatsUpdate: (callback: (event: Electron.IpcRendererEvent, payload: { id: string; stats: SystemStats }) => void) => {
    const subscription = (event: Electron.IpcRendererEvent, payload: { id: string; stats: SystemStats }) => callback(event, payload);
    ipcRenderer.on('stats-update', subscription);
    return () => ipcRenderer.removeListener('stats-update', subscription);
  },
  getProcesses: (id: string) => ipcRenderer.invoke('get-processes', id),
  killProcess: (id: string, pid: number) => ipcRenderer.invoke('kill-process', { id, pid }),

  getDockerContainers: (id: string) => ipcRenderer.invoke('docker-list', id),
  dockerAction: (id: string, containerId: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove') => ipcRenderer.invoke('docker-action', { id, containerId, action }),
  dockerLogs: (id: string, containerId: string, lines = 200) => ipcRenderer.invoke('docker-logs', { id, containerId, lines }),
  dockerImages: (id: string) => ipcRenderer.invoke('docker-images', id),
  dockerRemoveImage: (id: string, imageId: string) => ipcRenderer.invoke('docker-remove-image', { id, imageId }),
  dockerPrune: (id: string, type: string) => ipcRenderer.invoke('docker-prune', { id, type }),
  dockerDiskUsage: (id: string) => ipcRenderer.invoke('docker-disk-usage', id),

  onSSHStatus: (callback: (event: Electron.IpcRendererEvent, payload: { id: string; status: string }) => void) => {
    const subscription = (event: Electron.IpcRendererEvent, payload: { id: string; status: string }) => callback(event, payload);
    ipcRenderer.on('ssh-status', subscription);
    return () => ipcRenderer.removeListener('ssh-status', subscription);
  },
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store-delete', key),
  usageGet: (): Promise<UsageStats> => ipcRenderer.invoke('usage-get'),
  usageRecord: (delta: UsageDelta) => ipcRenderer.send('usage-record', delta),
  onUsageStats: (callback: (stats: UsageStats) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, stats: UsageStats) => callback(stats);
    ipcRenderer.on('usage-stats-updated', subscription);
    return () => ipcRenderer.removeListener('usage-stats-updated', subscription);
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
});
