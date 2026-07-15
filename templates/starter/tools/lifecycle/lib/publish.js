'use strict';
// publish.js — take the built app live on Power Platform, for real, from the UI.
//
// This is the "Publish" the desktop product promises. It orchestrates the real
// Power Platform CLI (pac) flow that already lives in pac-init.js, but wires it into
// a single consent-gated action the maker can trigger from the window:
//
//   consent (allowPush) → pac present? → local build passes → pac auth →
//   pac code init (once) → pac code push → capture the live app URL.
//
// Everything is real and reported honestly. Where a step needs something the machine
// doesn't have (pac not installed, no auth profile, a failing build), we stop with a
// precise, actionable message rather than pretending it worked. Publishing pushes to a
// live environment, so it is OFF until the maker explicitly confirms it here — that
// confirmation is what flips Approved_rights/approval.json allowPush on.
const fs = require('node:fs');
const path = require('node:path');
const pac = require('./pac-init');
const rights = require('./rights');
const { verifyBuild } = require('./codegen');

// Pull the play URL out of `pac code push` output so the maker can open the live app.
function extractAppUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s'"]*(?:powerapps\.com|powerplatform\.com|dynamics\.com)[^\s'"]*/i);
  return m ? m[0].replace(/[).,]+$/, '') : '';
}

// Has `pac code init` already run in this project? Best-effort marker check so we don't
// re-init (which can error) on every publish.
function isCodeInitialised(root) {
  const markers = ['power.config.json', '.power', path.join('src', 'PowerProvider.tsx'), 'powerapp.config.json'];
  return markers.some((m) => fs.existsSync(path.join(root, m)));
}

// Pre-flight status for the Publish modal: is pac installed, which auth profiles exist,
// is publishing currently allowed, and a sensible default app name. Never throws.
async function check(root) {
  const out = { pacInstalled: false, pacVersion: null, authProfiles: [], allowPush: false, appName: path.basename(root), environmentUrl: '' };
  try {
    const r = rights.load(root) || rights.DEFAULTS;
    out.allowPush = r.allowPush === true;
    out.environmentUrl = r.appUrl || '';
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, '.powercodex', 'config.json'), 'utf8'));
      if (cfg.name) out.appName = cfg.name;
    } catch { /* basename is a fine default */ }
  } catch { /* rights optional */ }
  try {
    out.pacVersion = await pac.checkPac();
    out.pacInstalled = true;
    out.authProfiles = await pac.listAuthProfiles();
  } catch (e) {
    out.pacInstalled = false;
    out.pacError = e.message;
  }
  return out;
}

// Publish for real. `confirm:true` is the explicit consent to go live (and persists
// allowPush). Streams progress via `emit({ level, message })`. Returns a structured
// result; `ok:true` only after `pac code push` actually succeeds.
async function publish(root, { appName, environmentUrl, confirm, skipGovernance, emit = async () => {} } = {}) {
  if (!confirm) {
    return { ok: false, needsConsent: true, message: 'Publishing goes to a live Power Platform environment. Confirm to continue.' };
  }

  // Governance gate (CLAUDE.md Rule 2): never publish straight off a protected branch,
  // and don't go live over failed/pending security checks when they're verifiable.
  if (!skipGovernance) {
    try {
      const gate = await require('./governance').gatePublish(root);
      if (gate.blocking) {
        await emit({ level: 'bad', message: gate.reason });
        return { ok: false, stage: 'governance', error: gate.reason, gate };
      }
      if (gate.note) await emit({ level: 'warn', message: gate.note });
    } catch { /* governance is best-effort — never hard-fail the flow on its own error */ }
  }

  // 1. Persist explicit consent (Approved_rights/approval.json allowPush = true).
  try {
    const r = rights.ensureRights(root);
    r.allowPush = true;
    if (environmentUrl) r.environmentUrl = environmentUrl;
    rights.save(root, r);
  } catch (e) {
    return { ok: false, stage: 'consent', error: 'Could not record publish consent: ' + e.message };
  }

  // 2. pac present?
  try {
    const version = await pac.checkPac();
    await emit({ level: 'info', message: `Power Platform CLI ${version} detected` });
  } catch (e) {
    await emit({ level: 'bad', message: e.message });
    return { ok: false, stage: 'pac-missing', error: e.message };
  }

  // 3. Local build must pass before anything goes live — the honest gate.
  await emit({ level: 'info', message: 'Verifying the app builds before publishing…' });
  const build = verifyBuild(root);
  if (!build.ran) {
    const msg = 'Cannot publish yet: ' + (build.reason || 'the project could not be built');
    await emit({ level: 'bad', message: msg });
    return { ok: false, stage: 'build', error: msg };
  }
  if (!build.passed) {
    await emit({ level: 'bad', message: 'Build failed — fix the errors, then publish again.' });
    return { ok: false, stage: 'build', error: 'The app does not build yet.', errors: build.errors || [] };
  }
  await emit({ level: 'good', message: 'Build passed' });

  // 4. Authenticate to the target environment (reuses an existing profile if present).
  if (environmentUrl) {
    try {
      await pac.ensureAuth(environmentUrl, { emit });
    } catch (e) {
      await emit({ level: 'bad', message: e.message });
      return { ok: false, stage: 'auth', error: e.message };
    }
  }

  // 5. pac code init — once. Tolerate "already initialised".
  if (!isCodeInitialised(root)) {
    const init = await pac.initCodeApp(root, { appName: appName || path.basename(root), outputDir: root, emit });
    if (!init.initialised && !/already|exists|initialis/i.test(init.error || '')) {
      return { ok: false, stage: 'init', error: init.error || 'pac code init failed' };
    }
  } else {
    await emit({ level: 'info', message: 'Code App already initialised — pushing latest' });
  }

  // 6. Push it live.
  const pushed = await pac.pushCodeApp(root, { appDir: root, emit });
  if (!pushed.pushed) {
    return { ok: false, stage: 'push', error: pushed.error || 'pac code push failed', output: pushed.output };
  }

  // 7. Capture and persist the live app URL for the smoke tester and the maker.
  const url = extractAppUrl(pushed.output) || environmentUrl || '';
  if (url) {
    try { rights.setAppUrl(root, url); } catch { /* best-effort */ }
    await emit({ level: 'good', message: `Live at ${url}` });
  } else {
    await emit({ level: 'good', message: 'Published. Open Power Apps to find your live app.' });
  }
  return { ok: true, url, output: pushed.output };
}

module.exports = { check, publish, extractAppUrl, isCodeInitialised };
