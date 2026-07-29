import { BrowserWindow, dialog, ipcMain } from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import type { SSHConnection } from '../src/shared/types.js';
import { SSHManager } from './ssh/sshManager.js';

const store = new Store();
const sshManager = new SSHManager(store);
const LEGACY_STORE_DIR_NAMES = ['zangqing', 'Zangqing'];
const MIGRATED_STORE_KEYS = [
  'connections',
  'lastConnection',
  'terminalFontFamily',
  'uiFontFamily',
  'language',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'cursorStyle',
  'cursorBlink',
  'rendererType',
  'scrollback',
  'brightBold',
  'bellStyle',
  'autoReconnect',
  'bookmarks',
  'baseTheme',
  'accentColor',
  'terminalTheme',
  'opacity',
];

function isEmptyValue(value: unknown) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    console.warn('[Store] Failed to read legacy config during migration:', path.dirname(filePath), error);
    return null;
  }
}

function migrateLegacyStore(targetStore: Store) {
  const targetPath = targetStore.path;
  if (!targetPath) return;

  const appDataRoot = path.dirname(path.dirname(targetPath));
  for (const legacyDirName of LEGACY_STORE_DIR_NAMES) {
    const legacyConfig = readJsonFile(path.join(appDataRoot, legacyDirName, 'config.json'));
    if (!legacyConfig) continue;

    const migratedKeys: string[] = [];
    for (const key of MIGRATED_STORE_KEYS) {
      if (isEmptyValue(targetStore.get(key)) && !isEmptyValue(legacyConfig[key])) {
        targetStore.set(key, legacyConfig[key]);
        migratedKeys.push(key);
      }
    }

    if (migratedKeys.length > 0) {
      console.log(`[Store] Migrated legacy Reflex config keys: ${migratedKeys.join(', ')}`);
    }
    return;
  }
}

migrateLegacyStore(store);

export function setupIpcHandlers() {
  ipcMain.handle('store-get', (_event, key: string) => store.get(key));
  ipcMain.handle('store-set', (_event, key: string, value: unknown) => store.set(key, value));
  ipcMain.handle('store-delete', (_event, key: string) => store.delete(key));

  ipcMain.handle('open-file-dialog', async (event, opts?: { title?: string; filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: opts?.title || '选择文件',
      properties: ['openFile'],
      filters: opts?.filters || [
        { name: 'SSH 私钥', extensions: ['pem', 'key', 'ppk', 'rsa', 'ed25519', 'ecdsa', ''] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('ssh-connect', async (event, payload: { connection: SSHConnection; sessionId: string; profileId?: string }) => {
    try {
      await sshManager.connect(payload.connection, event.sender, payload.sessionId, payload.profileId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ssh-reconnect', async (_event, sessionId: string) => {
    try {
      await sshManager.reconnect(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.on('term-write', (_event, { id, data }: { id: string; data: string }) => sshManager.write(id, data));
  ipcMain.on('term-resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => sshManager.resize(id, cols, rows));

  ipcMain.handle('sftp-list', (_event, { id, path: remotePath }) => sshManager.listFiles(id, remotePath));
  ipcMain.handle('sftp-upload', (_event, { id, localPath, remotePath }) => sshManager.uploadFile(id, localPath, remotePath));
  ipcMain.handle('sftp-download', (_event, { id, remotePath, localPath }) => sshManager.downloadFile(id, remotePath, localPath));
  ipcMain.handle('sftp-delete', (_event, { id, path: remotePath }) => sshManager.deleteFile(id, remotePath));
  ipcMain.handle('sftp-mkdir', (_event, { id, path: remotePath }) => sshManager.createFolder(id, remotePath));
  ipcMain.handle('sftp-rename', (_event, { id, oldPath, newPath }) => sshManager.renameFile(id, oldPath, newPath));
  ipcMain.handle('sftp-read-file', (_event, { id, path: remotePath }) => sshManager.readFile(id, remotePath));
  ipcMain.handle('sftp-write-file', (_event, { id, path: remotePath, content }) => sshManager.writeFile(id, remotePath, content));
  ipcMain.handle('get-pwd', (_event, id: string) => sshManager.getPwd(id));

  ipcMain.handle('dialog-open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle('dialog-save', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    return result.canceled ? undefined : result.filePath;
  });

  ipcMain.on('start-monitoring', (event, id: string) => sshManager.startMonitoring(id, event.sender));
  ipcMain.on('stop-monitoring', (_event, id: string) => sshManager.stopMonitoring(id));
  ipcMain.handle('get-processes', (_event, id: string) => sshManager.getProcesses(id));
  ipcMain.handle('kill-process', (_event, { id, pid }: { id: string; pid: number }) => sshManager.killProcess(id, pid));

  ipcMain.handle('docker-list', (_event, id: string) => sshManager.getDockerContainers(id));
  ipcMain.handle('docker-action', (_event, { id, containerId, action }) => sshManager.dockerAction(id, containerId, action));
  ipcMain.handle('docker-logs', (_event, { id, containerId, lines }) => sshManager.dockerLogs(id, containerId, lines));
  ipcMain.handle('docker-images', (_event, id: string) => sshManager.dockerImages(id));
  ipcMain.handle('docker-remove-image', (_event, { id, imageId }) => sshManager.dockerRemoveImage(id, imageId));
  ipcMain.handle('docker-prune', (_event, { id, type }) => sshManager.dockerPrune(id, type));
  ipcMain.handle('docker-disk-usage', (_event, id: string) => sshManager.dockerDiskUsage(id));

  ipcMain.on('window-minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}
