'use strict';
// A tiny, read-only local-folder browser for the "Add existing" picker. The server
// runs on the maker's own machine, so a server-side directory listing is the honest
// way to let them choose a project folder (a browser file input can't return a path).
// Only directory names are returned — never file contents.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function listDir(dir) {
  const target = dir && String(dir).trim() ? path.resolve(String(dir)) : os.homedir();
  const st = fs.statSync(target); // throws → caller returns { ok:false }
  if (!st.isDirectory()) throw new Error('Not a folder');

  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((d) => {
      try {
        return d.isDirectory() && !d.name.startsWith('.');
      } catch {
        return false;
      }
    })
    .map((d) => {
      const full = path.join(target, d.name);
      let marker = null;
      try {
        if (fs.existsSync(path.join(full, '.powercodex'))) marker = 'powercodex';
        else if (fs.existsSync(path.join(full, 'package.json'))) marker = 'project';
      } catch {
        /* unreadable subfolder — list it without a marker */
      }
      return { name: d.name, path: full, marker };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    isProject: fs.existsSync(path.join(target, 'package.json')) || fs.existsSync(path.join(target, '.powercodex')),
    entries,
  };
}

// Folders we never descend into for the workspace tree — noise that would bury the
// maker's own files.
const TREE_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'release', 'release2', 'release3', 'release4', 'out-installer', 'vendor', '.profiles']);

// List one level of a folder for the workspace file tree: BOTH files and folders (the
// picker above is dirs-only). Folders sort first, then files, alphabetically. `.powercodex`
// is shown (it's the project's own state) but heavy/generated dirs are skipped. Read-only.
function listTree(dir) {
  const target = dir && String(dir).trim() ? path.resolve(String(dir)) : os.homedir();
  const st = fs.statSync(target); // throws → caller returns { ok:false }
  if (!st.isDirectory()) throw new Error('Not a folder');

  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((d) => {
      if (d.isDirectory()) return !TREE_SKIP.has(d.name);
      return true;
    })
    .map((d) => {
      const full = path.join(target, d.name);
      let size = null;
      if (!d.isDirectory()) {
        try {
          size = fs.statSync(full).size;
        } catch {
          size = null;
        }
      }
      return { name: d.name, path: full, dir: d.isDirectory(), size };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));

  return { path: target, entries };
}

module.exports = { listDir, listTree };
