import { ipcMain, dialog, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { SSHConnection } from '../shared/types.js';
import { SSHManager } from './sshManager.js';

// Define the store schema
interface StoreSchema {
  connections: SSHConnection[];
}

const store = new Store<StoreSchema>({
  defaults: { connections: [] }
});

const sshManager = new SSHManager();

export function setupIpcHandlers() {
  // Connection Management
  ipcMain.handle('get-connections', () => {
    return store.get('connections');
  });

  ipcMain.handle('save-connection', (event, connection: SSHConnection) => {
    const connections = store.get('connections');
    const index = connections.findIndex(c => c.id === connection.id);
    if (index > -1) {
      connections[index] = connection;
    } else {
      connections.push(connection);
    }
    store.set('connections', connections);
    return connections;
  });

  ipcMain.handle('delete-connection', (event, id: string) => {
    const connections = store.get('connections');
    const newConnections = connections.filter(c => c.id !== id);
    store.set('connections', newConnections);
    return newConnections;
  });

  // SSH Session Management
  ipcMain.handle('ssh-connect', async (event, connection: SSHConnection) => {
    try {
      await sshManager.connect(connection, event.sender);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ssh-disconnect', (event, id: string) => {
    sshManager.disconnect(id);
    return true;
  });

  ipcMain.on('term-write', (event, { id, data }) => {
    sshManager.write(id, data);
  });

  ipcMain.on('term-resize', (event, { id, cols, rows }) => {
    sshManager.resize(id, cols, rows);
  });

  ipcMain.on('start-monitoring', (event, id) => {
    sshManager.startMonitoring(id, event.sender);
  });

  ipcMain.on('stop-monitoring', (event, id) => {
    sshManager.stopMonitoring(id);
  });

  // SFTP Handlers
  ipcMain.handle('sftp-list', (event, { id, path }) => {
    return sshManager.listFiles(id, path);
  });

  ipcMain.handle('sftp-upload', (event, { id, localPath, remotePath }) => {
    return sshManager.uploadFile(id, localPath, remotePath);
  });

  ipcMain.handle('sftp-download', (event, { id, remotePath, localPath }) => {
    return sshManager.downloadFile(id, remotePath, localPath);
  });

  ipcMain.handle('sftp-delete', (event, { id, path }) => {
    return sshManager.deleteFile(id, path);
  });

  ipcMain.handle('sftp-rename', (event, { id, oldPath, newPath }) => {
    return sshManager.renameFile(id, oldPath, newPath);
  });

  ipcMain.handle('sftp-mkdir', (event, { id, path }) => {
    return sshManager.createDirectory(id, path);
  });

  ipcMain.handle('get-pwd', (event, id) => {
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

  // System Info
  ipcMain.handle('get-system-info', (event, id) => {
    return sshManager.getSystemInfo(id);
  });
}
