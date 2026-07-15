'use strict';
// preview.js — run the maker's app for real on localhost so they can try it out.
//
// This is the "Preview" the desktop product promises: a live dev server (Vite) for
// the active project, with NO Dataverse / auth required. It authors nothing and
// deploys nothing — it just spawns `npm run dev`, captures the URL Vite prints, and
// keeps the server running so the app can be exercised in the Canvas iframe or a
// browser. Publishing to Power Platform is a separate, consent-gated step (publish.js).
//
// One dev server per project root at a time. Everything is best-effort and honest:
// missing deps or a missing `dev` script are reported, never faked.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// root(resolved) → { child, url, startedAt, tail: string[] }
const servers = new Map();

const IS_WIN = process.platform === 'win32';
// Match the first loopback URL Vite prints, e.g. "Local:   http://localhost:5173/".
const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[\S]*)/i;

function key(root) {
  return path.resolve(String(root));
}

// Is this project runnable right now? Returns { ok, reason, needsInstall }.
function canRun(root) {
  const abs = key(root);
  const pkgPath = path.join(abs, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, reason: 'No package.json here yet — create or open a project first.' };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: 'package.json could not be read: ' + e.message };
  }
  if (!pkg.scripts || !pkg.scripts.dev) {
    return { ok: false, reason: 'This project has no "dev" script to preview.' };
  }
  if (!fs.existsSync(path.join(abs, 'node_modules'))) {
    return { ok: false, needsInstall: true, reason: 'Dependencies are still installing — try Preview again in a moment.' };
  }
  return { ok: true };
}

function running(root) {
  const s = servers.get(key(root));
  return !!(s && s.child && s.child.exitCode == null && !s.child.killed);
}

function status(root) {
  const s = servers.get(key(root));
  if (running(root)) return { running: true, url: s.url || null, startedAt: s.startedAt };
  return { running: false, url: null };
}

// Start (or reuse) a dev server for `root`. Resolves once the URL is captured, the
// process exits early, or a timeout elapses. `onLine` relays server output for the UI.
function start(root, { onLine, timeoutMs = 25000 } = {}) {
  const abs = key(root);

  if (running(abs)) {
    const s = servers.get(abs);
    return Promise.resolve({ ok: true, already: true, url: s.url || null });
  }

  const pre = canRun(abs);
  if (!pre.ok) {
    return Promise.resolve({ ok: false, needsInstall: !!pre.needsInstall, error: pre.reason });
  }

  return new Promise((resolve) => {
    let child;
    const npm = IS_WIN ? 'npm.cmd' : 'npm';
    try {
      child = spawn(npm, ['run', 'dev'], {
        cwd: abs,
        // Own process group on POSIX so stop() can kill Vite and its children together.
        detached: !IS_WIN,
        shell: IS_WIN,
        env: Object.assign({}, process.env, { FORCE_COLOR: '0', NO_COLOR: '1' }),
      });
    } catch (e) {
      return resolve({ ok: false, error: 'Could not start the dev server: ' + e.message });
    }

    const entry = { child, url: null, startedAt: Date.now(), tail: [] };
    servers.set(abs, entry);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const scan = (buf) => {
      const text = String(buf);
      text.split(/\r?\n/).forEach((line) => {
        const t = line.trim();
        if (!t) return;
        entry.tail.push(t);
        if (entry.tail.length > 40) entry.tail.shift();
        if (onLine) { try { onLine(t); } catch { /* relay is best-effort */ } }
        if (!entry.url) {
          const m = t.match(URL_RE);
          if (m) {
            entry.url = m[1].replace(/\/+$/, '') + '/';
            finish({ ok: true, url: entry.url });
          }
        }
      });
    };

    if (child.stdout) child.stdout.on('data', scan);
    if (child.stderr) child.stderr.on('data', scan);

    child.on('error', (e) => {
      servers.delete(abs);
      finish({ ok: false, error: 'The dev server failed to launch: ' + e.message });
    });
    child.on('exit', (code) => {
      // Only clear if this is still the tracked child (stop() may have replaced it).
      if (servers.get(abs) === entry) servers.delete(abs);
      finish({ ok: false, error: 'The dev server stopped before it was ready (exit ' + code + '). ' + (entry.tail.slice(-3).join(' · ') || '') });
    });

    const timer = setTimeout(() => {
      // Server may be up but printed a URL we didn't match; surface what we have.
      if (entry.url) finish({ ok: true, url: entry.url });
      else finish({ ok: false, timedOut: true, error: 'The dev server did not report a URL in time; it may still be starting.' });
    }, timeoutMs);
  });
}

// Stop the dev server for `root`. Best-effort; kills the whole process group/tree.
function stop(root) {
  const abs = key(root);
  const s = servers.get(abs);
  if (!s || !s.child) return { ok: true, stopped: false };
  const pid = s.child.pid;
  servers.delete(abs);
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true });
    } else {
      // Negative pid → the process group created by detached:true (Vite + children).
      try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
    }
  } catch {
    /* already gone */
  }
  return { ok: true, stopped: true };
}

function stopAll() {
  for (const abs of Array.from(servers.keys())) stop(abs);
}

// Never leak a dev server past our own exit.
process.once('exit', stopAll);
process.once('SIGINT', () => { stopAll(); });
process.once('SIGTERM', () => { stopAll(); });

module.exports = { start, stop, stopAll, status, running, canRun };
