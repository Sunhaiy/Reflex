import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { setupIpcHandlers } from './ipcHandlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// if (require('electron-squirrel-startup')) {
//   app.quit();
// }

// app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;

export function getMainWindow() {
  return mainWindow;
}

const createWindow = () => {
  // Preload path resolution
  // In dev: ./electron/preload.ts -> compiled to dist-electron/preload.js
  // In prod: ./resources/app/dist-electron/preload.js
  const preloadPath = path.join(__dirname, 'preload.js');

  console.log('Main Process Starting...');
  console.log('Preload Path:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Frameless window
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'fullscreen-ui', // macOS
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:3002');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Test IPC handler
  ipcMain.handle('get-version', () => app.getVersion());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
