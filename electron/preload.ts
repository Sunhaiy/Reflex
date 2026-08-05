import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { StoreKey } from '../src/shared/storeKeys';
import type { ActivityLine, ActivityScope, SSHConnection, SystemStats, UsageDelta, UsageStats } from '../src/shared/types';

contextBridge.exposeInMainWorld('electron', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Fired once the startup cover has painted and its fonts are in place, so the
  // window is only revealed with finished content on screen.
  signalFirstFrame: () => ipcRenderer.send('renderer-first-frame'),
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
  sftpUpload: (id: string, localPath: string, remotePath: string, transferId: string) => ipcRenderer.invoke('sftp-upload', { id, localPath, remotePath, transferId }),
  sftpDownload: (id: string, remotePath: string, localPath: string, transferId: string) => ipcRenderer.invoke('sftp-download', { id, remotePath, localPath, transferId }),
  sftpResumeUpload: (id: string, localPath: string, remotePath: string, transferId: string) => ipcRenderer.invoke('sftp-upload-resume', { id, localPath, remotePath, transferId }),
  sftpResumeDownload: (id: string, remotePath: string, localPath: string, transferId: string) => ipcRenderer.invoke('sftp-download-resume', { id, remotePath, localPath, transferId }),
  onSftpTransferProgress: (callback: (payload: { transferId: string; transferred: number; total: number; progress: number }) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: { transferId: string; transferred: number; total: number; progress: number }) => callback(payload);
    ipcRenderer.on('sftp-transfer-progress', subscription);
    return () => ipcRenderer.removeListener('sftp-transfer-progress', subscription);
  },
  sftpDelete: (id: string, path: string) => ipcRenderer.invoke('sftp-delete', { id, path }),
  sftpMkdir: (id: string, path: string) => ipcRenderer.invoke('sftp-mkdir', { id, path }),
  sftpRename: (id: string, oldPath: string, newPath: string) => ipcRenderer.invoke('sftp-rename', { id, oldPath, newPath }),
  sftpReadFile: (id: string, path: string) => ipcRenderer.invoke('sftp-read-file', { id, path }),
  sftpWriteFile: (id: string, path: string, content: string, encoding = 'utf-8') => ipcRenderer.invoke('sftp-write-file', { id, path, content, encoding }),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  agentConfigGet: () => ipcRenderer.invoke('agent-config-get'),
  agentConfigSet: (patch: unknown) => ipcRenderer.invoke('agent-config-set', patch),
  agentProviderSelect: (providerId: string) => ipcRenderer.invoke('agent-provider-select', providerId),
  agentTest: () => ipcRenderer.invoke('agent-test'),
  agentModels: () => ipcRenderer.invoke('agent-models'),
  onAgentConfigChanged: (callback: (config: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, config: unknown) => callback(config);
    ipcRenderer.on('agent-config-changed', subscription);
    return () => ipcRenderer.removeListener('agent-config-changed', subscription);
  },
  agentSend: (payload: unknown) => ipcRenderer.invoke('agent-send', payload),
  agentAnswer: (payload: unknown) => ipcRenderer.invoke('agent-answer', payload),
  agentCancel: (conversationId: string) => ipcRenderer.send('agent-cancel', conversationId),
  agentPickFolder: () => ipcRenderer.invoke('agent-pick-folder'),
  agentConversationsGet: (connectionId: string) => ipcRenderer.invoke('agent-conversations-get', connectionId),
  agentConversationsSet: (connectionId: string, value: unknown) => ipcRenderer.invoke('agent-conversations-set', { connectionId, value }),
  agentConversationDelete: (connectionId: string, conversationId: string, value: unknown) =>
    ipcRenderer.invoke('agent-conversation-delete', { connectionId, conversationId, value }),
  onAgentEvent: (callback: (payload: { sessionId: string; conversationId: string; event: unknown }) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; conversationId: string; event: unknown }) => callback(payload);
    ipcRenderer.on('agent-event', subscription);
    return () => ipcRenderer.removeListener('agent-event', subscription);
  },
  openDialog: () => ipcRenderer.invoke('dialog-open'),
  saveDialog: (defaultName: string) => ipcRenderer.invoke('dialog-save', defaultName),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),

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
  onSSHActivity: (callback: (payload: { id: string; scope: ActivityScope; line: ActivityLine }) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: { id: string; scope: ActivityScope; line: ActivityLine }) => callback(payload);
    ipcRenderer.on('ssh-activity', subscription);
    return () => ipcRenderer.removeListener('ssh-activity', subscription);
  },
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  storeGet: (key: StoreKey) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: StoreKey, value: unknown) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: StoreKey) => ipcRenderer.invoke('store-delete', key),
  usageGet: (): Promise<UsageStats> => ipcRenderer.invoke('usage-get'),
  usageRecord: (delta: UsageDelta) => ipcRenderer.send('usage-record', delta),
  onUsageStats: (callback: (stats: UsageStats) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, stats: UsageStats) => callback(stats);
    ipcRenderer.on('usage-stats-updated', subscription);
    return () => ipcRenderer.removeListener('usage-stats-updated', subscription);
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  logWrite: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) =>
    ipcRenderer.send('log-write', { level, message, detail }),
  probeHost: (target: { host: string; port?: number }) => ipcRenderer.invoke('probe-host', target),
  logReveal: () => ipcRenderer.invoke('log-reveal'),
  logPath: (): Promise<string> => ipcRenderer.invoke('log-path'),
  logRead: (maxLines?: number): Promise<string> => ipcRenderer.invoke('log-read', maxLines),
});
