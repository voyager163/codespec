'use strict';
// Robust packaged build. Two things make `npm run dist`/`build` flaky on Windows:
//   1) a still-running PowerCodex instance locks the build files, and
//   2) VS Code's file watcher holds a handle on dist/win-unpacked/resources/app.asar,
//      so electron-builder can't empty the output folder ("used by another process").
//
// This wrapper sidesteps both: it stops stray app instances, then builds into the OS
// temp dir (which VS Code never watches), and finally copies the finished installer/exe
// onto your Desktop so it's easy to find and launch. Output never lands inside the
// VS-Code-watched workspace, so the lock simply can't happen.
const { spawnSync, execSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// This is the Windows-only convenience wrapper (it passes --win and does Windows
// process/registry cleanup). Fail fast with a pointer elsewhere so a mac/Linux run
// doesn't die inside a confusing wine/electron-builder error.
if (process.platform !== 'win32') {
  console.error(
    'build-exe.js is the Windows build helper. On macOS use `npm run dist:mac`; ' +
      'for a host-OS unpacked build use `npm run pack`.'
  );
  process.exit(1);
}

const projectDir = path.resolve(__dirname, '..');
const target = (process.argv[2] || 'portable').toLowerCase(); // 'portable' | 'nsis' | 'dir'
const ARTIFACT = { portable: 'PowerCodex.exe', nsis: 'PowerCodex-Setup.exe' };

function step(msg) {
  process.stdout.write(`\n› ${msg}\n`);
}

// 1) Vendor the engine in.
step('Syncing the engine (sync-lifecycle)…');
execSync('node scripts/sync-lifecycle.js', { stdio: 'inherit', cwd: projectDir });

// 2) Best-effort: stop any running PowerCodex so it can't lock build files.
if (process.platform === 'win32') {
  step('Closing any running PowerCodex instances…');
  try {
    spawnSync('taskkill', ['/F', '/IM', 'PowerCodex.exe', '/T'], { stdio: 'ignore' });
  } catch {
    /* none running — fine */
  }
}

// 3) Build into a fresh temp dir OUTSIDE the workspace (VS Code can't lock it).
const out = path.join(os.tmpdir(), 'powercodex-build');
try {
  fs.rmSync(out, { recursive: true, force: true });
} catch {
  /* best-effort */
}
fs.mkdirSync(out, { recursive: true });

const builder = path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const args = ['--win', target === 'dir' ? '--dir' : target, `--config.directories.output=${out}`];
step(`Packaging (${target}) → ${out}`);
const r = spawnSync(builder, args, { stdio: 'inherit', cwd: projectDir, shell: process.platform === 'win32' });
if (r.status !== 0) {
  console.error(`\n✗ Build failed (electron-builder exit ${r.status}).`);
  process.exit(r.status || 1);
}

// Resolve the user's REAL Desktop — handles OneDrive folder redirection. Used only to
// drop a tiny shortcut (.lnk), never the big binary (OneDrive's Files-On-Demand and
// Controlled-Folder-Access can block launching a large exe placed directly on it).
function resolveDesktop() {
  if (process.platform === 'win32') {
    try {
      const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop', { encoding: 'utf8' });
      const m = out.match(/Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
      if (m) {
        const p = m[1].trim().replace(/%USERPROFILE%/gi, process.env.USERPROFILE || os.homedir()).replace(/%OneDrive%/gi, process.env.OneDrive || '');
        if (fs.existsSync(p)) return p;
      }
    } catch {
      /* fall through */
    }
  }
  const c = [process.env.OneDrive && path.join(process.env.OneDrive, 'Desktop'), process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop'), path.join(os.homedir(), 'Desktop')].filter(Boolean);
  return c.find((d) => fs.existsSync(d)) || null;
}

// 4) Deliver to a STABLE LOCAL folder (never OneDrive / temp / the watched workspace),
//    and drop a Desktop shortcut to it. %LOCALAPPDATA% is local and always present.
const artifactName = ARTIFACT[target];
if (artifactName) {
  const built = path.join(out, artifactName);
  if (!fs.existsSync(built)) {
    console.log(`\n✅ Built, but couldn’t find ${artifactName} in ${out} — look there.`);
  } else {
    const localDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'PowerCodex');
    fs.mkdirSync(localDir, { recursive: true });
    const dest = path.join(localDir, artifactName);
    // A running instance could lock the destination — stop it first (best-effort).
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/F', '/IM', artifactName, '/T'], { stdio: 'ignore' });
      } catch {
        /* none */
      }
    }
    try {
      fs.copyFileSync(built, dest);
    } catch (e) {
      console.log(`\n✅ Built at ${built}\n   (couldn’t copy to ${localDir}: ${e.message})`);
      return;
    }
    // Best-effort Desktop shortcut (tiny .lnk — safe on OneDrive Desktop).
    let shortcutMsg = '';
    const desktop = resolveDesktop();
    if (process.platform === 'win32' && desktop) {
      try {
        const lnk = path.join(desktop, 'PowerCodex.lnk');
        const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='${dest.replace(/'/g, "''")}';$s.WorkingDirectory='${localDir.replace(/'/g, "''")}';$s.Save()`;
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
        if (fs.existsSync(lnk)) shortcutMsg = `\n   Desktop shortcut created: ${lnk}`;
      } catch {
        /* shortcut is a nice-to-have */
      }
    }
    const how = target === 'nsis' ? 'Run it once to install PowerCodex (creates Start Menu + Desktop shortcuts):' : 'Launch it (double-click):';
    console.log(`\n✅ Done. ${how}\n   ${dest}${shortcutMsg}`);
  }
} else {
  console.log(`\n✅ Built (unpacked) at ${path.join(out, 'win-unpacked')}`);
}
