'use strict';
// Desktop setup helpers — the bits that reach out to the maker's machine so the app can
// (a) open the whole project in VS Code, and (b) launch a provider sign-in WITHOUT the
// maker leaving PowerCodex. The lifecycle server runs locally (in the Electron main
// process for the desktop app), so spawning these here works in both desktop and web.
//
// Everything is best-effort and honest: if a tool isn't installed we say exactly what to
// do, and we never handle credentials ourselves — sign-in is delegated to each CLI's own
// browser/device OAuth, which we simply open a terminal for.
const { spawn } = require('node:child_process');
const providers = require('./providers');
const { hasBin } = require('./providers/_cli');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// `code` is VS Code's CLI (code.cmd on Windows). Present only if the user ran
// "Shell Command: Install 'code' command in PATH" — so we detect and guide.
function vsCodeAvailable() {
  return hasBin('code');
}

function spawnDetached(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: isWin, ...opts });
  child.unref();
  return child;
}

// Open the active workspace folder in VS Code.
function openInVSCode(root) {
  if (!root) return { ok: false, error: 'No project is open yet.' };
  if (!vsCodeAvailable()) {
    return {
      ok: false,
      error: "VS Code’s command-line launcher isn’t on your PATH. Open VS Code → Command Palette (Ctrl/Cmd+Shift+P) → “Shell Command: Install ‘code’ command in PATH”, then try again.",
    };
  }
  try {
    spawnDetached('code', [root]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Could not launch VS Code: ' + e.message };
  }
}

// Open a real terminal window running a command (used for interactive sign-in flows,
// which need a TTY + a browser). Cross-platform best-effort.
function openTerminalWith(command, title = 'PowerCodex') {
  try {
    if (isWin) {
      // cmd's `start` opens a new window; /k keeps it open so the maker can complete OAuth.
      // CRITICAL: `start` treats its first token as the window TITLE only when it is
      // QUOTED. An unquoted multi-word title (e.g. "PowerCodex · sign in to …") makes
      // `start` treat the first word as the PROGRAM to launch → "Windows cannot find
      // 'PowerCodex'". So we always pass an explicitly quoted title, and wrap the command
      // after /k so a multi-step command (a && b) runs inside the new window, not the
      // launching shell. We run the whole line through cmd (/s strips the outer quotes,
      // leaving our inner quotes intact), which is the reliable way to get this right.
      const { exec } = require('node:child_process');
      const safeTitle = String(title || 'PowerCodex').replace(/["%]/g, '').trim() || 'PowerCodex';
      const child = exec(`start "${safeTitle}" cmd /k "${command}"`, { windowsHide: false });
      child.unref();
      return { ok: true };
    }
    if (isMac) {
      const script = `tell application "Terminal" to do script ${JSON.stringify(command)}\ntell application "Terminal" to activate`;
      spawnDetached('osascript', ['-e', script], { shell: false });
      return { ok: true };
    }
    // Linux: try the common terminal launchers in turn.
    const terms = [
      ['x-terminal-emulator', ['-e', 'bash', '-lc', `${command}; exec bash`]],
      ['gnome-terminal', ['--', 'bash', '-lc', `${command}; exec bash`]],
      ['konsole', ['-e', 'bash', '-lc', `${command}; exec bash`]],
      ['xterm', ['-e', `bash -lc '${command}; exec bash'`]],
    ];
    for (const [bin, args] of terms) {
      if (hasBin(bin)) {
        spawnDetached(bin, args, { shell: false });
        return { ok: true };
      }
    }
    return { ok: false, error: 'No terminal emulator found. Run this in your shell: ' + command };
  } catch (e) {
    return { ok: false, error: 'Could not open a terminal: ' + e.message };
  }
}

// Launch the sign-in flow for a provider. Returns the command we ran so the UI can show
// it (and the note explaining what the maker will see).
function signIn(providerId) {
  const a = providers.get(providerId);
  if (!a) return { ok: false, error: 'Unknown provider: ' + providerId };
  if (a.simulated) return { ok: false, error: 'The built-in brain needs no sign-in.' };
  const setup = a.setup || {};
  const cmd = setup.signinCmd;
  if (!cmd) return { ok: false, error: 'No sign-in command is defined for ' + a.label + '.' };
  // If the CLI isn't even installed, say how to install it (don't open an empty terminal).
  if (typeof a.available === 'function' && !a.available()) {
    return {
      ok: false,
      notInstalled: true,
      installCmd: setup.installCmd || null,
      installUrl: setup.installUrl || null,
      error: `${a.label} isn’t installed yet. Install it first` + (setup.installCmd ? `:  ${setup.installCmd}` : '.'),
    };
  }
  const res = openTerminalWith(cmd, 'PowerCodex · sign in to ' + a.label);
  return Object.assign(res, { command: cmd, note: setup.signinNote || '' });
}

module.exports = { openInVSCode, vsCodeAvailable, signIn, openTerminalWith };
