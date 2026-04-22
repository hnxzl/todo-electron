"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  net,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
} = require("electron");
const path = require("path");

// Penghematan memori
app.commandLine.appendSwitch(
  "js-flags",
  "--max-old-space-size=64 --optimize-for-size --gc-interval=100",
);
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch(
  "disable-features",
  "SpareRendererForSitePerProcess",
);

let mainWindow = null;
let tray = null;
let isAlwaysOnTop = false;

function applyStickyAlwaysOnTop(win, isPinned) {
  if (!win || win.isDestroyed()) return;
  // Use a stronger top level so sticky remains above normal windows.
  win.setAlwaysOnTop(!!isPinned, isPinned ? "screen-saver" : "normal");
  win.setVisibleOnAllWorkspaces(!!isPinned, { visibleOnFullScreen: true });
}

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, "icon.png"));
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindowToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
}

function createTray() {
  if (tray) return tray;

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Tododo");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Buka Tododo", click: () => showWindow() },
    { label: "Sembunyikan", click: () => hideWindowToTray() },
    { type: "separator" },
    {
      label: "Keluar",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => showWindow());
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      showWindow();
    }
  });

  return tray;
}

function createWindow() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    x: Math.floor((screenWidth - 1100) / 2),
    y: Math.floor((screenHeight - 720) / 2),
    frame: false,
    transparent: false,
    resizable: true,
    backgroundColor: "#EEF4FB",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    createTray();
    mainWindow.show();
  });

  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    hideWindowToTray();
  });

  mainWindow.on("close", (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    hideWindowToTray();
  });

  mainWindow.loadFile("index.html");

  // Cegah drag & drop file membuka gambar seperti galeri
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // Hanya izinkan navigasi ke file:// index.html
    if (!url.includes("index.html")) {
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ========================
// IPC: Window Controls
// ========================

ipcMain.on("window-minimize", () => {
  hideWindowToTray();
});
ipcMain.on("window-close", () => {
  hideWindowToTray();
});
ipcMain.on("window-show", () => {
  showWindow();
});
ipcMain.on("app-quit", () => {
  app.isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
});

ipcMain.on("window-toggle-pin", (event) => {
  if (!mainWindow) return;
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, "floating");
  event.reply("pin-status-changed", isAlwaysOnTop);
});

// ========================
// IPC: Notifications
// ========================

let notificationWindow = null;

ipcMain.on("show-notification", (event, { title, body }) => {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.close();
  }

  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  const notifWidth = 360;
  const notifHeight = 120;

  notificationWindow = new BrowserWindow({
    width: notifWidth,
    height: notifHeight,
    x: screenWidth - notifWidth - 20,
    y: screenHeight - notifHeight - 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "notification-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notificationWindow.loadFile("notification.html");

  notificationWindow.once("ready-to-show", () => {
    notificationWindow.showInactive();
    notificationWindow.webContents.send("notification-data", { title, body });
  });

  setTimeout(() => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
  }, 7000);
});

ipcMain.on("close-notification", () => {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.close();
  }
});

ipcMain.on("click-notification", () => {
  showWindow();
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.close();
  }
});

// Buka URL di browser default
ipcMain.on("open-external", (_event, url) => {
  if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
    shell.openExternal(url);
  }
});

// ========================
// IPC: Fetch URL via Main Process
// Tujuan: hindari CORS saat fetch holiday API dari renderer
// ========================

ipcMain.handle("fetch-url", async (event, url) => {
  return new Promise((resolve) => {
    try {
      const request = net.request({ url, method: "GET" });
      let data = "";

      request.on("response", (response) => {
        response.on("data", (chunk) => {
          data += chunk.toString();
        });
        response.on("end", () => {
          try {
            resolve({ ok: true, data: JSON.parse(data) });
          } catch {
            resolve({ ok: false, data: null });
          }
        });
        response.on("error", () => resolve({ ok: false, data: null }));
      });

      request.on("error", () => resolve({ ok: false, data: null }));
      request.end();
    } catch {
      resolve({ ok: false, data: null });
    }
  });
});

// ========================
// IPC: Sticky Notes (Papan Tulis)
// ========================

const activeStickies = {}; // { windowId: { id, window } }

ipcMain.on("create-sticky", (event, data) => {
  // Jika sticky dengan id yang sama sudah punya window, fokuskan
  for (const winId in activeStickies) {
    if (activeStickies[winId].id === data.id) {
      const win = activeStickies[winId].window;
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
        return;
      }
    }
  }

  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  const stickyWin = new BrowserWindow({
    width: 220,
    height: 220,
    minWidth: 150,
    minHeight: 150,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "sticky-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      affinity: "sticky-notes",
      spellcheck: false,
    },
  });

  // Cegah drag & drop gambar membuka gambar seperti galeri dan me-replace window
  stickyWin.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  stickyWin.loadFile("sticky.html");

  stickyWin.once("ready-to-show", () => {
    applyStickyAlwaysOnTop(stickyWin, true);
    stickyWin.show();
    stickyWin.webContents.send("init-sticky-data", data);
    stickyWin.webContents.send("sticky-pin-status-changed", true);
  });

  activeStickies[stickyWin.id] = { id: data.id, window: stickyWin };

  stickyWin.on("closed", () => {
    delete activeStickies[stickyWin.id];
  });
});

ipcMain.on("update-sticky", (event, data) => {
  // Broadcast update kembali ke renderer utama agar disimpan secara persisten
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sync-sticky-update", data);
  }
});

ipcMain.on("close-sticky", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin && !senderWin.isDestroyed()) {
    senderWin.close();
  }
});

ipcMain.on("sticky-toggle-pin", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (!senderWin || senderWin.isDestroyed()) return;

  const nextPinned = !senderWin.isAlwaysOnTop();
  applyStickyAlwaysOnTop(senderWin, nextPinned);
  event.reply("sticky-pin-status-changed", nextPinned);
});

// ========================
// App Events
// ========================

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("Tododo");
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    showWindow();
  }
});
