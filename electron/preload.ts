import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  openFileDialog: (opts?: { title?: string; filters?: any[] }) => ipcRenderer.invoke('open-file-dialog', opts),
  openDirectoryDialog: (opts?: { title?: string }) => ipcRenderer.invoke('open-directory-dialog', opts),

  connectSSH: ({ connection, sessionId, profileId }: { connection: any, sessionId: string, profileId?: string }) =>
    ipcRenderer.invoke('ssh-connect', { connection, sessionId, profileId }),
  onTerminalData: (callback: (event: any, payload: { id: string, data: string }) => void) => {
    const subscription = (event: any, payload: any) => callback(event, payload);
    ipcRenderer.on('terminal-data', subscription);
    return () => ipcRenderer.removeListener('terminal-data', subscription);
  },
  writeTerminal: (id: string, data: string) => ipcRenderer.send('term-write', { id, data }),
  terminalInject: (id: string, text: string) => ipcRenderer.send('terminal-inject', { id, text }),
  sshExec: (id: string, command: string, timeoutMs?: number) => ipcRenderer.invoke('ssh-exec', { id, command, timeoutMs }),
  sshReconnect: (id: string) => ipcRenderer.invoke('ssh-reconnect', id),
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
  openDirectory: () => ipcRenderer.invoke('dialog-open-directory'),
  saveDialog: (defaultName: string) => ipcRenderer.invoke('dialog-save', defaultName),

  // AI request proxy — routes through main process to avoid renderer CORS
  aiFetch: (opts: { url: string; method: string; headers: Record<string, string>; body: string }) =>
    ipcRenderer.invoke('ai-fetch', opts),
  aiFetchStream: (opts: { url: string; method: string; headers: Record<string, string>; body: string; streamId: string }) =>
    ipcRenderer.invoke('ai-fetch-stream', opts),
  onAiFetchStreamChunk: (callback: (payload: { streamId: string; chunk?: string; error?: string; done: boolean }) => void) => {
    const sub = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on('ai-fetch-stream-chunk', sub);
    return () => ipcRenderer.removeListener('ai-fetch-stream-chunk', sub);
  },


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
  dockerLogs: (id: string, containerId: string, lines?: number) => ipcRenderer.invoke('docker-logs', { id, containerId, lines: lines || 200 }),
  dockerImages: (id: string) => ipcRenderer.invoke('docker-images', id),
  dockerRemoveImage: (id: string, imageId: string) => ipcRenderer.invoke('docker-remove-image', { id, imageId }),
  dockerPrune: (id: string, type: string) => ipcRenderer.invoke('docker-prune', { id, type }),
  dockerDiskUsage: (id: string) => ipcRenderer.invoke('docker-disk-usage', id),


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

  // Agent session persistence
  agentSessionList: (profileId: string) => ipcRenderer.invoke('agent-session-list', profileId),
  agentSessionSave: (session: any) => ipcRenderer.invoke('agent-session-save', session),
  agentSessionLoad: (id: string) => ipcRenderer.invoke('agent-session-load', id),
  agentSessionDelete: (id: string) => ipcRenderer.invoke('agent-session-delete', id),
  agentSessionSetTitle: (id: string, title: string) => ipcRenderer.invoke('agent-session-set-title', id, title),

  // Agent plan mode (main-process brain)
  agentPlanStart:   (p: any) => ipcRenderer.invoke('agent-plan-start', p),
  agentPlanStop:    (p: any) => ipcRenderer.send('agent-plan-stop', p),
  agentPlanResume:  (p: any) => ipcRenderer.invoke('agent-plan-resume', p),
  agentSessionClose:(id: string) => ipcRenderer.send('agent-session-close', { sessionId: id }),

  onAgentPlanUpdate: (cb: (payload: any) => void) => {
    const sub = (_e: any, p: any) => cb(p);
    ipcRenderer.on('agent-plan-update', sub);
    return () => ipcRenderer.removeListener('agent-plan-update', sub);
  },
  onAgentPushMsg: (cb: (payload: any) => void) => {
    const sub = (_e: any, p: any) => cb(p);
    ipcRenderer.on('agent-push-msg', sub);
    return () => ipcRenderer.removeListener('agent-push-msg', sub);
  },
  onAgentUpdateMsg: (cb: (payload: any) => void) => {
    const sub = (_e: any, p: any) => cb(p);
    ipcRenderer.on('agent-update-msg', sub);
    return () => ipcRenderer.removeListener('agent-update-msg', sub);
  },

  deployAnalyzeProject: (projectRoot: string) => ipcRenderer.invoke('deploy-analyze-project', { projectRoot }),
  deployProbeServer: (sessionId: string, host: string) => ipcRenderer.invoke('deploy-probe-server', { sessionId, host }),
  deployCreateDraft: (payload: any) => ipcRenderer.invoke('deploy-create-draft', payload),
  deployStart: (payload: any) => ipcRenderer.invoke('deploy-start', payload),
  deployCancel: (sessionId: string) => ipcRenderer.send('deploy-cancel', { sessionId }),
  deployListRuns: (serverProfileId?: string) => ipcRenderer.invoke('deploy-list-runs', { serverProfileId }),
  deployGetRun: (runId: string) => ipcRenderer.invoke('deploy-get-run', { runId }),
  onDeployRunUpdate: (cb: (payload: any) => void) => {
    const sub = (_e: any, p: any) => cb(p);
    ipcRenderer.on('deploy-run-update', sub);
    return () => ipcRenderer.removeListener('deploy-run-update', sub);
  },
  onDeployRunLog: (cb: (payload: any) => void) => {
    const sub = (_e: any, p: any) => cb(p);
    ipcRenderer.on('deploy-run-log', sub);
    return () => ipcRenderer.removeListener('deploy-run-log', sub);
  },
  onDeployRunFinished: (cb: (payload: any) => void) => {
    const sub = (_e: any, p: any) => cb(p);
    ipcRenderer.on('deploy-run-finished', sub);
    return () => ipcRenderer.removeListener('deploy-run-finished', sub);
  },
});
