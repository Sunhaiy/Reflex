import { BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import net from 'net';
import path from 'path';
import type { SSHConnection, UsageDelta, UsageStats } from '../src/shared/types.js';
import { STORE_KEYS } from '../src/shared/storeKeys.js';
import { mergeUsageDelta, normalizeUsageStats } from '../src/shared/usage.js';
import { SSHManager } from './ssh/sshManager.js';
import { getLogDirectory, getLogFilePath, readRecentLog, writeLog, type LogLevel } from './logger.js';

const store = new Store();

/** Shared so the main process can persist window bounds through the same file. */
export function getStore() {
  return store;
}

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
  'autoReconnect',
  'bookmarks',
  'baseTheme',
  'accentColor',
  'terminalTheme',
  'opacity',
  'radiusScale',
  'usageStats',
];
const ALLOWED_STORE_KEYS: Set<string> = new Set(STORE_KEYS);

/**
 * Credentials are encrypted at the store boundary with the OS keystore — DPAPI on
 * Windows, Keychain on macOS, libsecret on Linux — so config.json no longer holds a
 * readable copy of every server password. The renderer still works in plaintext,
 * because it has to render the field the user typed into.
 *
 * Values carry a prefix so a plaintext entry written by an older build is recognised
 * and passed through rather than mangled; the migration below converts those on start.
 */
const SECRET_FIELDS = ['password', 'passphrase', 'jumpPassword'];
const CIPHER_PREFIX = 'enc:v1:';

function encryptSecret(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  if (value.startsWith(CIPHER_PREFIX)) return value;
  if (!safeStorage.isEncryptionAvailable()) return value;
  try {
    return CIPHER_PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch (error) {
    writeLog('error', 'main', '[Store] Could not encrypt a credential; storing as entered', error);
    return value;
  }
}

function decryptSecret(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith(CIPHER_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(CIPHER_PREFIX.length), 'base64'));
  } catch (error) {
    // A keystore that cannot decrypt its own output means a different OS user or a
    // restored profile. Better an empty field the user can retype than a crash.
    writeLog('error', 'main', '[Store] Could not decrypt a stored credential', error);
    return '';
  }
}

function mapSecrets<T>(value: T, transform: (secret: unknown) => unknown): T {
  const apply = (entry: unknown): unknown => {
    if (!entry || typeof entry !== 'object') return entry;
    const next: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
    for (const field of SECRET_FIELDS) {
      if (field in next) next[field] = transform(next[field]);
    }
    return next;
  };

  if (Array.isArray(value)) return value.map(apply) as T;
  // The saved draft nests the half-filled connection under `data`.
  if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
    return { ...(value as Record<string, unknown>), data: apply((value as Record<string, unknown>).data) } as T;
  }
  return apply(value) as T;
}

/** Keys whose contents carry credentials. */
const SECRET_BEARING_KEYS = new Set(['connections', 'connectionDraft']);

/**
 * Settings belonging to features that no longer exist. They are dropped on start rather
 * than left to rot: the AI ones carried a live API key and 27 saved agent sessions, and
 * `lastConnection` was a second, plaintext copy of a whole server record — all of it
 * unreachable by any code path that remains.
 */
const RETIRED_STORE_KEYS = [
  'agentSessions',
  'aiProfiles',
  'activeProfileId',
  'agentControlMode',
  'aiPrivacyMode',
  'aiSendShortcut',
  'deployProfiles',
  'deployRuns',
  'lastConnection',
];

function purgeRetiredKeys() {
  const removed = RETIRED_STORE_KEYS.filter((key) => store.has(key));
  if (removed.length === 0) return;
  for (const key of removed) store.delete(key);
  writeLog('info', 'main', `[Store] Removed settings of retired features: ${removed.join(', ')}`);
}

/** Re-writes anything an older build left in plaintext. Runs once at startup. */
function migratePlaintextSecrets() {
  if (!safeStorage.isEncryptionAvailable()) {
    writeLog('warn', 'main', '[Store] OS keystore unavailable; credentials remain as stored');
    return;
  }
  for (const key of SECRET_BEARING_KEYS) {
    const stored = store.get(key);
    if (stored === undefined) continue;
    const encrypted = mapSecrets(stored, encryptSecret);
    if (JSON.stringify(encrypted) !== JSON.stringify(stored)) {
      store.set(key, encrypted);
      writeLog('info', 'main', `[Store] Encrypted credentials in "${key}"`);
    }
  }
}

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

function transferProgress(sender: Electron.WebContents, transferId: string) {
  let lastProgress = -1;
  let lastSentAt = 0;
  return (transferred: number, total: number) => {
    if (sender.isDestroyed()) return;
    const progress = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0;
    const now = Date.now();
    if (progress !== 100 && (progress === lastProgress || now - lastSentAt < 100)) return;
    lastProgress = progress;
    lastSentAt = now;
    sender.send('sftp-transfer-progress', {
      transferId,
      transferred,
      total,
      progress,
    });
  };
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

const PROBE_TIMEOUT_MS = 3000;

/**
 * Latency to the server's SSH port, not an ICMP ping. Plenty of hosts drop ICMP while
 * happily accepting SSH, so a failed ping would say nothing useful — and raw sockets
 * need privileges on some systems. This measures the thing the user actually cares
 * about: how long the TCP handshake to the port they connect on takes.
 */
function probeHost(host: string, port: number): Promise<{ ok: boolean; ms?: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = new net.Socket();

    const finish = (result: { ok: boolean; ms?: number }) => {
      if (settled) return;
      settled = true;
      // Destroyed immediately: the handshake is the measurement, and lingering
      // half-open sockets would sit in the server's unauthenticated connection slots.
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish({ ok: true, ms: Date.now() - started }));
    socket.once('timeout', () => finish({ ok: false }));
    socket.once('error', () => finish({ ok: false }));
    try {
      socket.connect(port, host);
    } catch {
      finish({ ok: false });
    }
  });
}

export function setupIpcHandlers() {
  purgeRetiredKeys();
  migratePlaintextSecrets();

  ipcMain.handle('probe-host', async (_event, target: { host?: string; port?: number }) => {
    const host = String(target?.host ?? '').trim();
    const port = Number(target?.port) || 22;
    // Whitespace would let a caller smuggle a second argument past the socket API.
    if (!host || /\s/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false };
    }
    return probeHost(host, port);
  });

  ipcMain.handle('store-get', (_event, key: string) => {
    assertStoreKey(key);
    const value = store.get(key);
    return SECRET_BEARING_KEYS.has(key) ? mapSecrets(value, decryptSecret) : value;
  });
  ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
    assertStoreKey(key);
    return store.set(key, SECRET_BEARING_KEYS.has(key) ? mapSecrets(value, encryptSecret) : value);
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
  ipcMain.handle('sftp-upload', (event, { id, localPath, remotePath, transferId }) => trackServerOperation(event.sender, () => sshManager.uploadFile(id, localPath, remotePath, transferProgress(event.sender, transferId)), 6));
  ipcMain.handle('sftp-download', (event, { id, remotePath, localPath, transferId }) => trackServerOperation(event.sender, () => sshManager.downloadFile(id, remotePath, localPath, transferProgress(event.sender, transferId)), 6));
  ipcMain.handle('sftp-upload-resume', (event, { id, localPath, remotePath, transferId }) => trackServerOperation(event.sender, () => sshManager.resumeUploadFile(id, localPath, remotePath, transferProgress(event.sender, transferId)), 6));
  ipcMain.handle('sftp-download-resume', (event, { id, remotePath, localPath, transferId }) => trackServerOperation(event.sender, () => sshManager.resumeDownloadFile(id, remotePath, localPath, transferProgress(event.sender, transferId)), 6));
  ipcMain.handle('sftp-delete', (event, { id, path: remotePath }) => trackServerOperation(event.sender, () => sshManager.deleteFile(id, remotePath)));
  ipcMain.handle('sftp-mkdir', (event, { id, path: remotePath }) => trackServerOperation(event.sender, () => sshManager.createFolder(id, remotePath)));
  ipcMain.handle('sftp-rename', (event, { id, oldPath, newPath }) => trackServerOperation(event.sender, () => sshManager.renameFile(id, oldPath, newPath)));
  ipcMain.handle('sftp-read-file', (_event, { id, path: remotePath }) => sshManager.readFile(id, remotePath));
  ipcMain.handle('sftp-write-file', (event, { id, path: remotePath, content, encoding }) => trackServerOperation(event.sender, () => sshManager.writeFile(id, remotePath, content, encoding), 5));

  ipcMain.handle('dialog-open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle('dialog-save', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    return result.canceled ? undefined : result.filePath;
  });
  ipcMain.handle('show-item-in-folder', (_event, filePath: string) => shell.showItemInFolder(filePath));

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

  ipcMain.on('log-write', (_event, { level, message, detail }: { level: LogLevel; message: string; detail?: unknown }) => {
    const safeLevel: LogLevel = level === 'error' || level === 'warn' ? level : 'info';
    writeLog(safeLevel, 'renderer', String(message).slice(0, 2000), detail);
  });
  ipcMain.handle('log-reveal', () => shell.openPath(getLogDirectory()));
  ipcMain.handle('log-path', () => getLogFilePath());
  ipcMain.handle('log-read', (_event, maxLines?: number) => readRecentLog(maxLines));
}
