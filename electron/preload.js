const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onCatState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("cat-state", handler);
    return () => ipcRenderer.removeListener("cat-state", handler);
  },
  quitApp: () => ipcRenderer.invoke("quit-app"),
  dragWindow: (deltaX, deltaY) => ipcRenderer.invoke("drag-window", deltaX, deltaY),
  setMousePassthrough: (ignore) => ipcRenderer.invoke("set-mouse-passthrough", ignore),
});
