'use strict';
// Adapter → GitHub Copilot CLI. Prefers the standalone `copilot` CLI; falls back
// to the `gh copilot` extension. Streams the answer back token-by-token. Auth is
// delegated to the GitHub CLI (`gh auth login` + the Copilot extension); this
// adapter never handles credentials. Not present → available() is false and the
// registry falls back to another provider.
const { hasBin, streamCli, probeSync } = require('./_cli');
const simulated = require('./simulated');

// Returns the invocation [cmd, prefixArgs] for whichever Copilot surface exists.
function locate() {
  if (hasBin('copilot')) return ['copilot', ['-p']];
  if (hasBin('gh')) return ['gh', ['copilot', 'explain']];
  return null;
}

// Installed AND signed in? For the gh path we check `gh auth status` and that the
// Copilot extension is present. For the standalone `copilot` CLI we confirm it runs.
function authed() {
  if (hasBin('gh')) {
    const auth = probeSync('gh', ['auth', 'status'], { timeoutMs: 7000 });
    if (!auth.ok) return false;
    const ext = probeSync('gh', ['extension', 'list'], { timeoutMs: 7000 });
    if (/copilot/i.test(ext.out)) return true;
    // gh is signed in but the Copilot extension is missing → not ready yet.
    if (hasBin('copilot')) return probeSync('copilot', ['--version'], { timeoutMs: 6000 }).ok;
    return false;
  }
  if (hasBin('copilot')) return probeSync('copilot', ['--version'], { timeoutMs: 6000 }).ok;
  return false;
}

async function send(opts = {}) {
  const { prompt = '', onToken, onTool, signal, timeoutMs } = opts;
  const loc = locate();
  if (!loc) return simulated.send(opts);
  try {
    const [cmd, prefix] = loc;
    // Prompt on stdin (no shell-quoting hazard); flags only in argv.
    const res = await streamCli(cmd, prefix, { input: prompt, onToken, onTool, signal, timeoutMs });
    if (res.aborted) return { text: res.text, aborted: true };
    if (!res.text || !res.text.trim()) return simulated.send(opts);
    return { text: res.text };
  } catch {
    return simulated.send(opts);
  }
}

module.exports = {
  id: 'github-copilot',
  label: 'github-copilot',
  model: 'gh copilot (CLI)',
  simulated: false,
  available() {
    return !!locate();
  },
  authed,
  setup: {
    installUrl: 'https://docs.github.com/en/copilot/github-copilot-in-the-cli',
    installCmd: 'gh extension install github/gh-copilot',
    // Sign in to GitHub, then ensure the Copilot extension is present.
    signinCmd: 'gh auth login && gh extension install github/gh-copilot',
    signinNote: 'A terminal opens to sign in to GitHub; then the Copilot CLI extension is installed.',
  },
  send,
};
