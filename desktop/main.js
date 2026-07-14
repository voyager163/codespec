'use strict';
// PowerCodex desktop — the Electron shell. It boots the bundled, zero-dependency
// lifecycle server in-process, opens the friendly Chat & Agent UI in a native
// window, and adds the one thing a browser can't do: a real OS folder picker.
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const { resolveWorkspace, createLogger } = require('./lib/storage');

// The lifecycle tool is vendored next to the app (scripts/sync-lifecycle.js copies
// it in before start/dist), so everything ships inside the packaged binary.
const { serve } = require(path.join(__dirname, 'vendor', 'lifecycle', 'lib', 'server'));

let mainWindow = null;
let server = null;
let serverPort = 0;
let workspaceDir = null;
let workspaceWarning = null; // set when userData was unwritable and we fell back to temp

// Logs land in <userData>/logs/main.log so a support request can include them.
const log = createLogger(() => app.getPath('userData'));

// ---- Crash safety ---------------------------------------------------------
// Never die silently. A thrown error surfaces to the user and exits cleanly;
// an unhandled rejection is recorded but left non-fatal.
process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err);
  try {
    dialog.showErrorBox('PowerCodex hit an unexpected error', String((err && err.stack) || err));
  } catch {
    /* dialog unavailable (e.g. before ready / headless) */
  }
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection:', reason instanceof Error ? reason : String(reason));
});

// ---- Single instance ------------------------------------------------------
// A second launch must not spin up a second server against the same workspace;
// focus the window that's already open instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return; // legal at CJS module top level — stops the rest of startup
}
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// ---- Trust boundary -------------------------------------------------------
// True only for our own local server: exact scheme + host + port, parsed with the
// URL API rather than a spoofable substring match.
function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      u.port === String(serverPort)
    );
  } catch {
    return false;
  }
}

// One navigation policy for every webContents — the main window and any pop-out
// (the plan canvas opens an about:blank window and writes into it). Local pages
// and about:blank stay in-app; real external links open in the user's browser;
// anything else (file:, custom schemes, embedded webviews) is refused.
function wireSecurity() {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url === 'about:blank' || isLocalUrl(url)) return { action: 'allow' };
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (isLocalUrl(url)) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

// Start the bundled server on an OS-assigned free port and resolve with the port.
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      // A writable workspace so the app is usable the instant it opens — "Create a
      // new app" builds here; "Open project" re-points at a folder the user chooses.
      const ws = resolveWorkspace(app.getPath('userData'));
      workspaceDir = ws.dir;
      if (ws.fallback) {
        workspaceWarning =
          `Your data folder was not writable (${ws.reason}); using a temporary ` +
          `workspace at ${ws.dir}. Work saved there may not survive a reboot.`;
        log.warn(workspaceWarning);
      }
      // Real mode: the desktop product actually builds (code-gen + build verify). Non-
      // code or browser-only work degrades gracefully inside resolveEngines.
      server = serve(workspaceDir, { port: 0, open: false, simulate: false });
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
    log.error('server failed to start:', e);
    dialog.showErrorBox('PowerCodex could not start', String((e && e.message) || e));
    app.quit();
    return;
  }
  log.info('server listening', `http://localhost:${serverPort}`);

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
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}/chat`);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Surface the temp-workspace fallback once, non-fatally, after the UI is up.
    if (workspaceWarning) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Using a temporary workspace',
        message: workspaceWarning,
      });
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// The native folder picker — the desktop-only capability the web UI falls back from.
ipcMain.handle('pc:pickFolder', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your project folder',
      properties: ['openDirectory'],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  } catch (e) {
    log.error('pickFolder failed:', e);
    return null;
  }
});

// Reveal the workspace in Explorer/Finder so users can find their generated projects.
ipcMain.handle('pc:openDataFolder', async () => {
  try {
    if (!workspaceDir) return false;
    const err = await shell.openPath(workspaceDir); // resolves to '' on success
    if (err) log.warn('openDataFolder:', err);
    return !err;
  } catch (e) {
    log.error('openDataFolder failed:', e);
    return false;
  }
});

// Taskbar identity (so Windows groups + pins the app correctly).
app.setAppUserModelId('com.powercodex.desktop');
wireSecurity();
app.whenReady().then(() => {
  // The local-server UI needs no browser permissions (camera, geolocation,
  // notifications…); deny every request by default.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  createWindow();
});
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
