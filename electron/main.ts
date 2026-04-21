import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { restoreBackgroundAgentSessions, setupIpcHandlers } from './ipcHandlers';

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
let backgroundRestoreScheduled = false;

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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'fullscreen-ui',
    icon: appIconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:3002');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
  mainWindow.maximize();

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.setSkipTaskbar(true);
    mainWindow?.hide();
  });

  mainWindow.on('show', () => {
    mainWindow?.setSkipTaskbar(false);
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (backgroundRestoreScheduled) return;
    backgroundRestoreScheduled = true;
    setTimeout(() => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        restoreBackgroundAgentSessions(mainWindow.webContents);
      }
    }, 1500);
  });
};

function createTrayIcon() {
  const iconPath = getRuntimeAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png');
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
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
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
  // Keep the app and background agent alive even when every window is hidden.
});
