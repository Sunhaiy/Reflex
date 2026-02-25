import { ipcMain, BrowserWindow, dialog, clipboard } from 'electron';
import { SSHManager } from './ssh/sshManager.js';
import { SSHConnection } from '../src/shared/types.js';
import Store from 'electron-store';

const store = new Store();
const sshManager = new SSHManager(store);

export function setupIpcHandlers() {
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

  ipcMain.handle('ssh-connect', async (event, { connection, sessionId, profileId }: { connection: SSHConnection, sessionId: string, profileId?: string }) => {
    try {
      await sshManager.connect(connection, event.sender, sessionId, profileId);
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
}
