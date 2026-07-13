'use strict';
// preview.js — runs a REAL local dev server for a generated Code App so "preview"
// stops being a fabricated URL string and becomes a process you can actually open.
//
// Contract (mirrors pac-init.js's registerCodeApp honest-degrade style):
//   • Never fabricate a URL or a success. If a preview can't be started/verified,
//     return { ok: false, message } with a plain-language message — do not throw
//     where a caller expects a result object.
//   • Every step emits a plain-language progress message (the `emit` convention).
//   • Boundaries are injected for testability: `_spawn` defaults to the real
//     child_process.spawn; `_probe` defaults to the real HTTP readiness check.
//     Tests inject fakes so the suite never spawns npm/vite or touches a real port
//     (same pattern as registerCodeApp's `_pac`).
//
// Success returns { url, pid }; degrade returns { ok: false, message }. Callers
// (loop.js integration, server endpoints) treat a truthy `.url` as success.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn: realSpawn } = require('node:child_process');

// root -> { url, pid, proc }. In-module registry of running preview servers.
const servers = new Map();

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Default readiness probe: one HTTP GET. Any response (even a 4xx/5xx) means the
// server is listening. Resolves false on connection error/timeout so the caller polls.
function httpProbe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode > 0); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

// Poll `probe(url)` until it succeeds or `timeoutMs` elapses. ~30s default.
async function waitReady(url, probe, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(url)) return true;
    await sleep(300);
  }
  return false;
}

// Watch a spawned process's stdout/stderr for vite's "Local: http://localhost:<port>/"
// line and resolve the bound URL (port not hardcoded). Resolves null if the process
// exits or errors before printing it, or if `timeoutMs` elapses.
function parseViteUrl(proc, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    let timer;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const onData = (d) => {
      buf += stripAnsi(d.toString());
      const m = buf.match(/Local:\s*(https?:\/\/[^\s/]+)/i);
      if (m) finish(m[1]);
    };
    if (proc.stdout) proc.stdout.on('data', onData);
    if (proc.stderr) proc.stderr.on('data', onData); // vite occasionally logs to stderr
    proc.on('exit', () => finish(null));
    proc.on('error', () => finish(null));
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// Run a short-lived command to completion via the injected spawn. Resolves true on
// exit code 0. Used for the `npm install` bootstrap.
function runToClose(_spawn, cmd, args, cwd) {
  return new Promise((resolve) => {
    let proc;
    try { proc = _spawn(cmd, args, { cwd, stdio: 'ignore' }); }
    catch { return resolve(false); }
    proc.on('exit', (code) => resolve((code ?? 0) === 0));
    proc.on('error', () => resolve(false));
  });
}

// Start (or reuse) a live dev server for `root`.
//   1. Idempotent: a server already tracked for `root` → return its { url, pid }.
//   2. No `dev` script → honest nudge, no spawn (degrade before any process starts).
//   3. Missing node_modules → `npm install` first (progress emitted before/after).
//   4. Spawn `npm run dev -- --port 0 --strictPort false`, parse the real bound port.
//   5. Poll the URL (~30s) until it responds; on timeout kill + degrade honestly.
// Returns { url, pid } on success, { ok: false, message } on any honest degrade.
async function start(root, { emit = async () => {}, _spawn = realSpawn, _probe = httpProbe } = {}) {
  const existing = servers.get(root);
  if (existing) return { url: existing.url, pid: existing.pid };

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); }
  catch {
    const message = 'I couldn’t read this project’s package.json, so I can’t start a live preview. Make sure the project built correctly, then try again.';
    await emit({ level: 'info', message });
    return { ok: false, message };
  }

  // Degrade before spawning anything: no dev script means no preview is possible.
  if (!pkg.scripts || !pkg.scripts.dev) {
    const message = 'This project has no "dev" script, so I can’t start a live preview. Add a Vite "dev" script to package.json and try preview again.';
    await emit({ level: 'info', message });
    return { ok: false, message };
  }

  // Bootstrap dependencies if they’re missing (first run only).
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    await emit({ level: 'info', message: 'Installing dependencies (npm install) — the first run can take a minute…' });
    const installed = await runToClose(_spawn, npmCmd, ['install'], root);
    if (!installed) {
      const message = 'npm install failed, so I couldn’t start the preview. Check your internet connection and the project’s dependencies, then try again.';
      await emit({ level: 'warn', message });
      return { ok: false, message };
    }
    await emit({ level: 'good', message: 'Dependencies installed' });
  }

  await emit({ level: 'info', message: 'Starting the live preview (npm run dev)…' });
  let proc;
  try {
    proc = _spawn(npmCmd, ['run', 'dev', '--', '--port', '0', '--strictPort', 'false'], {
      cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    const message = 'I couldn’t launch the dev server process. Make sure Node and npm are installed, then try again.';
    await emit({ level: 'warn', message });
    return { ok: false, message };
  }

  const url = await parseViteUrl(proc);
  if (!url) {
    try { proc.kill(); } catch { /* already gone */ }
    const message = 'The dev server started but didn’t report a URL in time, so I stopped it. Check the project’s "dev" script, then try again.';
    await emit({ level: 'warn', message });
    return { ok: false, message };
  }

  await emit({ level: 'info', message: `Preview server booting at ${url} — waiting for it to respond…` });
  const ready = await waitReady(url, _probe);
  if (!ready) {
    try { proc.kill(); } catch { /* already gone */ }
    const message = `The preview server at ${url} didn’t respond within 30s, so I stopped it. Check the dev server logs and try again.`;
    await emit({ level: 'warn', message });
    return { ok: false, message };
  }

  servers.set(root, { url, pid: proc.pid, proc });
  // Drop the registry entry if the process dies on its own so status() stays honest.
  proc.on('exit', () => { const s = servers.get(root); if (s && s.proc === proc) servers.delete(root); });
  await emit({ level: 'good', message: `Live preview is running at ${url}` });
  return { url, pid: proc.pid };
}

// Kill the tracked preview for `root`, if any. No-op when nothing is running.
function stop(root) {
  const s = servers.get(root);
  if (!s) return { stopped: false };
  try { s.proc.kill(); } catch { /* already gone */ }
  servers.delete(root);
  return { stopped: true };
}

// Report whether a preview is running for `root`.
function status(root) {
  const s = servers.get(root);
  return s ? { running: true, url: s.url, pid: s.pid } : { running: false };
}

// Kill every tracked preview (app-quit cleanup).
function stopAll() {
  for (const [root, s] of servers) {
    try { s.proc.kill(); } catch { /* already gone */ }
    servers.delete(root);
  }
}

// Best-effort cleanup so a hard process exit doesn't leave orphaned dev servers.
process.once('exit', stopAll);

module.exports = { start, stop, status, stopAll };
