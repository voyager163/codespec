'use strict';
// Storage + logging utilities for the desktop shell. Pure Node (no Electron
// imports) so they stay unit-testable and reusable from build scripts. All
// paths are built with path.join, so Windows and macOS separators both work.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Create a directory (recursive, idempotent) and verify it is writable.
// Throws when the directory cannot be created or written to.
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

// Resolve the app workspace: <userData>/workspace (matches existing installs).
// If userData is unwritable (locked-down profile, full disk quota, AV holds),
// fall back to a temp-dir workspace so the app still opens; throw only when
// both locations fail. Returns { dir, fallback, reason? }.
function resolveWorkspace(userDataDir) {
  const primary = path.join(userDataDir, 'workspace');
  try {
    return { dir: ensureDir(primary), fallback: false };
  } catch (primaryErr) {
    const alt = path.join(os.tmpdir(), 'PowerCodex', 'workspace');
    try {
      return { dir: ensureDir(alt), fallback: true, reason: String(primaryErr.message || primaryErr) };
    } catch (altErr) {
      throw new Error(
        'Cannot create a writable workspace.\n' +
          `  ${primary}: ${primaryErr.message}\n` +
          `  ${alt}: ${altErr.message}`
      );
    }
  }
}

// Append-only logger at <userData>/logs/main.log. The path resolves lazily
// (userData is queryable before app-ready) and write failures are swallowed —
// the logger runs inside crash handlers, so it must never throw itself.
function createLogger(getUserDataDir) {
  let file; // undefined = unresolved, false = unavailable
  const target = () => {
    if (file === undefined) {
      try {
        file = path.join(ensureDir(path.join(getUserDataDir(), 'logs')), 'main.log');
      } catch {
        file = false;
      }
    }
    return file;
  };
  const write = (level, args) => {
    const text = args
      .map((a) => (a instanceof Error ? a.stack || String(a) : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    try {
      if (target()) fs.appendFileSync(target(), line);
    } catch {
      /* never crash on logging */
    }
    (level === 'error' ? console.error : console.log)(line.trimEnd());
  };
  return {
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    get file() {
      return target() || null;
    },
  };
}

module.exports = { ensureDir, resolveWorkspace, createLogger };
