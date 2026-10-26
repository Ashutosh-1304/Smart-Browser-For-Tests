const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onWindowEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('window-event', listener);
    return () => ipcRenderer.removeListener('window-event', listener);
  },
  toggleFullscreen: (enable) => ipcRenderer.invoke('toggle-fullscreen', enable),
});
