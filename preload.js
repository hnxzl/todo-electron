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

  // Notifikasi via Main Process
  showNotification: ({ title, body }) => ipcRenderer.send('show-notification', { title, body }),

  // Sticky Notes (Papan Tulis)
  createSticky: (data) => ipcRenderer.send('create-sticky', data),
  onStickyUpdate: (callback) => ipcRenderer.on('sync-sticky-update', (_event, data) => callback(data)),
});
