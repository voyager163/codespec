'use strict';
// Adapter → GitHub Copilot CLI. Prefers the standalone `copilot` CLI; falls back
// to the `gh copilot` extension. Streams the answer back token-by-token. Auth is
// delegated to the GitHub CLI (`gh auth login` + the Copilot extension); this
// adapter never handles credentials. Not present → available() is false and the
// registry falls back to another provider.
const { hasBin, streamCli } = require('./_cli');
const simulated = require('./simulated');

// Returns the invocation [cmd, prefixArgs] for whichever Copilot surface exists.
function locate() {
  if (hasBin('copilot')) return ['copilot', ['-p']];
  if (hasBin('gh')) return ['gh', ['copilot', 'explain']];
  return null;
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
  send,
};
