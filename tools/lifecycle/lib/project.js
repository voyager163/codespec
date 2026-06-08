'use strict';
// Project-type detection. PowerCodex is Power-Apps-first but not Power-Apps-only, so it
// looks at the active workspace and decides which capabilities should engage:
//
//   powerapps-code — a React/TS code app (the flagship path; codegen + build-verify)
//   powerbi        — a Power BI project (.pbix / .pbip / .pbit / TMDL)
//   web            — a generic web/JS project (package.json, no Power Apps signals)
//   docs           — a documentation / content folder (markdown, no build)
//   empty          — a fresh, empty workspace
//   unknown        — anything else
//
// Detection is shallow and cheap (root listing + a couple of known files), and never
// throws — an unreadable folder simply reads as 'unknown'.
const fs = require('node:fs');
const path = require('node:path');

function safeList(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function hasPowerBiSignals(root, entries) {
  const names = entries.map((e) => e.name.toLowerCase());
  if (names.some((n) => /\.(pbix|pbip|pbit|pbids)$/.test(n))) return true;
  // .pbip projects keep a "<name>.Dataset" / "<name>.Report" folder, often with TMDL.
  if (names.some((n) => /\.(report|dataset|semanticmodel)$/.test(n))) return true;
  if (exists(path.join(root, 'definition')) || entries.some((e) => e.isDirectory() && /\.dataset$/i.test(e.name))) {
    // TMDL lives under a model folder; a shallow check for a .tmdl anywhere at the top.
    if (names.some((n) => n.endsWith('.tmdl'))) return true;
  }
  return false;
}

function detect(root) {
  const entries = safeList(root);
  const visible = entries.filter((e) => !e.name.startsWith('.'));
  const names = visible.map((e) => e.name.toLowerCase());

  if (!visible.length) return { type: 'empty', label: 'Empty workspace', signals: [] };

  // Power BI first — it can sit next to a package.json in tooling repos.
  if (hasPowerBiSignals(root, entries)) {
    return { type: 'powerbi', label: 'Power BI project', signals: ['Power BI files (.pbix/.pbip/TMDL)'] };
  }

  const hasPkg = exists(path.join(root, 'package.json'));
  if (hasPkg) {
    let codeApp = false;
    try {
      codeApp = require('./codegen').isCodeApp(root);
    } catch {
      codeApp = false;
    }
    if (codeApp) return { type: 'powerapps-code', label: 'Power Apps code app', signals: ['React/TS code app'] };
    return { type: 'web', label: 'Web / JavaScript project', signals: ['package.json'] };
  }

  // No package.json: docs folder if it's mostly markdown, else unknown.
  const md = names.filter((n) => n.endsWith('.md') || n.endsWith('.mdx'));
  if (md.length && md.length >= Math.max(1, Math.floor(visible.length * 0.4))) {
    return { type: 'docs', label: 'Documentation', signals: [`${md.length} markdown file(s)`] };
  }
  return { type: 'unknown', label: 'Project', signals: [] };
}

module.exports = { detect };
