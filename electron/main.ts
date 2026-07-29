import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { setupIpcHandlers } from './ipcHandlers';

// Prevent third-party crashes from killing the whole Electron process.
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception (non-fatal):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection (non-fatal):', reason);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const DEV_SERVER_URL = 'http://127.0.0.1:3002';
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

const createWindow = () => {
  const preloadPath = path.join(__dirname, 'preload.js');
  const appIconPath = getRuntimeAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const supportsTransparency = process.platform === 'darwin';

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
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
    },
  });
  mainWindow = window;

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Main] Renderer load failed (${errorCode}): ${errorDescription} - ${validatedURL}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Renderer process exited:', details.reason);
  });

  window.on('unresponsive', () => {
    console.error('[Main] Window became unresponsive');
  });

  window.webContents.once('did-finish-load', () => {
    revealWindow(window);
  });

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

function revealWindow(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.setSkipTaskbar(false);
  if (process.platform === 'win32') {
    // Windows can reject focus requests from a process spawned behind a terminal.
    // Briefly promote the window, then immediately restore normal z-order behavior.
    window.setAlwaysOnTop(true);
  }
  window.maximize();
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
    return nativeImage.createFromPath(getRuntimeAssetPath('logo.png')).resize({ width: 16, height: 16 });
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
  ipcMain.handle('open-external', async (_event, url: string) => shell.openExternal(url));
  createTray();
  createWindow();

  app.on('activate', () => {
    showMainWindow();
  });

  ipcMain.handle('get-version', () => app.getVersion());
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Keep the tray app alive when every window is hidden.
});
