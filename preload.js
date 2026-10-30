const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  
  // Search and info
  searchVideos: (query) => ipcRenderer.invoke('search-videos', query),
  getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
  getSuggestions: (query) => ipcRenderer.invoke('get-suggestions', query),
  
  // Download
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  getDefaultDownloadPath: () => ipcRenderer.invoke('get-default-download-path'),
  startDownload: (options) => ipcRenderer.invoke('start-download', options),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  openFile: (path) => ipcRenderer.invoke('open-file', path),
  showInFolder: (path) => ipcRenderer.invoke('show-in-folder', path),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  
  // Settings & Proxy
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // yt-dlp management
  checkYtDlp: () => ipcRenderer.invoke('check-ytdlp'),
  updateYtDlp: () => ipcRenderer.invoke('update-ytdlp'),
  
  // Events
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_, data) => callback(data));
  },
  onDownloadComplete: (callback) => {
    ipcRenderer.on('download-complete', (_, data) => callback(data));
  },
  onDownloadError: (callback) => {
    ipcRenderer.on('download-error', (_, data) => callback(data));
  }
});
