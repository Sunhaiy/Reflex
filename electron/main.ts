import { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { getStore, setupIpcHandlers } from './ipcHandlers';
import { flushLogSync, logger } from './logger';

// Prevent third-party crashes from killing the whole Electron process.
process.on('uncaughtException', (err) => {
  logger.error('[Main] Uncaught exception (non-fatal)', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[Main] Unhandled rejection (non-fatal)', reason);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const DEV_SERVER_URL = 'http://127.0.0.1:3002';
const WINDOW_STATE_KEY = 'windowState';
const DEFAULT_WINDOW_SIZE = { width: 1200, height: 800 };
const MIN_WINDOW_SIZE = { width: 720, height: 480 };

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

function isPositionOnScreen(x: number, y: number, width: number, height: number) {
  // A monitor that is no longer attached would otherwise strand the window off-screen.
  return screen.getAllDisplays().some(({ workArea }) =>
    x + width > workArea.x
    && y + height > workArea.y
    && x < workArea.x + workArea.width
    && y < workArea.y + workArea.height);
}

function readWindowState(): WindowState {
  const saved = getStore().get(WINDOW_STATE_KEY) as Partial<WindowState> | undefined;
  const width = Math.max(MIN_WINDOW_SIZE.width, Math.round(Number(saved?.width) || DEFAULT_WINDOW_SIZE.width));
  const height = Math.max(MIN_WINDOW_SIZE.height, Math.round(Number(saved?.height) || DEFAULT_WINDOW_SIZE.height));
  const x = Number.isFinite(saved?.x) ? Math.round(saved!.x!) : undefined;
  const y = Number.isFinite(saved?.y) ? Math.round(saved!.y!) : undefined;
  const onScreen = x !== undefined && y !== undefined && isPositionOnScreen(x, y, width, height);

  return {
    width,
    height,
    x: onScreen ? x : undefined,
    y: onScreen ? y : undefined,
    // First run opens maximized; after that the last state wins.
    maximized: saved?.maximized ?? true,
  };
}

function trackWindowState(window: BrowserWindow) {
  let saveTimer: NodeJS.Timeout | undefined;

  const save = () => {
    if (window.isDestroyed()) return;
    const maximized = window.isMaximized();
    // getNormalBounds reports the restored size even while maximized, so un-maximising
    // later returns to the size the user actually chose.
    const bounds = window.getNormalBounds();
    getStore().set(WINDOW_STATE_KEY, {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    } satisfies WindowState);
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    save();
  });
}
const DEV_SERVER_RETRY_COUNT = 40;
const DEV_SERVER_RETRY_DELAY_MS = 250;

app.setName('Reflex');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.reflex.app');
}

export function getMainWindow() {
  return mainWindow;
}

function getRuntimeAssetPath(fileName: string) {
  const appRoot = path.join(__dirname, '../..');
  const candidates = [
    path.join(appRoot, 'dist', fileName),
    path.join(appRoot, 'public', fileName),
    path.join(appRoot, fileName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

async function openExternalUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Blocked unsupported external URL protocol: ${parsed.protocol}`);
  }
  await shell.openExternal(parsed.toString());
}

const createWindow = () => {
  const preloadPath = path.join(__dirname, 'preload.js');
  const appIconPath = getRuntimeAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const supportsTransparency = process.platform === 'darwin';

  const windowState = readWindowState();

  const window = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: supportsTransparency,
    backgroundColor: supportsTransparency ? '#00000000' : '#080808',
    vibrancy: supportsTransparency ? 'fullscreen-ui' : undefined,
    icon: appIconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  // Maximising happens here, while the window is still hidden and before the renderer
  // has loaded, so it only ever paints at its final size. Doing it at reveal time meant
  // the page rendered at the smaller size first and the resize flashed black.
  if (windowState.maximized) window.maximize();
  trackWindowState(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch((error) => console.warn('[Main] Blocked external window:', error));
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('file:') : url.startsWith(DEV_SERVER_URL);
    if (allowed) return;
    event.preventDefault();
    void openExternalUrl(url).catch((error) => console.warn('[Main] Blocked renderer navigation:', error));
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.warn(`[Main] Renderer load failed (${errorCode}): ${errorDescription} - ${validatedURL}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[Main] Renderer process exited', details);
  });

  window.on('unresponsive', () => {
    logger.error('[Main] Window became unresponsive');
  });

  // `ready-to-show` fires once the renderer has painted its first frame, while
  // `did-finish-load` waits for every subresource. With a stylesheet carrying hundreds
  // of @font-face rules that gap is the difference between the cover appearing at once
  // and the user staring at nothing. Whichever lands first wins; the other is ignored.
  let revealed = false;
  const revealOnce = () => {
    if (revealed) return;
    revealed = true;
    revealWindow(window);
  };
  window.once('ready-to-show', revealOnce);
  window.webContents.once('did-finish-load', revealOnce);

  void loadRenderer(window).catch((error) => {
    console.error('[Main] Unable to load renderer:', error);
    revealWindow(window);
  });

  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.setSkipTaskbar(true);
    window.hide();
  });

  window.on('show', () => {
    window.setSkipTaskbar(false);
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
};

// Geometry is settled at creation time from the saved state, so revealing never
// resizes anything — this only brings an existing window forward.
function revealWindow(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.setSkipTaskbar(false);
  if (process.platform === 'win32') {
    // Windows can reject focus requests from a process spawned behind a terminal.
    // Briefly promote the window, then immediately restore normal z-order behavior.
    window.setAlwaysOnTop(true);
  }
  window.show();
  app.focus();
  window.focus();
  window.moveTop();
  if (process.platform === 'win32') {
    setTimeout(() => {
      if (!window.isDestroyed()) window.setAlwaysOnTop(false);
    }, 300);
  }
}

async function loadRenderer(window: BrowserWindow) {
  if (app.isPackaged) {
    await window.loadFile(path.join(__dirname, '../../dist/index.html'));
    return;
  }

  for (let attempt = 1; attempt <= DEV_SERVER_RETRY_COUNT; attempt += 1) {
    if (window.isDestroyed()) return;
    try {
      await window.loadURL(DEV_SERVER_URL);
      return;
    } catch (error) {
      if (attempt === DEV_SERVER_RETRY_COUNT) throw error;
      await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_RETRY_DELAY_MS));
    }
  }
}

function createTrayIcon() {
  const iconPath = process.platform === 'win32'
    ? getRuntimeAssetPath('tray-icon.png')
    : getRuntimeAssetPath('icon.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    return nativeImage.createFromPath(getRuntimeAssetPath('tray-icon.png')).resize({ width: 16, height: 16 });
  }
  const traySize = process.platform === 'darwin' ? 18 : 16;
  return image.resize({ width: traySize, height: traySize });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  revealWindow(mainWindow);
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Reflex is running');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Reflex',
      click: () => showMainWindow(),
    },
    {
      label: 'Quit Reflex',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow());
}

app.whenReady().then(() => {
  setupIpcHandlers();
  ipcMain.handle('open-external', async (_event, url: string) => openExternalUrl(url));
  createTray();
  createWindow();

  app.on('activate', () => {
    showMainWindow();
  });

  ipcMain.handle('get-version', () => app.getVersion());
});

app.on('before-quit', () => {
  isQuitting = true;
  flushLogSync();
});

app.on('window-all-closed', () => {
  // Keep the tray app alive when every window is hidden.
});
