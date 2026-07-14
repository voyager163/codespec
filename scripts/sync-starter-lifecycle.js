'use strict';
// Make templates/starter/tools/lifecycle/ a GENERATED copy of tools/lifecycle/ (the dev
// copy), mirroring how desktop/scripts/sync-lifecycle.js vendors the same tool into the
// desktop app. Do NOT hand-edit the starter copy — edit tools/lifecycle/ and re-run
// `npm run sync:starter`. A drift guard in tools/lifecycle/lib/selftest.js fails the
// self-test if the starter ever falls out of sync (it calls drift() below).
const fs = require('node:fs');
const path = require('node:path');

const src = path.resolve(__dirname, '..', 'tools', 'lifecycle');
const dst = path.resolve(__dirname, '..', 'templates', 'starter', 'tools', 'lifecycle');

// Runtime/generated dirs never belong in the committed starter tree.
const SKIP = /(^|[\\/])(node_modules|\.powercodex|\.profiles|\.git|dist)([\\/]|$)/;

// Every file the sync would write: { rel, abs } for each non-skipped file under `src`.
function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (SKIP.test(abs)) continue;
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(abs);
    }
  })(src);
  return out.map((abs) => ({ rel: path.relative(src, abs), abs }));
}

// Copy the dev tree over the starter tree, verbatim. Removes the old dest first so a file
// deleted in dev is deleted in the starter too. Returns the list of files written.
function sync() {
  if (!fs.existsSync(src)) throw new Error(`Cannot find the lifecycle tool at ${src}`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, filter: (s) => !SKIP.test(s) });
  return sourceFiles().map((f) => f.rel);
}

// In-memory compare used by the selftest drift guard: return the relative paths that would
// change if sync() ran now — files missing in the starter or with differing bytes, plus
// starter-only files the next sync would delete. Empty array === in sync. Returns [] when
// either tree is absent (e.g. a scaffolded/vendored copy) so it can't false-fail there.
function drift() {
  if (!fs.existsSync(src) || !fs.existsSync(dst)) return [];
  const mismatched = [];
  const expected = new Set();
  for (const { rel, abs } of sourceFiles()) {
    expected.add(rel);
    const twin = path.join(dst, rel);
    if (!fs.existsSync(twin) || !fs.readFileSync(abs).equals(fs.readFileSync(twin))) {
      mismatched.push(rel);
    }
  }
  // Starter-only files (would be removed by the next sync).
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (SKIP.test(abs)) continue;
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) {
        const rel = path.relative(dst, abs);
        if (!expected.has(rel)) mismatched.push(rel);
      }
    }
  })(dst);
  return mismatched.sort();
}

module.exports = { sync, drift, src, dst };

// CLI: `node scripts/sync-starter-lifecycle.js`
if (require.main === module) {
  const written = sync();
  console.log(`synced starter lifecycle → ${path.relative(process.cwd(), dst)} (${written.length} files)`);
}
