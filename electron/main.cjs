const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const os = require('os');

const isDev = !app.isPackaged;
const DEV_URL = 'http://127.0.0.1:5173';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'camera', 'microphone', 'audioCapture', 'videoCapture'];
    callback(allowed.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [level:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Electron] Page failed to load ${validatedURL} (${errorCode}: ${errorDescription}). Retrying in 1s...`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(DEV_URL);
      }
    }, 1000);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Electron] Page loaded successfully.');
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i') || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  const revealWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  setTimeout(revealWindow, 1500);

  const send = (type) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-event', { type, at: Date.now() });
    }
  };

  mainWindow.on('focus', () => send('focus'));
  mainWindow.on('blur', () => send('blur'));
  mainWindow.on('minimize', () => send('minimize'));
  mainWindow.on('restore', () => send('restore'));
  mainWindow.on('enter-full-screen', () => send('enter-full-screen'));
  mainWindow.on('leave-full-screen', () => send('leave-full-screen'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('toggle-fullscreen', (_event, enable) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!!enable);
    return mainWindow.isFullScreen();
  }
  return false;
});

ipcMain.handle('get-system-info', () => {
  let localIp = '127.0.0.1';
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
    }
  } catch {}

  let username = 'Candidate';
  try {
    username = os.userInfo().username || 'Candidate';
  } catch {}

  return {
    hostname: os.hostname(),
    username,
    platform: os.platform(),
    ip: localIp,
  };
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
