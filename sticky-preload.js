const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stickyAPI", {
  onInitData: (callback) =>
    ipcRenderer.on("init-sticky-data", (_event, data) => callback(data)),
  updateContent: (id, text, color) =>
    ipcRenderer.send("update-sticky", { id, text, color }),
  closeSticky: () => ipcRenderer.send("close-sticky"),
  togglePin: () => ipcRenderer.send("sticky-toggle-pin"),
  onPinStatusChanged: (callback) =>
    ipcRenderer.on("sticky-pin-status-changed", (_event, isPinned) =>
      callback(isPinned),
    ),
});
