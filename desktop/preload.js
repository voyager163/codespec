'use strict';
// The only bridge between the web UI and the desktop shell. contextIsolation keeps
// the renderer sandboxed; we expose a tiny, explicit API the chat page feature-detects.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcDesktop', {
  isDesktop: true,
  // Opens the native OS folder picker; resolves to an absolute path or null.
  pickFolder: () => ipcRenderer.invoke('pc:pickFolder'),
  // Reveals the app's data folder in the OS file manager; resolves to a boolean.
  openDataFolder: () => ipcRenderer.invoke('pc:openDataFolder'),
});
