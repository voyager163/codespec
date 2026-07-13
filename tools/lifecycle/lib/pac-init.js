'use strict';
// pac-init.js — wraps the Power Platform CLI (pac) to quick-start a Code App.
//
// Sequence:
//   1. Check pac is installed and reachable.
//   2. Optionally authenticate (pac auth create --environment <url>).
//   3. Run pac code init to scaffold the hosted Code App entry point.
//   4. Return the result so the caller can push the initial commit.
//
// The pac binary lives at ~/.dotnet/tools/pac on macOS/Linux when installed via
// dotnet tool install --global Microsoft.PowerApps.CLI.Tool.

const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');

const execAsync = promisify(execFile);

// Resolve the pac executable: try PATH first, then ~/.dotnet/tools/pac.
function findPac() {
  const candidates = ['pac'];
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    candidates.push(path.join(home, '.dotnet', 'tools', 'pac'));
    candidates.push(path.join(home, '.dotnet', 'tools', 'pac.exe'));
  }
  // On Windows the dotnet tool install puts it in USERPROFILE\.dotnet\tools
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, '.dotnet', 'tools', 'pac.exe'));
  }
  for (const c of candidates) {
    try {
      // A quick sync check; not perfect but avoids spawning for each candidate.
      if (fs.existsSync(c)) return c;
    } catch { /* skip */ }
  }
  // Fall back to 'pac' and let the OS raise "not found".
  return 'pac';
}

const PAC = findPac();

// Run pac and return { stdout, stderr, code }. Never throws — callers check code.
async function pac(args, { cwd = process.cwd(), env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PAC, args, { cwd, env: env || process.env, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 }));
    child.on('error', (e) => resolve({ stdout: '', stderr: e.message, code: 1 }));
  });
}

// Check that pac is available and return its version string.
async function checkPac() {
  const r = await pac(['help']);
  if (r.code !== 0 && !r.stdout) {
    throw new Error(
      `pac CLI not found or not executable.\n` +
      `Install it with:\n  dotnet tool install --global Microsoft.PowerApps.CLI.Tool\n` +
      `Then restart your terminal.`
    );
  }
  // pac help exits 0 and prints a usage block; extract version if present.
  const vm = (r.stdout + r.stderr).match(/Version:\s*([\d.]+\S*)/i);
  return vm ? vm[1] : '(unknown version)';
}

// List active pac auth profiles. Returns array of { name, kind, url, isActive }.
async function listAuthProfiles() {
  const r = await pac(['auth', 'list']);
  if (r.code !== 0) return [];
  // Output lines look like:  [1] Active  UNIVERSAL  user@tenant.com  https://...  ...
  return r.stdout.split('\n').filter((l) => /\[(\d+)\]/.test(l)).map((line) => {
    const active = /active/i.test(line);
    const urlM = line.match(/(https?:\/\/[^\s]+)/i);
    return { line: line.trim(), isActive: active, url: urlM ? urlM[1] : '' };
  });
}

// Create a pac auth profile for the given environment URL.
// If already authenticated to this environment, this is a no-op.
async function ensureAuth(environmentUrl, { emit = async () => {} } = {}) {
  const profiles = await listAuthProfiles();
  const existing = profiles.find((p) => environmentUrl && p.url && p.url.startsWith(environmentUrl.replace(/\/$/, '')));
  if (existing) {
    await emit({ level: 'info', message: `pac auth: already authenticated to ${environmentUrl}` });
    return { authenticated: true, reused: true };
  }
  await emit({ level: 'info', message: `pac auth create --environment ${environmentUrl}` });
  const r = await pac(['auth', 'create', '--environment', environmentUrl]);
  if (r.code !== 0) {
    throw new Error(`pac auth create failed:\n${r.stderr || r.stdout}`);
  }
  await emit({ level: 'good', message: 'pac auth: authenticated successfully' });
  return { authenticated: true, reused: false, output: r.stdout };
}

// Pre-flight check (Fix 1.5): verify pac is reachable and — when an environment URL
// is given — that an auth profile already matches it, BEFORE a long operation begins.
// Turns a confusing mid-run failure into a precise, actionable message up front.
// Throws on failure; the MCP boundary turns the throw into a structured isError.
async function preflight({ environmentUrl, emit = async () => {} } = {}) {
  const version = await checkPac(); // throws an actionable "install pac" message if missing
  await emit({ level: 'info', message: `pac ${version} reachable` });
  if (environmentUrl) {
    const profiles = await listAuthProfiles();
    const base = environmentUrl.replace(/\/$/, '');
    const match = profiles.find((p) => p.url && p.url.startsWith(base));
    if (!match) {
      throw new Error(
        `No pac auth profile matches ${environmentUrl}.\n` +
        `Authenticate first with:\n  pac auth create --environment ${environmentUrl}`,
      );
    }
    await emit({ level: 'good', message: `pac auth profile found for ${environmentUrl}` });
  }
  return true;
}

// Run pac code init to scaffold the Power Apps Code App entry in the given directory.
// This is the "quick start" — creates the hosted component structure pac expects
// before you can pac code push.
//
// Options:
//   appName        — the display name for the Code App
//   outputDir      — where to create the app scaffold (defaults to root/src)
//   environmentUrl — if provided, ensure auth first
//   emit           — async progress callback
//
// Returns: { initialised, appDir, output, error }
async function initCodeApp(root, {
  appName = 'MyPowerApp',
  outputDir,
  environmentUrl,
  emit = async () => {},
} = {}) {
  const version = await checkPac().catch((e) => { throw e; });
  await emit({ level: 'info', message: `pac ${version} · initialising Code App "${appName}"` });

  if (environmentUrl) {
    await ensureAuth(environmentUrl, { emit });
  }

  const appDir = outputDir || path.join(root, 'src');
  fs.mkdirSync(appDir, { recursive: true });

  await emit({ level: 'info', message: `pac code init --name "${appName}" in ${appDir}` });
  const r = await pac(['code', 'init', '--name', appName], { cwd: appDir });

  if (r.code !== 0) {
    await emit({ level: 'bad', message: `pac code init failed:\n${r.stderr || r.stdout}` });
    return { initialised: false, appDir, output: r.stdout + '\n' + r.stderr, error: r.stderr || r.stdout };
  }

  await emit({ level: 'good', message: `Code App "${appName}" initialised in ${appDir}` });

  // Detect the generated directory name (pac creates a sub-folder named after appName).
  const generatedDir = path.join(appDir, appName);
  const actualDir = fs.existsSync(generatedDir) ? generatedDir : appDir;

  return { initialised: true, appDir: actualDir, output: r.stdout };
}

// Push code to Power Apps using pac code push.
// Call this after initCodeApp + your build step.
async function pushCodeApp(root, { appDir, emit = async () => {} } = {}) {
  const dir = appDir || path.join(root, 'src');
  await checkPac(); // fail fast with an actionable message if pac is missing (Fix 1.5)
  await emit({ level: 'info', message: `pac code push in ${dir}` });
  const r = await pac(['code', 'push'], { cwd: dir });
  if (r.code !== 0) {
    await emit({ level: 'bad', message: `pac code push failed:\n${r.stderr || r.stdout}` });
    return { pushed: false, output: r.stdout + '\n' + r.stderr, error: r.stderr };
  }
  await emit({ level: 'good', message: 'pac code push succeeded' });
  return { pushed: true, output: r.stdout };
}

// Decide + perform Code App registration for a freshly-built project, degrading
// gracefully. This is the whole "make it a real Power Apps Code App" contract in one
// place so the loop stays thin and the behaviour is testable without a live pac:
//   • already a Code App (power.config.json present) → no-op.
//   • pac not reachable → a plain-language nudge to finish Power Platform setup.
//   • pac reachable → run `pac code init` at the project root; on failure, nudge.
// Never throws. Returns { registered, skipped?, level?, message? } — the loop emits
// `message` (if any) with `level`; the reachable-success path emits inside initCodeApp.
// `_pac` injects the pac boundary for tests (defaults to this module's real functions).
async function registerCodeApp(root, { appName = 'MyPowerApp', environmentUrl, emit = async () => {}, _pac } = {}) {
  if (fs.existsSync(path.join(root, 'power.config.json'))) return { registered: true, skipped: true };
  const api = _pac || { checkPac, initCodeApp };
  const reachable = await api.checkPac().then(() => true).catch(() => false);
  if (!reachable) {
    return {
      registered: false,
      level: 'info',
      message: 'Built as code · finish Power Platform setup (install/sign in to pac) to register this as a live Power Apps Code App',
    };
  }
  try {
    const r = await api.initCodeApp(root, { appName, outputDir: root, environmentUrl, emit });
    return { registered: !!r.initialised, appDir: r.appDir };
  } catch (e) {
    const first = e && e.message ? String(e.message).split('\n')[0] : 'pac code init failed';
    return {
      registered: false,
      level: 'warn',
      message: `Could not register the Power Apps Code App yet: ${first} · finish Power Platform setup, then rebuild`,
    };
  }
}

// Run `npm run build` first (only if package.json declares a build script), then
// pac code push. Mirrors the maker's own "npm run build && pac code push" habit as
// one action. Never throws — callers check the returned booleans/error.
function hasBuildScript(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return !!(pkg.scripts && pkg.scripts.build);
  } catch {
    return false;
  }
}

function runNpmBuild(root, { emit = async () => {} } = {}) {
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['run', 'build'], { cwd: root, shell: process.platform === 'win32' });
    let out = '';
    const relay = async (b) => { out += String(b); await emit({ level: 'info', message: String(b).trim() }).catch(() => {}); };
    if (child.stdout) child.stdout.on('data', relay);
    if (child.stderr) child.stderr.on('data', relay);
    child.on('error', (e) => resolve({ ok: false, output: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, output: out }));
  });
}

async function buildAndPush(root, { appDir, emit = async () => {}, _push } = {}) {
  const push = _push || pushCodeApp;
  let built = false;
  if (hasBuildScript(root)) {
    await emit({ level: 'info', message: 'npm run build' });
    const b = await runNpmBuild(root, { emit });
    if (!b.ok) {
      await emit({ level: 'bad', message: `npm run build failed:\n${b.output}` });
      return { pushed: false, built: false, output: b.output, error: 'build failed' };
    }
    built = true;
    await emit({ level: 'good', message: 'npm run build succeeded' });
  } else {
    await emit({ level: 'info', message: 'no "build" script in package.json — skipping build, pushing as-is' });
  }
  try {
    const result = await push(root, { appDir, emit });
    return Object.assign({ built }, result);
  } catch (e) {
    return { pushed: false, built, output: '', error: e.message };
  }
}

module.exports = { checkPac, preflight, listAuthProfiles, ensureAuth, initCodeApp, pushCodeApp, registerCodeApp, buildAndPush, runPac: pac };
