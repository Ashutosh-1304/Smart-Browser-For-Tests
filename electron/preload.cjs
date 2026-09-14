// ---------------------------------------------------------------------------
// PRELOAD script — the ONLY bridge between the sandboxed renderer and Electron.
// Exposes a tiny, safe `window.electronAPI` (contextIsolation stays ON).
// ---------------------------------------------------------------------------
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Subscribe to OS window events (focus/blur/minimize/fullscreen).
  // Returns an unsubscribe function.
  onWindowEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('window-event', listener);
    return () => ipcRenderer.removeListener('window-event', listener);
  },
  // Ask the main process to enter/exit real OS fullscreen.
  toggleFullscreen: (enable) => ipcRenderer.invoke('toggle-fullscreen', enable),
  // Verify test code from codes.json
  verifyCode: (code) => ipcRenderer.invoke('verify-code', code),
});
