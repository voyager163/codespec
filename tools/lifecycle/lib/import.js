'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ensureRights } = require('./rights');
const { ensurePlans } = require('./plans');
const providers = require('./providers');

// Detect the target project's stack so the lifecycle knows how to run it.
// Power Platform (Dataverse) → tenant engines; anything else → local-run mode.
function detectStack(targetRoot) {
  const has = (p) => fs.existsSync(path.join(targetRoot, p));
  let pkg = null;
  try {
    if (has('package.json')) pkg = JSON.parse(fs.readFileSync(path.join(targetRoot, 'package.json'), 'utf8'));
  } catch {
    pkg = null;
  }
  const deps = pkg ? Object.assign({}, pkg.dependencies, pkg.devDependencies) : {};
  const dataverse = has('.power') || has('power.config.json') || has('powerapps.config.json') || /power-apps|@microsoft\/power/.test(Object.keys(deps).join(','));
  const runner = deps.vite ? 'vite' : deps.next ? 'next' : pkg && pkg.scripts && pkg.scripts.dev ? 'npm run dev' : null;
  return {
    name: (pkg && pkg.name) || path.basename(targetRoot),
    node: !!pkg,
    runner,
    dataverse,
    mode: dataverse ? 'tenant' : 'local-run',
  };
}

// Vendor PowerCodex into an existing repo: create per-project state (consent gate,
// plan registry), record provider choices + the config, and wire a `cockpit`
// script. Idempotent. Returns a summary the CLI prints. `opts.copyCore(dest)` can
// physically copy the tool; omitted in tests, where we only scaffold state.
function importInto(targetRoot, opts = {}) {
  const created = [];
  const note = (msg) => created.push(msg);

  fs.mkdirSync(path.join(targetRoot, '.powercodex'), { recursive: true });

  const stack = detectStack(targetRoot);
  note(`detected project · ${stack.name} · ${stack.mode}${stack.runner ? ' (' + stack.runner + ')' : ''}`);

  // Consent gate (all rights off by default) + plan registry.
  ensureRights(targetRoot);
  note('created consent gate · Approved_rights/approval.json (all rights off)');
  ensurePlans(targetRoot);
  note('created plan registry · .powercodex/plans/index.json');

  // Provider selection. opts.providers = ['claude-code','github-copilot'] | 'both' | undefined.
  const all = providers.list().filter((p) => !p.simulated).map((p) => p.id);
  let chosen;
  if (opts.providers === 'both' || opts.providers == null) chosen = all;
  else if (Array.isArray(opts.providers)) chosen = opts.providers.filter((p) => all.includes(p));
  else chosen = all.includes(opts.providers) ? [opts.providers] : all;
  if (!chosen.length) chosen = all;

  // Config the cockpit reads on launch.
  const config = {
    name: stack.name,
    mode: stack.mode,
    runner: stack.runner,
    providers: chosen,
    defaultProvider: chosen[0] || 'simulated',
    importedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(targetRoot, '.powercodex', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  note(`providers configured · ${chosen.join(' · ')}`);

  // Wire the cockpit script into package.json when present.
  const pkgFile = path.join(targetRoot, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      pkg.scripts = pkg.scripts || {};
      if (!pkg.scripts.cockpit) {
        pkg.scripts.cockpit = 'powercodex';
        fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
        note('wired script · package.json → "cockpit": "powercodex"');
      } else {
        note('script present · package.json already has a "cockpit" script');
      }
    } catch {
      note('skipped script wiring · package.json could not be parsed');
    }
  }

  // Optionally vendor the tool core (real CLI path); skipped in tests.
  if (typeof opts.copyCore === 'function') {
    const dest = path.join(targetRoot, '.powercodex', 'core');
    opts.copyCore(dest);
    note('vendored core · .powercodex/core/ (zero-dependency)');
  }

  return { stack, config, created };
}

module.exports = { importInto, detectStack };
