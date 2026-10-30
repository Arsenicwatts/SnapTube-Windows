const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const engine = require('./engine');

let mainWindow = null;
const activeDownloads = new Map();

// ─── Settings Persistence ───────────────────────────────────────────────────

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const defaultSettings = {
    downloadPath: path.join(os.homedir(), 'Downloads', 'SnapTube'),
    browserCookies: 'none'
  };
  try {
    const file = getSettingsFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // Chromium browsers (chrome, edge, brave) on Windows use App-Bound DPAPI encryption which yt-dlp cannot decrypt.
      // Auto-migrate to 'none' (direct mode) so extractions succeed smoothly without DPAPI errors.
      if (['chrome', 'edge', 'brave'].includes(data.browserCookies)) {
        data.browserCookies = 'none';
        try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {}
      }
      return { ...defaultSettings, ...data };
    }
  } catch (e) {}
  return defaultSettings;
}

function saveSettings(newSettings) {
  try {
    const current = loadSettings();
    const updated = { ...current, ...newSettings };
    fs.writeFileSync(getSettingsFilePath(), JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return loadSettings();
  }
}

// ─── Window Creation ────────────────────────────────────────────────────────

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);

  if (process.argv.includes('--test')) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('MAIN_TEST_PASSED: App initialized cleanly!');
      setTimeout(() => app.quit(), 1500);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ─── Window Controls IPC ────────────────────────────────────────────────────

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());

// ─── Settings IPC ───────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, newSettings) => saveSettings(newSettings));

ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.filePaths[0]) {
    saveSettings({ downloadPath: result.filePaths[0] });
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-default-download-path', () => {
  const settings = loadSettings();
  if (!fs.existsSync(settings.downloadPath)) {
    try { fs.mkdirSync(settings.downloadPath, { recursive: true }); } catch (e) {}
  }
  return settings.downloadPath;
});

// ─── Search & Video Info IPC ────────────────────────────────────────────────

ipcMain.handle('search-videos', async (event, query) => {
  return await engine.searchVideos(query);
});

ipcMain.handle('get-video-info', async (event, url) => {
  const currentSettings = loadSettings();
  return await engine.getVideoInfo(url, currentSettings.browserCookies || null);
});

ipcMain.handle('get-suggestions', async (event, query) => {
  return await engine.getSuggestions(query);
});

// ─── Download Management IPC ────────────────────────────────────────────────

ipcMain.handle('start-download', async (event, { id, url, preset, outputDir }) => {
  const downloadId = id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
  const currentSettings = loadSettings();
  const targetDir = outputDir || currentSettings.downloadPath || path.join(os.homedir(), 'Downloads', 'SnapTube');
  const cookiesBrowser = currentSettings.browserCookies || null;

  const proc = engine.startDownload({
    url,
    preset,
    targetDir,
    cookiesBrowser,
    onProgress: (progress) => {
      mainWindow?.webContents.send('download-progress', {
        id: downloadId,
        ...progress
      });
    },
    onComplete: (result) => {
      activeDownloads.delete(downloadId);
      mainWindow?.webContents.send('download-complete', {
        id: downloadId,
        ...result
      });
    },
    onError: (errMessage) => {
      activeDownloads.delete(downloadId);
      mainWindow?.webContents.send('download-error', {
        id: downloadId,
        error: errMessage
      });
    }
  });

  activeDownloads.set(downloadId, { proc, url, preset, targetDir });
  return downloadId;
});

ipcMain.handle('cancel-download', (event, downloadId) => {
  const dl = activeDownloads.get(downloadId);
  if (dl) {
    try { dl.proc.kill(); } catch (e) {}
    activeDownloads.delete(downloadId);
    return true;
  }
  return false;
});

// ─── Filesystem Helpers IPC ─────────────────────────────────────────────────

ipcMain.handle('open-folder', (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('open-file', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.openPath(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('show-in-folder', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('open-url', (event, url) => {
  if (url) shell.openExternal(url);
});

// ─── Engine Status & Diagnostics ────────────────────────────────────

ipcMain.handle('check-ytdlp', async () => {
  const ytdlp = engine.getYtDlpPath();
  const ffmpeg = engine.getFfmpegPath();
  return {
    available: true,
    ytdlpPath: ytdlp || 'yt-dlp (System / Python)',
    ffmpegPath: ffmpeg || 'FFmpeg Static'
  };
});

ipcMain.handle('update-ytdlp', async () => {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const ytdlp = engine.getYtDlpPath();
    const proc = spawn(ytdlp || 'yt-dlp', ['--update'], { windowsHide: true });
    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', () => resolve(output || 'yt-dlp update check completed.'));
    proc.on('error', err => reject(err.message));
  });
});
