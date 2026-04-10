const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onCatState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("cat-state", handler);
    return () => ipcRenderer.removeListener("cat-state", handler);
  },
  onMarketSnapshot: (callback) => {
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("market-snapshot", handler);
    return () => ipcRenderer.removeListener("market-snapshot", handler);
  },
  onMarketAlert: (callback) => {
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("market-alert", handler);
    return () => ipcRenderer.removeListener("market-alert", handler);
  },
  getMarketSnapshot: () => ipcRenderer.invoke("get-market-snapshot"),
  toggleBubbleMode: () => ipcRenderer.invoke("toggle-bubble-mode"),
  toggleBubbleVisible: () => ipcRenderer.invoke("toggle-bubble-visible"),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  dragWindow: (deltaX, deltaY) => ipcRenderer.invoke("drag-window", deltaX, deltaY),
  setMousePassthrough: (ignore) => ipcRenderer.invoke("set-mouse-passthrough", ignore),
});
