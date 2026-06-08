'use strict';
// PowerCodex desktop — the Electron shell. It boots the bundled, zero-dependency
// lifecycle server in-process, opens the friendly Chat & Agent UI in a native
// window, and adds the one thing a browser can't do: a real OS folder picker.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// The lifecycle tool is vendored next to the app (scripts/sync-lifecycle.js copies
// it in before start/dist), so everything ships inside the packaged .exe.
const { serve } = require(path.join(__dirname, 'vendor', 'lifecycle', 'lib', 'server'));

let mainWindow = null;
let server = null;
let serverPort = 0;

// A writable workspace so the app is usable the instant it opens — "Create a new
// app" builds here; "Open project" re-points at a folder the user chooses.
function defaultWorkspace() {
  const ws = path.join(app.getPath('userData'), 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

// Start the bundled server on an OS-assigned free port and resolve with the port.
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      // Real mode: the desktop product actually builds (code-gen + build verify). Non-
      // code or browser-only work degrades gracefully inside resolveEngines.
      server = serve(defaultWorkspace(), { port: 0, open: false, simulate: false });
      server.once('listening', () => resolve(server.address().port));
      server.once('error', reject);
      if (server.listening) resolve(server.address().port);
    } catch (e) {
      reject(e);
    }
  });
}

async function createWindow() {
  try {
    serverPort = await startServer();
  } catch (e) {
    dialog.showErrorBox('PowerCodex could not start', String((e && e.message) || e));
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'PowerCodex',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}/chat`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Same-origin pop-outs (the plan canvas) open in-app; real external links go to
  // the user's browser instead of spawning blank Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.includes(`localhost:${serverPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// The native folder picker — the desktop-only capability the web UI falls back from.
ipcMain.handle('pc:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your project folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// Taskbar identity (so Windows groups + pins the app correctly).
app.setAppUserModelId('com.powercodex.desktop');
app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('quit', () => {
  try {
    if (server) server.close();
  } catch {
    /* best-effort shutdown */
  }
});
