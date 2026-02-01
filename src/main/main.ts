import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { setupIpcHandlers } from './ipcHandlers.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Custom frame
    titleBarStyle: 'hidden', // Hide default title bar but keep window controls on macOS (we handle them manually usually, but for Windows frame: false is key)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('Preload error:', preloadPath, error);
  });

  console.log('Preload path:', path.join(__dirname, 'preload.js'));

  // Load the index.html of the app.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, main.js is in dist-electron/main/main.js
    // index.html is in dist/index.html
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
