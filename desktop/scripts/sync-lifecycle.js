'use strict';
// Vendor the zero-dependency lifecycle tool into the desktop app so it ships inside
// the packaged .exe. Runs before `start` and `dist`. Skips generated/runtime dirs.
const fs = require('node:fs');
const path = require('node:path');

const src = path.resolve(__dirname, '..', '..', 'tools', 'lifecycle');
const dst = path.resolve(__dirname, '..', 'vendor', 'lifecycle');

if (!fs.existsSync(src)) {
  console.error('Cannot find the lifecycle tool at', src);
  process.exit(1);
}

const SKIP = /(^|[\\/])(node_modules|\.powercodex|\.profiles|\.git|dist)([\\/]|$)/;

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.cpSync(src, dst, {
  recursive: true,
  filter: (s) => !SKIP.test(s),
});

console.log('synced lifecycle →', path.relative(process.cwd(), dst));

// Vendor the whole templates/ tree (starter + github OPSX prompts/skills + the fixed
// openspec/config.yaml) and bin/create-powercodex.js, so "✨ New project" inside the
// packaged app can spawn the exact same full scaffold the `powercodex` CLI produces
// (one CLI, two entry points — decision D5, extended). scaffold-cli.js resolves the
// vendored bin at vendor/bin/create-powercodex.js, which in turn resolves its own
// template root at vendor/templates/ relative to itself — no path changes needed
// inside create-powercodex.js itself.
const templatesSrc = path.resolve(__dirname, '..', '..', 'templates');
const templatesDst = path.resolve(__dirname, '..', 'vendor', 'templates');
if (fs.existsSync(templatesSrc)) {
  fs.rmSync(templatesDst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(templatesDst), { recursive: true });
  fs.cpSync(templatesSrc, templatesDst, { recursive: true, filter: (s) => !SKIP.test(s) });
  console.log('synced templates →', path.relative(process.cwd(), templatesDst));
} else {
  console.warn('templates/ not found at', templatesSrc, '— desktop scaffold will fall back to the generic template, and "New project" will be unavailable');
}

const binSrc = path.resolve(__dirname, '..', '..', 'bin', 'create-powercodex.js');
const binDst = path.resolve(__dirname, '..', 'vendor', 'bin', 'create-powercodex.js');
if (fs.existsSync(binSrc)) {
  fs.mkdirSync(path.dirname(binDst), { recursive: true });
  fs.copyFileSync(binSrc, binDst);
  console.log('synced create-powercodex.js →', path.relative(process.cwd(), binDst));
} else {
  console.warn('bin/create-powercodex.js not found — "New project" will be unavailable in this build');
}
