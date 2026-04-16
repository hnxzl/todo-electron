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
} = require("electron");
const path = require("path");

// Optimasi memori
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128");

let mainWindow = null;
let tray = null;
let isAlwaysOnTop = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="10" y="12" width="44" height="42" rx="10" fill="#0F172A"/>
      <rect x="10" y="12" width="44" height="14" rx="10" fill="#2563EB"/>
      <rect x="18" y="34" width="10" height="10" rx="2" fill="#E2E8F0"/>
      <rect x="32" y="34" width="10" height="10" rx="2" fill="#E2E8F0"/>
      <path d="M22 6v10M42 6v10" stroke="#E2E8F0" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
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
    { label: "Keluar", click: () => app.quit() },
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
      backgroundThrottling: false,
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
// App Events
// ========================

app.whenReady().then(createWindow);
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
