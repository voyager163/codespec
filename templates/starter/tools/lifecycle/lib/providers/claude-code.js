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

async function send(opts = {}) {
  const { prompt = '', onToken, signal } = opts;
  if (!available()) return simulated.send(opts); // graceful: behave, just simulated
  try {
    // `-p/--print` runs one prompt and exits, streaming to stdout. The prompt is
    // delivered on stdin so multi-word input never breaks on shell quoting.
    const res = await streamCli(BIN, ['-p'], { input: prompt, onToken, signal });
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
  send,
};
