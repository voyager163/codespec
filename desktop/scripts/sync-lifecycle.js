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

// The published starter is the canonical scaffold for desktop "Create a new app"
// (decision D5). Vendor it beside the engine so desktop-born projects get the full
// harness / e2e / data layout; scaffold.js resolves it at vendor/templates/starter.
const tplSrc = path.resolve(__dirname, '..', '..', 'templates', 'starter');
const tplDst = path.resolve(__dirname, '..', 'vendor', 'templates', 'starter');
if (fs.existsSync(tplSrc)) {
  fs.rmSync(tplDst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(tplDst), { recursive: true });
  fs.cpSync(tplSrc, tplDst, {
    recursive: true,
    filter: (s) => !SKIP.test(s),
  });
  console.log('synced starter →', path.relative(process.cwd(), tplDst));
} else {
  console.warn('starter template not found at', tplSrc, '— desktop scaffold will fall back to the generic template');
}
