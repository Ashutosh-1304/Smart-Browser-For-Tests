// ---------------------------------------------------------------------------
// Electron MAIN process (CommonJS -> .cjs because package.json has type:module)
// Responsibilities:
//   1. Create the app window (with webviewTag enabled so <webview> works).
//   2. Auto-grant camera/mic permission requests.
//   3. Watch OS-level window events (blur/minimize/fullscreen) and forward them
//      to the React renderer over IPC — this is the Phase 3 monitoring backbone.
// ---------------------------------------------------------------------------
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
      // REQUIRED so the <webview> tag (used to embed the assessment site) works.
      webviewTag: true,
    },
  });

  // Auto-grant camera/microphone so getUserMedia() works without a native prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'camera', 'microphone', 'audioCapture', 'videoCapture'];
    callback(allowed.includes(permission));
  });
  // Some Electron versions also route through this check handler.
  session.defaultSession.setPermissionCheckHandler(() => true);

  // Forward all renderer console messages directly to the Node terminal
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

  // Toggle DevTools with F12 or Cmd+Alt+I / Ctrl+Shift+I
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

  // Safety fallback: ensure window is displayed even if ready-to-show is delayed
  setTimeout(revealWindow, 1500);

  // --- Forward window events to the renderer (Phase 3) ---
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

// Let the renderer toggle real OS fullscreen (so we can demo "fullscreen exit").
ipcMain.handle('toggle-fullscreen', (_event, enable) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!!enable);
    return mainWindow.isFullScreen();
  }
  return false;
});

// Provide OS hostname, username, and local IP for Veyon mapping
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
