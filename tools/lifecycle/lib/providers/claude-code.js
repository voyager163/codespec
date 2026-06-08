'use strict';
// Adapter → Claude Code CLI. Drives `claude` in non-interactive print mode and
// streams the answer back token-by-token. Auth is delegated: you log in once with
// `claude` itself; this adapter never handles credentials. If the CLI is not on
// the PATH, available() is false and the registry falls back to another provider.
const { hasBin, streamCli } = require('./_cli');
const simulated = require('./simulated');

const BIN = 'claude';

function available() {
  return hasBin(BIN);
}

// Is the CLI both installed AND signed in? Detected from local auth state — NO model
// round-trip (the old probe cost ~10s and a token every recheck, and routinely timed out
// even when signed in, which kept the setup gate stuck). Claude Code stores an OAuth
// token in ~/.claude/.credentials.json (Windows/Linux); we accept a present token whose
// access token is unexpired OR has a refresh token (the CLI refreshes silently). We also
// honor ANTHROPIC_API_KEY and an account marker in ~/.claude.json (covers macOS Keychain
// installs where the creds file may be absent). Fast, free, and reliable.
function authed() {
  if (!available()) return false;
  if (process.env.ANTHROPIC_API_KEY) return true;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const home = os.homedir();
  // 1) OAuth token file (the authoritative signal on Windows/Linux).
  try {
    const o = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8'));
    const tok = o && o.claudeAiOauth;
    if (tok && tok.accessToken) {
      if (tok.refreshToken) return true; // CLI refreshes an expired token automatically
      if (!tok.expiresAt || Number(tok.expiresAt) > Date.now()) return true;
    }
  } catch {
    /* no creds file — try the next signal */
  }
  // 2) Account marker in the main config (cross-platform; covers Keychain installs).
  try {
    const o = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    if (o && (o.oauthAccount || o.userID || o.user_id)) return true;
  } catch {
    /* none */
  }
  return false;
}

async function send(opts = {}) {
  const { prompt = '', onToken, onTool, signal, timeoutMs, cwd } = opts;
  if (!available()) return simulated.send(opts); // graceful: behave, just simulated
  try {
    // `-p/--print` runs one prompt and exits, streaming to stdout. The prompt is
    // delivered on stdin so multi-word input never breaks on shell quoting. `cwd`,
    // when given, scopes the CLI's file tools to the active workspace (agent mode).
    const res = await streamCli(BIN, ['-p'], { input: prompt, onToken, onTool, signal, timeoutMs, cwd });
    if (res.aborted) return { text: res.text, aborted: true };
    // Empty / failed / timed-out → fall back so the user always gets a reply.
    if (!res.text || !res.text.trim()) return simulated.send(opts);
    return { text: res.text };
  } catch {
    return simulated.send(opts);
  }
}

module.exports = {
  id: 'claude-code',
  label: 'claude-code',
  model: 'claude (CLI)',
  simulated: false,
  available,
  authed,
  // How to get signed in (used by the desktop setup flow). `install` is the page to
  // visit; `signin` is the command we launch in a terminal so OAuth opens a browser.
  setup: {
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    signinCmd: 'claude',
    signinNote: 'A terminal opens and Claude Code walks you through signing in to your Anthropic account in the browser.',
  },
  send,
};
