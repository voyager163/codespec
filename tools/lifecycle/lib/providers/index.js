'use strict';
// The provider bridge — "bring your own AI". The cockpit and lifecycle never
// special-case a vendor; they talk to this registry. Each adapter exposes the
// same shape, so /provider can hot-swap the brain mid-session.
//
//   adapter = {
//     id, label, model,
//     available(): boolean,            // is the vendor CLI present + usable?
//     async send({ prompt, history, onToken, onTool, signal }) -> { text }
//   }
//
// When a vendor CLI is not installed, the registry still works: it falls back to
// the simulated adapter so the cockpit is always usable (honest by default —
// exactly how the engines ship as adapters with a simulation fallback).
const simulated = require('./simulated');
const claudeCode = require('./claude-code');
const githubCopilot = require('./github-copilot');

// Order matters: the first available real provider becomes the default.
const ADAPTERS = [claudeCode, githubCopilot, simulated];

function list() {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    model: a.model,
    available: safeAvailable(a),
    simulated: a.simulated === true,
  }));
}

function safeAvailable(a) {
  try {
    return !!a.available();
  } catch {
    return false;
  }
}

function get(id) {
  return ADAPTERS.find((a) => a.id === id) || null;
}

// Resolve the active provider: the requested one if usable, else the first
// available real adapter, else the simulated fallback (never null).
function resolve(preferredId) {
  if (preferredId) {
    const want = get(preferredId);
    if (want && safeAvailable(want)) return want;
  }
  const real = ADAPTERS.find((a) => !a.simulated && safeAvailable(a));
  if (real) return real;
  return simulated;
}

module.exports = { list, get, resolve, ADAPTERS };
