const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronNotification', {
  onNotificationData: (callback) => {
    ipcRenderer.on('notification-data', (_event, data) => callback(data));
  },
  closeNotification: () => ipcRenderer.send('close-notification'),
  clickNotification: () => ipcRenderer.send('click-notification')
});
