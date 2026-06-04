'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const { readDigest } = require('./digest');

// Decide whether the real (Playwright) engines can and should run for a project,
// and produce one explainable recommendation the loop, dashboard, and import all share.
// Zero side effects: only reads the digest and resolves modules.

// Is `playwright` resolvable from the project's node_modules (or this tool's)?
function hasPlaywright(root) {
  try {
    const req = createRequire(path.join(root, 'package.json'));
    req.resolve('playwright');
    return true;
  } catch {
    // Fall back to this tool's own resolver (monorepo / global install).
    try {
      require.resolve('playwright');
      return true;
    } catch {
      return false;
    }
  }
}

// Is this project something a managed browser can meaningfully drive? Power Platform
// (tenant) qualifies, as does any app with web routes/components or a dev/preview
// server. A pure library/CLI with no UI does not — so we never nag those to install
// Playwright. No digest yet → assume a web app and recommend by default.
function browserBased(root) {
  const digest = readDigest(root);
  if (!digest) return true;
  if (digest.mode === 'tenant') return true;
  if ((digest.routes || []).length || (digest.components || []).length) return true;
  const scripts = (digest.scripts || []).map((s) => `${s.name} ${s.cmd}`).join(' ').toLowerCase();
  if (/\b(dev|start|serve|preview)\b|vite|next|react-scripts|webpack|http-server/.test(scripts)) return true;
  return false;
}

// One object that answers: should we go real, and if not, what should we tell the user?
function recommendation(root) {
  const browser = browserBased(root);
  const installed = hasPlaywright(root);
  const needed = browser && !installed;
  return {
    browserBased: browser,
    playwrightInstalled: installed,
    needed,
    command: 'npm i -D playwright',
    message: needed
      ? 'Install Playwright to enable real browser engines · npm i -D playwright'
      : installed
        ? 'Playwright detected · real browser engines available (loop --real)'
        : 'Real engines not recommended · this project is not browser-based',
  };
}

module.exports = { hasPlaywright, browserBased, recommendation };
