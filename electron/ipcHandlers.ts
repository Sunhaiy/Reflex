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

  // Tunnels
  ipcMain.handle('tunnel-add', async (event, { id, type, config, name }) => {
    return sshManager.addTunnel(id, type, config, name);
  });

  ipcMain.handle('tunnel-toggle', async (event, { id, tunnelId, active }) => {
    return sshManager.toggleTunnel(id, tunnelId, active);
  });

  ipcMain.handle('tunnel-remove', async (event, { id, tunnelId }) => {
    return sshManager.removeTunnel(id, tunnelId);
  });

  ipcMain.handle('tunnel-list', async (event, id) => {
    return sshManager.getTunnels(id);
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
