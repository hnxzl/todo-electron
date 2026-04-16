'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window Controls
  minimize:   () => ipcRenderer.send('window-minimize'),
  close:      () => ipcRenderer.send('window-close'),
  togglePin:  () => ipcRenderer.send('window-toggle-pin'),

  onPinStatusChanged: (callback) => {
    ipcRenderer.on('pin-status-changed', (_event, isPinned) => callback(isPinned));
  },
  removePinListener: () => ipcRenderer.removeAllListeners('pin-status-changed'),

  // Fetch URL via main process (bypass CORS untuk holiday API)
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),

  // Buka URL di browser default sistem
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
