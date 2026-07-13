'use strict';
// scaffold-cli.js — spawns bin/create-powercodex.js (the full PowerCodex scaffold:
// starter template + OpenSpec + all 11 OPSX prompts/skills + git init) to create a
// brand-new named project, streaming its [run]/[ok]/[skip]/[fail] step lines as
// progress. Resolves the CLI across two layouts, same pattern as scaffold.js's
// starterDir(): the repo checkout (tools/lifecycle/lib → <repo>/bin) and the
// vendored desktop app (desktop/vendor/lifecycle/lib → desktop/vendor/bin). Returns
// null when neither exists (e.g. inside an already-generated app) so callers can
// degrade honestly instead of crashing.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function binPath() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'bin', 'create-powercodex.js'),
    path.resolve(__dirname, '..', '..', 'bin', 'create-powercodex.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const STEP_LINE = /^\[(run|ok|skip|fail)\]\s+(.+)$/;
const LEVEL = { run: 'info', ok: 'good', skip: 'info', fail: 'bad' };

// Create a brand-new PowerCodex project named `name` inside `targetDir`.
// `_binPath` injects the CLI script path for deterministic tests (defaults to binPath()).
function scaffoldNewProject(targetDir, { name, emit = async () => {}, _binPath } = {}) {
  return new Promise((resolve) => {
    const cleanName = name ? String(name).replace(/[^a-zA-Z0-9 _-]/g, '').trim() : '';
    const cli = _binPath !== undefined ? _binPath : binPath();
    if (!cli) {
      resolve({ scaffolded: false, output: '', error: 'Full project scaffolding is not available here — the PowerCodex CLI isn\'t bundled with this build.' });
      return;
    }
    if (!cleanName) {
      resolve({ scaffolded: false, output: '', error: 'A project name is required.' });
      return;
    }
    const child = spawn(process.execPath, [cli, cleanName], { cwd: targetDir });
    let out = '';
    let err = '';
    const onLine = (line) => {
      const m = line.match(STEP_LINE);
      if (m) emit({ level: LEVEL[m[1]] || 'info', message: m[2] }).catch(() => {});
    };
    const relay = (buf, isErr) => {
      const s = String(buf);
      (isErr ? (err += s) : (out += s));
      s.split('\n').forEach((l) => l.trim() && onLine(l.trim()));
    };
    if (child.stdout) child.stdout.on('data', (b) => relay(b, false));
    if (child.stderr) child.stderr.on('data', (b) => relay(b, true));
    child.on('error', (e) => resolve({ scaffolded: false, output: out, error: e.message }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ scaffolded: false, output: out, error: err.trim() || `create-powercodex exited with code ${code}` });
        return;
      }
      resolve({ scaffolded: true, projectDir: path.join(targetDir, cleanName), output: out });
    });
  });
}

module.exports = { binPath, scaffoldNewProject };
