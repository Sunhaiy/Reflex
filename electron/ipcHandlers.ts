import { ipcMain, BrowserWindow, dialog, clipboard } from 'electron';
import { SSHManager } from './ssh/sshManager.js';
import { DeploymentManager } from './deploy/deploymentManager.js';
import { AgentV2Manager } from './agent-v2/manager.js';
import { SSHConnection } from '../src/shared/types.js';
import Store from 'electron-store';

const store = new Store();
const sshManager = new SSHManager(store);
const deploymentManager = new DeploymentManager(sshManager, store);
const agentManager = new AgentV2Manager(sshManager, deploymentManager);

export function setupIpcHandlers() {
  // ── Universal AI fetch proxy (bypasses renderer CORS) ────────────────────────
  // Non-streaming: returns { ok, status, body }
  ipcMain.handle('ai-fetch', async (_event, { url, method, headers, body }: {
    url: string; method: string; headers: Record<string, string>; body: string;
  }) => {
    try {
      const res = await fetch(url, { method, headers, body });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text };
    } catch (err: any) {
      return { ok: false, status: 0, body: err?.message ?? String(err) };
    }
  });

  // Streaming: sends chunks back via 'ai-fetch-stream-chunk' events on the sender
  ipcMain.handle('ai-fetch-stream', async (event, { url, method, headers, body, streamId }: {
    url: string; method: string; headers: Record<string, string>; body: string; streamId: string;
  }) => {
    try {
      const res = await fetch(url, { method, headers, body });
      if (!res.ok || !res.body) {
        const text = await res.text();
        event.sender.send('ai-fetch-stream-chunk', { streamId, error: text, done: true });
        return;
      }
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          event.sender.send('ai-fetch-stream-chunk', { streamId, chunk: '', done: true });
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        event.sender.send('ai-fetch-stream-chunk', { streamId, chunk, done: false });
      }
    } catch (err: any) {
      event.sender.send('ai-fetch-stream-chunk', { streamId, error: err?.message ?? String(err), done: true });
    }
  });

  // Store
  ipcMain.handle('store-get', (event, key) => store.get(key));
  ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
  ipcMain.handle('store-delete', (event, key) => store.delete(key as any));

  // Agent Session persistence
  const getSessions = () => (store.get('agentSessions') as any[] | undefined) || [];

  ipcMain.handle('agent-session-list', (_event, profileId: string) =>
    getSessions().filter((s: any) => s.profileId === profileId)
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  );
  ipcMain.handle('agent-session-save', (_event, session: any) => {
    const all = getSessions().filter((s: any) => s.id !== session.id);
    store.set('agentSessions', [...all, session]);
  });
  ipcMain.handle('agent-session-load', (_event, id: string) =>
    getSessions().find((s: any) => s.id === id) || null
  );
  ipcMain.handle('agent-session-delete', (_event, id: string) =>
    store.set('agentSessions', getSessions().filter((s: any) => s.id !== id))
  );
  ipcMain.handle('agent-session-set-title', (_event, id: string, title: string) => {
    store.set('agentSessions', getSessions().map((s: any) =>
      s.id === id ? { ...s, title, updatedAt: Date.now() } : s
    ));
  });

  ipcMain.handle('open-file-dialog', async (event, opts?: { title?: string; filters?: any[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: opts?.title || '选择文件',
      properties: ['openFile'],
      filters: opts?.filters || [
        { name: 'SSH 私钥', extensions: ['pem', 'key', 'ppk', 'rsa', 'ed25519', 'ecdsa', ''] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('open-directory-dialog', async (event, opts?: { title?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: opts?.title || 'Select project directory',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('ssh-connect', async (event, { connection, sessionId, profileId }: { connection: SSHConnection, sessionId: string, profileId?: string }) => {
    try {
      await sshManager.connect(connection, event.sender, sessionId, profileId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ssh-reconnect', async (_event, sessionId: string) => {
    try {
      await sshManager.reconnect(sessionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.on('term-write', (event, { id, data }) => {
    sshManager.write(id, data);
  });

  ipcMain.on('term-resize', (event, { id, cols, rows }) => {
    sshManager.resize(id, cols, rows);
  });

  // Inject text directly to xterm display (NOT PTY stdin — avoids pager issues)
  // Used by Agent mode to echo exec commands and their output in the terminal view.
  ipcMain.on('terminal-inject', (event, { id, text }) => {
    event.sender.send('terminal-data', { id, data: text });
  });

  ipcMain.handle('ssh-exec', async (event, { id, command, timeoutMs }: { id: string; command: string; timeoutMs?: number }) => {
    return sshManager.exec(id, command, timeoutMs);
  });

  ipcMain.handle('sftp-list', (event, { id, path }) => {
    console.log(`[IPC] sftp-list: id=${id}, path=${path}`);
    return sshManager.listFiles(id, path);
  });

  ipcMain.handle('sftp-upload', async (event, { id, localPath, remotePath }) => {
    console.log(`[IPC] sftp-upload: id=${id}`);
    return sshManager.uploadFile(id, localPath, remotePath);
  });

  ipcMain.handle('sftp-download', async (event, { id, remotePath, localPath }) => {
    console.log(`[IPC] sftp-download: id=${id}`);
    return sshManager.downloadFile(id, remotePath, localPath);
  });

  ipcMain.handle('sftp-delete', async (event, { id, path }) => {
    console.log(`[IPC] sftp-delete: id=${id}, path=${path}`);
    return sshManager.deleteFile(id, path);
  });

  ipcMain.handle('sftp-mkdir', async (event, { id, path }) => {
    console.log(`[IPC] sftp-mkdir: id=${id}, path=${path}`);
    return sshManager.createFolder(id, path);
  });

  ipcMain.handle('sftp-rename', async (event, { id, oldPath, newPath }) => {
    console.log(`[IPC] sftp-rename: id=${id}`);
    return sshManager.renameFile(id, oldPath, newPath);
  });

  ipcMain.handle('sftp-read-file', async (event, { id, path }) => {
    console.log(`[IPC] sftp-read-file: id=${id}, path=${path}`);
    return sshManager.readFile(id, path);
  });

  ipcMain.handle('sftp-write-file', async (event, { id, path, content }) => {
    console.log(`[IPC] sftp-write-file: id=${id}, path=${path}`);
    return sshManager.writeFile(id, path, content);
  });

  ipcMain.handle('get-pwd', async (event, id) => {
    console.log(`[IPC] get-pwd: id=${id}`);
    return sshManager.getPwd(id);
  });

  ipcMain.handle('dialog-open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    return result.filePaths[0];
  });

  ipcMain.handle('dialog-open-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.filePaths[0];
  });

  ipcMain.handle('dialog-save', async (event, defaultName) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    return result.filePath;
  });

  ipcMain.on('start-monitoring', (event, id) => {
    sshManager.startMonitoring(id, event.sender);
  });

  ipcMain.on('stop-monitoring', (event, id) => {
    sshManager.stopMonitoring(id);
  });

  ipcMain.handle('get-processes', async (event, id) => {
    return sshManager.getProcesses(id);
  });

  ipcMain.handle('kill-process', async (event, { id, pid }) => {
    return sshManager.killProcess(id, pid);
  });

  ipcMain.handle('docker-list', async (event, id) => {
    return sshManager.getDockerContainers(id);
  });

  ipcMain.handle('docker-action', async (event, { id, containerId, action }) => {
    return sshManager.dockerAction(id, containerId, action);
  });

  ipcMain.handle('docker-logs', async (event, { id, containerId, lines }) => {
    return sshManager.dockerLogs(id, containerId, lines);
  });

  ipcMain.handle('docker-images', async (event, id) => {
    return sshManager.dockerImages(id);
  });

  ipcMain.handle('docker-remove-image', async (event, { id, imageId }) => {
    return sshManager.dockerRemoveImage(id, imageId);
  });

  ipcMain.handle('docker-prune', async (event, { id, type }) => {
    return sshManager.dockerPrune(id, type);
  });

  ipcMain.handle('docker-disk-usage', async (event, id) => {
    return sshManager.dockerDiskUsage(id);
  });

  // Deployment workflow
  ipcMain.handle('deploy-analyze-project', async (_event, { projectRoot }) => {
    return deploymentManager.analyzeProject(projectRoot);
  });

  ipcMain.handle('deploy-probe-server', async (_event, { sessionId, host }) => {
    return deploymentManager.probeServer(sessionId, host);
  });

  ipcMain.handle('deploy-create-draft', async (_event, payload) => {
    return deploymentManager.createDraft(payload.sessionId, payload);
  });

  ipcMain.handle('deploy-start', async (event, payload) => {
    deploymentManager.start(payload.sessionId, event.sender, payload);
    return { success: true };
  });

  ipcMain.on('deploy-cancel', (_event, { sessionId }) => {
    deploymentManager.cancel(sessionId);
  });

  ipcMain.handle('deploy-list-runs', async (_event, { serverProfileId }) => {
    return deploymentManager.listRuns(serverProfileId);
  });

  ipcMain.handle('deploy-get-run', async (_event, { runId }) => {
    return deploymentManager.getRun(runId);
  });


  // Window Controls
  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  // Clipboard
  ipcMain.on('clipboard-write', (event, text) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('clipboard-read', () => {
    return clipboard.readText();
  });

  // ── Agent Plan Mode (main-process brain) ────────────────────────────────────
  ipcMain.handle('agent-plan-start', (event, payload) => {
    agentManager.startPlan(payload.sessionId, payload, event.sender);
  });

  ipcMain.on('agent-plan-stop', (_event, { sessionId }) => {
    agentManager.stop(sessionId);
  });

  ipcMain.handle('agent-plan-resume', (event, payload) => {
    agentManager.resume(payload.sessionId, payload, event.sender);
  });

  ipcMain.on('agent-session-close', (_event, { sessionId }) => {
    agentManager.cleanup(sessionId);
  });
}
