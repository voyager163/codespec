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
