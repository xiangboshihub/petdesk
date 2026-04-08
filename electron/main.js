const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let win;
let monitor;
let mousePassthrough = false;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 240;
  const height = 240;

  win = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + area.width - width - 24),
    y: Math.round(area.y + area.height - height - 40),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(path.join(__dirname, "renderer", "cat.html"));
}

function setMousePassthrough(ignore) {
  if (!win || mousePassthrough === ignore) return;
  mousePassthrough = ignore;
  if (ignore) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
  }
}

function startMonitor() {
  const helperPath = path.join(__dirname, "..", "build", "key-monitor");
  monitor = spawn(helperPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  monitor.on("error", (err) => {
    console.error("Failed to start key-monitor:", err?.message || err);
  });

  monitor.stdout.on("data", (buf) => {
    const lines = buf.toString("utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (line === "typing" || line === "idle") {
        win?.webContents.send("cat-state", line);
      }
    }
  });

  monitor.stderr.on("data", (buf) => {
    const text = buf.toString("utf8").trim();
    if (text) console.error(text);
  });

  monitor.on("exit", (code, signal) => {
    if (code || signal) {
      console.error(`key-monitor exited (code=${code}, signal=${signal})`);
    }
  });
}

app.whenReady().then(() => {
  app.dock.hide();
  createWindow();
  startMonitor();
});

ipcMain.handle("quit-app", () => {
  app.quit();
});

ipcMain.handle("drag-window", (_event, deltaX, deltaY) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
});

ipcMain.handle("set-mouse-passthrough", (_event, ignore) => {
  setMousePassthrough(Boolean(ignore));
});

app.on("before-quit", () => {
  if (monitor) {
    monitor.kill();
    monitor = null;
  }
});
