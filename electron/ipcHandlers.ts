import { BrowserWindow, dialog, ipcMain } from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import type { SSHConnection, UsageDelta, UsageStats } from '../src/shared/types.js';
import { mergeUsageDelta, normalizeUsageStats } from '../src/shared/usage.js';
import { SSHManager } from './ssh/sshManager.js';

const store = new Store();
const sshManager = new SSHManager();
const LEGACY_STORE_DIR_NAMES = ['zangqing', 'Zangqing'];
const MIGRATED_STORE_KEYS = [
  'connections',
  'connectionDraft',
  'appearance',
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
  'usageStats',
];
const ALLOWED_STORE_KEYS = new Set(MIGRATED_STORE_KEYS);

function assertStoreKey(key: string) {
  if (!ALLOWED_STORE_KEYS.has(key)) throw new Error('Unsupported settings key');
}

function getUsageStats(): UsageStats {
  return normalizeUsageStats(store.get('usageStats'));
}

function recordUsage(delta: UsageDelta, sender?: Electron.WebContents) {
  const stats = mergeUsageDelta(store.get('usageStats'), delta);
  store.set('usageStats', stats);
  if (sender && !sender.isDestroyed()) sender.send('usage-stats-updated', stats);
  return stats;
}

async function trackServerOperation<T>(sender: Electron.WebContents, operation: () => Promise<T>, activity = 4) {
  const result = await operation();
  recordUsage({ serverOperations: 1, activity }, sender);
  return result;
}

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
  ipcMain.handle('store-get', (_event, key: string) => {
    assertStoreKey(key);
    return store.get(key);
  });
  ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
    assertStoreKey(key);
    return store.set(key, value);
  });
  ipcMain.handle('store-delete', (_event, key: string) => {
    assertStoreKey(key);
    return store.delete(key);
  });
  ipcMain.handle('usage-get', () => getUsageStats());
  ipcMain.on('usage-record', (event, delta: UsageDelta) => {
    if (!delta || typeof delta !== 'object') return;
    recordUsage(delta, event.sender);
  });

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

  ipcMain.handle('ssh-connect', async (event, payload: { connection: SSHConnection; sessionId: string }) => {
    try {
      await sshManager.connect(payload.connection, event.sender, payload.sessionId);
      recordUsage({ successfulConnections: 1, serverOperations: 1, activity: 8 }, event.sender);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ssh-reconnect', async (event, sessionId: string) => {
    try {
      await sshManager.reconnect(sessionId);
      recordUsage({ successfulConnections: 1, serverOperations: 1, activity: 8 }, event.sender);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ssh-disconnect', (_event, sessionId: string) => {
    sshManager.disconnect(sessionId);
  });

  ipcMain.on('term-write', (_event, { id, data }: { id: string; data: string }) => sshManager.write(id, data));
  ipcMain.on('term-resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => sshManager.resize(id, cols, rows));

  ipcMain.handle('sftp-list', (_event, { id, path: remotePath }) => sshManager.listFiles(id, remotePath));
  ipcMain.handle('sftp-upload', (event, { id, localPath, remotePath }) => trackServerOperation(event.sender, () => sshManager.uploadFile(id, localPath, remotePath), 6));
  ipcMain.handle('sftp-download', (event, { id, remotePath, localPath }) => trackServerOperation(event.sender, () => sshManager.downloadFile(id, remotePath, localPath), 6));
  ipcMain.handle('sftp-delete', (event, { id, path: remotePath }) => trackServerOperation(event.sender, () => sshManager.deleteFile(id, remotePath)));
  ipcMain.handle('sftp-mkdir', (event, { id, path: remotePath }) => trackServerOperation(event.sender, () => sshManager.createFolder(id, remotePath)));
  ipcMain.handle('sftp-rename', (event, { id, oldPath, newPath }) => trackServerOperation(event.sender, () => sshManager.renameFile(id, oldPath, newPath)));
  ipcMain.handle('sftp-read-file', (_event, { id, path: remotePath }) => sshManager.readFile(id, remotePath));
  ipcMain.handle('sftp-write-file', (event, { id, path: remotePath, content }) => trackServerOperation(event.sender, () => sshManager.writeFile(id, remotePath, content), 5));
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
  ipcMain.handle('kill-process', (event, { id, pid }: { id: string; pid: number }) => trackServerOperation(event.sender, () => sshManager.killProcess(id, pid), 5));

  ipcMain.handle('docker-list', (_event, id: string) => sshManager.getDockerContainers(id));
  ipcMain.handle('docker-action', (event, { id, containerId, action }) => trackServerOperation(event.sender, () => sshManager.dockerAction(id, containerId, action), 5));
  ipcMain.handle('docker-logs', (_event, { id, containerId, lines }) => sshManager.dockerLogs(id, containerId, lines));
  ipcMain.handle('docker-images', (_event, id: string) => sshManager.dockerImages(id));
  ipcMain.handle('docker-remove-image', (event, { id, imageId }) => trackServerOperation(event.sender, () => sshManager.dockerRemoveImage(id, imageId), 5));
  ipcMain.handle('docker-prune', (event, { id, type }) => trackServerOperation(event.sender, () => sshManager.dockerPrune(id, type), 6));
  ipcMain.handle('docker-disk-usage', (_event, id: string) => sshManager.dockerDiskUsage(id));

  ipcMain.on('window-minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}
