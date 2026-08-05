import { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { getStore, setupIpcHandlers } from './ipcHandlers';
import { flushLogSync, logger } from './logger';
import { setupAutoUpdater } from './updater';

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
const MIN_WINDOW_SIZE = { width: 720, height: 480 };
/** Upper bound on the medium size, so a 4K display does not get a 2700px window. */
const MEDIUM_WINDOW_MAX = { width: 1600, height: 1000 };

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

/** Work area of whichever display the window was last on. */
function workAreaFor(x: number | undefined, y: number | undefined, width: number, height: number) {
  const display = x !== undefined && y !== undefined
    ? screen.getDisplayMatching({ x, y, width, height })
    : screen.getPrimaryDisplay();
  return display.workArea;
}

function isPositionOnScreen(x: number, y: number, width: number, height: number) {
  // A monitor that is no longer attached would otherwise strand the window off-screen.
  return screen.getAllDisplays().some(({ workArea }) =>
    x + width > workArea.x
    && y + height > workArea.y
    && x < workArea.x + workArea.width
    && y < workArea.y + workArea.height);
}

/**
 * The size the window takes when it is not maximized and the user has not chosen one
 * yet. Proportional to the display rather than a fixed figure, so it stays genuinely
 * medium on a laptop panel and on a large monitor alike.
 */
function mediumSize(area: { width: number; height: number }) {
  return {
    width: Math.round(Math.min(MEDIUM_WINDOW_MAX.width, Math.max(MIN_WINDOW_SIZE.width, area.width * 0.72))),
    height: Math.round(Math.min(MEDIUM_WINDOW_MAX.height, Math.max(MIN_WINDOW_SIZE.height, area.height * 0.78))),
  };
}

function readWindowState(): WindowState {
  const saved = getStore().get(WINDOW_STATE_KEY) as Partial<WindowState> | undefined;
  const savedWidth = Number(saved?.width);
  const savedHeight = Number(saved?.height);
  let x = Number.isFinite(saved?.x) ? Math.round(saved!.x!) : undefined;
  let y = Number.isFinite(saved?.y) ? Math.round(saved!.y!) : undefined;

  const probe = workAreaFor(x, y, savedWidth || MIN_WINDOW_SIZE.width, savedHeight || MIN_WINDOW_SIZE.height);
  const medium = mediumSize(probe);
  let width = Math.max(MIN_WINDOW_SIZE.width, Math.round(savedWidth || medium.width));
  let height = Math.max(MIN_WINDOW_SIZE.height, Math.round(savedHeight || medium.height));

  const area = workAreaFor(x, y, width, height);

  // A restored size that fills the work area carries no information — covering the
  // screen is precisely what "maximized" already records. Earlier builds wrote the
  // synthetic startup geometry into this field, which left the restore button handing
  // back a near-fullscreen window, so anything that large is discarded.
  if (width >= area.width * 0.97 && height >= area.height * 0.97) {
    const fallback = mediumSize(area);
    width = fallback.width;
    height = fallback.height;
    x = undefined;
    y = undefined;
  }

  if (x !== undefined && y !== undefined && !isPositionOnScreen(x, y, width, height)) {
    x = undefined;
    y = undefined;
  }

  // First run opens maximized; after that the last state wins.
  return { width, height, x, y, maximized: saved?.maximized ?? true };
}

/**
 * Persists geometry, keeping the restored size distinct from the maximized one.
 *
 * Tracking deliberately does not begin until the window is on screen. It opens at the
 * work area size so the renderer paints at its final dimensions, and treating that
 * synthetic geometry as a size the user chose is what overwrote their real one.
 */
function trackWindowState(window: BrowserWindow, initial: WindowState) {
  let saveTimer: NodeJS.Timeout | undefined;
  let normal = { width: initial.width, height: initial.height, x: initial.x, y: initial.y };
  let tracking = false;

  const save = () => {
    if (window.isDestroyed()) return;
    getStore().set(WINDOW_STATE_KEY, {
      ...normal,
      maximized: window.isMaximized(),
    } satisfies WindowState);
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };

  const onGeometryChange = () => {
    if (window.isDestroyed()) return;
    if (tracking && !window.isMaximized() && !window.isMinimized() && !window.isFullScreen()) {
      const bounds = window.getBounds();
      normal = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
    }
    scheduleSave();
  };

  window.on('resize', onGeometryChange);
  window.on('move', onGeometryChange);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', onGeometryChange);
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    save();
  });

  return {
    /** Enabled once the startup geometry has settled, so later changes are the user's. */
    beginTracking: () => { tracking = true; },
    normalBounds: () => ({ ...normal }),
  };
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

  const windowState = readWindowState();
  // Opening straight at the work area means the renderer paints at its final size, so
  // maximising later is a state change with no reflow behind it. maximize() itself has
  // to wait: it shows the window as a side effect, which would defeat `show: false`.
  const workArea = workAreaFor(windowState.x, windowState.y, windowState.width, windowState.height);
  const startBounds = windowState.maximized ? workArea : windowState;

  const window = new BrowserWindow({
    width: startBounds.width,
    height: startBounds.height,
    x: startBounds.x,
    y: startBounds.y,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    frame: false,
    // Keep the native window opaque on every platform. macOS previously combined a
    // transparent BrowserWindow, fullscreen vibrancy and CSS backdrop filters, forcing
    // the compositor to blur the whole desktop whenever terminal or monitor data moved.
    transparent: false,
    backgroundColor: '#080808',
    icon: appIconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  // Reflex owns the title bar on every platform. `frame: false` removes the frame, and
  // this explicit macOS call also prevents traffic lights from reappearing after a
  // fullscreen/restore transition. The React controls remain at the top right.
  if (process.platform === 'darwin') window.setWindowButtonVisibility(false);

  const tracker = trackWindowState(window, windowState);

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

  // `ready-to-show` fires on the renderer's very first paint, which is the empty
  // root element — revealing there showed a black window that then filled in, and the
  // wordmark swapped typeface a moment later. Instead the renderer says when the cover
  // has actually painted with its fonts resolved. `did-finish-load` and a hard timeout
  // are only failsafes: a renderer that errors must never leave the window invisible.
  let revealed = false;
  const revealOnce = () => {
    if (revealed) return;
    revealed = true;
    clearTimeout(revealFailsafe);
    ipcMain.removeListener('renderer-first-frame', onFirstFrame);
    if (windowState.maximized && !window.isMaximized()) {
      window.maximize();
      // Electron treats whatever we opened at — the work area — as the restored size,
      // so hand back the saved one the first time the window is un-maximised. Centred
      // when no position was stored, rather than skipped as it was before.
      window.once('unmaximize', () => {
        if (window.isDestroyed()) return;
        const target = tracker.normalBounds();
        const area = workAreaFor(target.x, target.y, target.width, target.height);
        window.setBounds({
          width: target.width,
          height: target.height,
          x: target.x ?? Math.round(area.x + (area.width - target.width) / 2),
          y: target.y ?? Math.round(area.y + (area.height - target.height) / 2),
        });
      });
    }
    revealWindow(window);
    // The maximize above emits its own resize burst; only what follows is the user.
    setTimeout(() => tracker.beginTracking(), 600);
  };
  const onFirstFrame = (event: Electron.IpcMainEvent) => {
    if (event.sender === window.webContents) revealOnce();
  };
  ipcMain.on('renderer-first-frame', onFirstFrame);
  const revealFailsafe = setTimeout(revealOnce, 5000);
  window.webContents.once('did-finish-load', () => setTimeout(revealOnce, 1500));

  void loadRenderer(window).catch((error) => {
    console.error('[Main] Unable to load renderer:', error);
    // Through revealOnce, not revealWindow, so the failsafe timer and the IPC listener
    // are torn down too.
    revealOnce();
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
  setupAutoUpdater(
    () => mainWindow,
    () => { isQuitting = true; },
  );

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
