import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { spawnSync } from 'child_process';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { AppUpdateState } from '../src/shared/update';
import { logger } from './logger';

const RELEASE_API = 'https://api.github.com/repos/Sunhaiy/Reflex/releases/latest';
const RELEASE_PAGE = 'https://github.com/Sunhaiy/Reflex/releases/latest';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type WindowProvider = () => BrowserWindow | null;

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

function cleanVersion(version: string) {
  return version.trim().replace(/^v/i, '').split('+')[0];
}

function compareVersions(left: string, right: string) {
  const parse = (version: string) => cleanVersion(version).split(/[.-]/).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function macHasDeveloperSignature() {
  if (process.platform !== 'darwin' || !app.isPackaged) return process.platform !== 'darwin';
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', process.execPath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const details = `${result.stdout || ''}\n${result.stderr || ''}`;
  return /^Authority=Developer ID Application:/m.test(details)
    || /^Authority=Apple Distribution:/m.test(details);
}

function automaticUpdatesSupported() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return macHasDeveloperSignature();
  return process.platform === 'linux' && Boolean(process.env.APPIMAGE);
}

function preferredManualAsset(assets: GithubAsset[]) {
  if (process.platform === 'darwin') {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    return assets.find(({ name }) => name.endsWith(`-mac-${architecture}.dmg`));
  }
  if (process.platform === 'win32') {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    return assets.find(({ name }) => name.endsWith(`-win-${architecture}.exe`));
  }
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  return assets.find(({ name }) => name.endsWith(`-linux-${architecture}.AppImage`));
}

export function setupAutoUpdater(getWindow: WindowProvider, prepareToQuit: () => void) {
  const automatic = automaticUpdatesSupported();
  let userInitiated = false;
  let installRequested = false;
  let state: AppUpdateState = {
    phase: 'idle',
    currentVersion: app.getVersion(),
    automatic,
  };

  const publish = (patch: Partial<AppUpdateState>) => {
    state = { ...state, ...patch, automatic };
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('update-state', state);
  };

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[Updater] ${message}`);
    if (userInitiated || installRequested) publish({ phase: 'error', error: message, progress: undefined });
    else publish({ phase: 'idle', error: undefined, progress: undefined });
  };

  const checkGithubRelease = async () => {
    const response = await net.fetch(RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Reflex/${app.getVersion()}`,
      },
    });
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status})`);
    const release = await response.json() as GithubRelease;
    const version = cleanVersion(release.tag_name);
    if (compareVersions(version, app.getVersion()) <= 0) {
      publish({ phase: 'up-to-date', availableVersion: undefined, fileName: undefined, downloadUrl: undefined, error: undefined });
      return;
    }
    const asset = preferredManualAsset(release.assets);
    publish({
      phase: 'available',
      availableVersion: version,
      fileName: asset?.name,
      downloadUrl: asset?.browser_download_url || RELEASE_PAGE,
      error: undefined,
    });
  };

  const check = async (manual: boolean) => {
    userInitiated = manual;
    publish({ phase: 'checking', error: undefined, progress: undefined });
    try {
      if (automatic) await autoUpdater.checkForUpdates();
      else await checkGithubRelease();
    } catch (error) {
      fail(error);
    }
  };

  if (automatic) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (message?: unknown) => logger.info(`[Updater] ${String(message ?? '')}`),
      warn: (message?: unknown) => logger.warn(`[Updater] ${String(message ?? '')}`),
      error: (message?: unknown) => logger.error(`[Updater] ${String(message ?? '')}`),
      debug: (message?: unknown) => logger.info(`[Updater] ${String(message ?? '')}`),
    };

    autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', error: undefined }));
    autoUpdater.on('update-available', (info: UpdateInfo) => publish({
      phase: 'available',
      availableVersion: info.version,
      error: undefined,
    }));
    autoUpdater.on('update-not-available', () => publish({
      phase: 'up-to-date',
      availableVersion: undefined,
      progress: undefined,
      error: undefined,
    }));
    autoUpdater.on('download-progress', (progress: ProgressInfo) => publish({
      phase: 'downloading',
      progress: Math.max(0, Math.min(100, progress.percent)),
      error: undefined,
    }));
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      publish({ phase: 'ready', availableVersion: info.version, progress: 100, error: undefined });
      if (!installRequested) return;
      setTimeout(() => {
        prepareToQuit();
        autoUpdater.quitAndInstall(true, true);
      }, 900);
    });
    autoUpdater.on('error', fail);
  }

  ipcMain.handle('update-get-state', () => state);
  ipcMain.handle('update-check', () => check(true));
  ipcMain.handle('update-apply', async () => {
    if (state.phase !== 'available') return false;
    userInitiated = true;
    if (!automatic) {
      await shell.openExternal(state.downloadUrl || RELEASE_PAGE);
      return true;
    }
    installRequested = true;
    publish({ phase: 'downloading', progress: 0, error: undefined });
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  });

  if (app.isPackaged) {
    setTimeout(() => void check(false), 7000);
    setInterval(() => void check(false), CHECK_INTERVAL_MS).unref();
  }
}
