'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { detectStack } = require('./import');

// Brownfield ingestion: a deterministic, read-only walk of a pre-existing repo
// that produces a structured digest of what the app already does — routes,
// components, data calls, and npm scripts — each entry citing the source file it
// came from. Zero-dependency (fs + regex, no AST). The digest is the grounding
// input for code-aware user stories and the MVP; it never writes into the user's
// source tree, only into .powercodex/.

// Keep the walk bounded so a large repo can't hang the loop. Recorded in the
// digest as `coverage`/`truncated` when a cap is hit.
const LIMITS = { files: 600, fileBytes: 256 * 1024 };
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.vite', '.powercodex', '.profiles']);
const SOURCE_RE = /\.(jsx?|tsx?|vue|svelte)$/i;

// Walk `dir` collecting source files, skipping vendored/build/dot folders and
// honoring the file-count cap. Returns { files, truncated }.
function collectSources(root) {
  const files = [];
  let truncated = false;
  const srcRoot = fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root;
  const stack = [srcRoot];
  while (stack.length) {
    if (files.length >= LIMITS.files) {
      truncated = true;
      break;
    }
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        stack.push(path.join(dir, name));
      } else if (SOURCE_RE.test(name)) {
        files.push(path.join(dir, name));
      }
    }
  }
  return { files, truncated };
}

// Project-root-relative, forward-slashed path so the digest is portable.
function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// Heuristic, language-agnostic surface extraction. Cheap regex over the file
// text — explainable and reproducible. Misses are acceptable: stories cite the
// file so the user can verify, and the MVP keeps a goal-only fallback.
function scanFile(root, abs, sink) {
  let text;
  try {
    const stat = fs.statSync(abs);
    if (stat.size > LIMITS.fileBytes) {
      sink.skipped.push(rel(root, abs));
      return;
    }
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    sink.skipped.push(rel(root, abs));
    return;
  }
  const file = rel(root, abs);

  // Routes: <Route path="…">, createBrowserRouter paths, Next.js file routes.
  for (const m of text.matchAll(/<Route[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    sink.routes.push({ path: m[1], source: file });
  }
  for (const m of text.matchAll(/\bpath\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    if (/route|router|path/i.test(text.slice(Math.max(0, m.index - 40), m.index))) {
      sink.routes.push({ path: m[1], source: file });
    }
  }

  // Components: exported PascalCase functions/consts and default-exported components.
  for (const m of text.matchAll(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]+)/g)) {
    sink.components.push({ name: m[1], source: file });
  }
  for (const m of text.matchAll(/export\s+const\s+([A-Z][A-Za-z0-9]+)\s*[:=]/g)) {
    sink.components.push({ name: m[1], source: file });
  }

  // Data / connector access: fetch, axios, TanStack Query, Power Platform services.
  for (const m of text.matchAll(/\b(useQuery|useMutation|fetch|axios|getService|connector|dataverse|PowerProvider|cr[0-9a-f]{3,}_[a-z0-9_]+)\b/gi)) {
    sink.data.push({ symbol: m[1], source: file });
  }
}

// Build a digest for `root`. Pure-ish: reads files, writes nothing. The caller
// (import --analyze) is responsible for persisting it to .powercodex/digest.json.
function buildDigest(root, opts = {}) {
  const stack = detectStack(root);
  const { files, truncated: walkTruncated } = collectSources(root);
  const sink = { routes: [], components: [], data: [], skipped: [] };
  for (const abs of files) scanFile(root, abs, sink);

  // De-duplicate while preserving first-seen provenance.
  const dedupe = (arr, key) => {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const k = `${item[key]}@${item.source}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  };

  // npm scripts straight from package.json (already metadata, but useful surface).
  let scripts = [];
  try {
    const pkgFile = path.join(root, 'package.json');
    if (fs.existsSync(pkgFile)) {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      scripts = Object.entries(pkg.scripts || {}).map(([name, cmd]) => ({ name, cmd, source: 'package.json' }));
    }
  } catch {
    /* a missing/broken package.json just means no scripts surface */
  }

  const routes = dedupe(sink.routes, 'path');
  const components = dedupe(sink.components, 'name');
  const data = dedupe(sink.data, 'symbol');
  const truncated = walkTruncated || sink.skipped.length > 0;

  return {
    name: stack.name,
    mode: stack.mode, // 'tenant' (Power Platform) | 'local-run'
    runner: stack.runner,
    generatedAt: new Date().toISOString(),
    coverage: {
      filesScanned: files.length,
      filesSkipped: sink.skipped.length,
      truncated,
      partial: truncated,
    },
    routes,
    components,
    data,
    scripts,
  };
}

// Persist a digest under .powercodex/. Returns the absolute path written.
function writeDigest(root, digest) {
  const dir = path.join(root, '.powercodex');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'digest.json');
  fs.writeFileSync(out, `${JSON.stringify(digest, null, 2)}\n`);
  return out;
}

function digestFile(root) {
  return path.join(root, '.powercodex', 'digest.json');
}

function readDigest(root) {
  const file = digestFile(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { buildDigest, writeDigest, readDigest, digestFile };
