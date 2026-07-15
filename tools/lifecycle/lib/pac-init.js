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
// A hung pac call (network stall, waiting on an auth prompt) is killed after timeoutMs
// so it can't stall the publish flow forever — a real hard kill, not just an awaiter.
async function pac(args, { cwd = process.cwd(), env, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PAC, args, { cwd, env: env || process.env, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs) : null;
    if (timer && timer.unref) timer.unref();
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return resolve({ stdout: stdout.trim(), stderr: `pac ${args[0] || ''} timed out after ${timeoutMs}ms and was stopped.`, code: 1, timedOut: true });
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
    });
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ stdout: '', stderr: e.message, code: 1 }); });
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

module.exports = { checkPac, preflight, listAuthProfiles, ensureAuth, initCodeApp, pushCodeApp };
