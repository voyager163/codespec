'use strict';
// The always-available fallback brain. It streams a plausible, useful response
// token-by-token (so the cockpit's streaming UI is exercised) and can surface a
// tool event, without needing any external CLI or network. Real adapters mirror
// this exact interface; swap them in and nothing else in the cockpit changes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send({ prompt, onToken, onTool, signal, delayMs = 12 } = {}) {
  const reply = compose(prompt || '');
  let out = '';
  for (const tok of reply.tokens) {
    if (signal && signal.aborted) return { text: out, aborted: true };
    out += tok;
    if (onToken) onToken(tok);
    if (delayMs) await sleep(delayMs);
  }
  if (reply.tool && onTool) onTool(reply.tool);
  return { text: out };
}

// Tiny intent shaping so the simulated brain feels responsive to the prompt.
function compose(prompt) {
  const p = prompt.toLowerCase();
  let line;
  let tool = null;
  if (/add|create|new|build/.test(p)) {
    line = `Planning that change. I'll draft the edit, apply it, then run the e2e check against the running app.`;
    tool = { name: 'edit', target: 'screens/Main.fx.yaml', meta: '+12 −2' };
  } else if (/test|verify|check|run/.test(p)) {
    line = `Running the end-to-end suite now and watching for regressions.`;
    tool = { name: 'e2e', target: 'all specs', meta: 'streaming…' };
  } else if (/plan/.test(p)) {
    line = `Drafting an HTML plan with the sections and tasks, then I'll mark it ready to open.`;
  } else if (!prompt.trim()) {
    line = `Ready. Type a request, or / for commands.`;
  } else {
    line = `Got it. Here's how I'd approach that, scoped to the current MVP and gated by your Approved_rights.`;
  }
  // Split into word-ish tokens to drive the streaming renderer.
  const tokens = line.match(/\S+\s*/g) || [line];
  return { tokens, tool };
}

module.exports = {
  id: 'simulated',
  label: 'simulated',
  model: 'powercodex-sim',
  simulated: true,
  available() {
    return true;
  },
  send,
};
