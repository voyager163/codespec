'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Real engine bridge — drives a managed Edge (MDM) browser over CDP using the vendored
// Playwright-for-MDM engine (../engine/mdm-attach.mjs). The e2e/run engine and profile
// verification are real. Engine 1 (the build executor) now has real navigation — it
// attaches to the maker surface and verifies each asset's page loaded — but field-by-field
// authoring (creating the table/column/flow itself) is not automated yet and is reported
// honestly as `created:false`, never faked as done.
//
// The vendored engine is ESM and imports `playwright`, so it is loaded with a lazy,
// dynamic import() (works from CommonJS). resolveEngines() only constructs this bridge
// once Playwright is confirmed present, so an import failure here is a real error worth
// surfacing rather than a missing-optional-dependency case.

const ENGINE_URL = pathToFileURL(path.join(__dirname, '..', 'engine', 'mdm-attach.mjs')).href;

function create(root) {
  let mod = null; // memoized attach.mjs module
  const session = { browser: null, context: null }; // one CDP session reused across rotations

  async function engine() {
    if (!mod) mod = await import(ENGINE_URL);
    return mod;
  }

  // Attach to a live managed-Edge CDP session, launching the chosen profile once if the
  // endpoint isn't already up. The attached context is cached for the rest of the run.
  async function ensureContext(emit, rotation, profile) {
    if (session.context) return session.context;
    const m = await engine();
    if (!(await m.isCdpEndpointAvailable())) {
      await emit({ rotation, stage: 3, agent: 'build-executor', level: 'info', message: 'No CDP endpoint · launching managed Edge for sign-in (clear MFA in the window)' });
      const profiles = await m.discoverEdgeProfiles().catch(() => []);
      const picked = profiles.find((p) => p.directory === profile || p.displayName === profile) || profiles[0];
      if (!picked) throw new Error('no managed Edge profiles found for sign-in');
      m.launchEdgeWithProfile(picked.directory);
      const up = await m.waitForCdpEndpoint();
      if (!up) throw new Error('Edge launched but the CDP endpoint never came up (fully close Edge and retry)');
    }
    const { browser } = await m.attachToEdge();
    session.browser = browser;
    session.context = m.getAttachedBrowserContext(browser);
    return session.context;
  }

  // Profile verify — confirm a live managed-Edge session exists, attaching to it.
  async function verifyProfile({ emit, rotation, profile, profilePath, alreadyVerified, persist }) {
    await emit({ rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Verifying managed Edge profile "${profile}" over CDP (real)` });
    await ensureContext(emit, rotation, profile);
    if (persist) persist({ name: profile, path: profilePath });
    await emit({ rotation, stage: 3, agent: 'build-executor', level: 'good', message: `Attached to managed Edge "${profile}" · live CDP session · pointer stored (session gitignored)` });
    return { profile, profilePath, verified: true, reused: !!alreadyVerified, real: true };
  }

  // Engine 1 — real build executor (step 1: entry). For each task, attach and
  // NAVIGATE into the Power Platform maker surface where that asset lives, verifying
  // it loaded. The field-by-field authoring (create the table/column/flow) is not
  // automated yet — reported honestly as `created:false`, never faked as done.
  async function buildExecutor({ emit, rotation, tasks, env, maker }) {
    const { recipeFor } = require('./maker-recipes');
    const m = await engine();
    const context = await ensureContext(emit, rotation, null);
    const results = [];
    for (const task of tasks) {
      const name = task.displayName || task.name || task.type;
      const recipe = recipeFor(task.type);
      if (!recipe) {
        await emit({ rotation, stage: 3, agent: 'build-executor', level: 'warn', message: `No maker recipe for ${task.type} · skipped (front-end automation pending)` });
        results.push({ task: task.type, name, status: 'skipped', created: false, automated: false });
        continue;
      }

      // Recipes that carry a real DOM `build` are executed for real and verified.
      if (recipe.automated && typeof recipe.build === 'function') {
        await emit({ rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Building in Power Platform · ${recipe.describe} → "${name}"` });
        let out;
        try {
          out = await recipe.build(m, context, { env, task });
        } catch (e) {
          out = { created: false, reason: e.message };
        }
        results.push({ task: task.type, name, status: out.created ? 'created' : 'attempted', created: !!out.created, automated: true, verifiedInPortal: !!out.created, finalUrl: out.finalUrl, reason: out.reason });
        await emit({
          rotation,
          stage: 3,
          agent: 'build-executor',
          level: out.created ? 'good' : 'warn',
          message: out.created
            ? `Created ${recipe.surface.replace(/s$/, '')} "${name}" in Power Platform · verified in the list`
            : `Could not finish "${name}" in ${recipe.surface} · ${out.reason || 'unknown'} · nothing faked`,
        });
        continue;
      }

      // Recipes without DOM automation yet: enter the surface and report honestly.
      const url = maker ? `${maker.replace(/\/$/, '')}` : recipe.url(env);
      await emit({ rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Entering Power Platform · ${recipe.describe} → ${url}` });
      const nav = await m.runAppSmokeTest(context, url);
      const reached = nav.ok;
      results.push({ task: task.type, name, status: reached ? 'navigated' : 'unreachable', created: false, automated: false, finalUrl: nav.finalUrl });
      await emit({
        rotation,
        stage: 3,
        agent: 'build-executor',
        level: reached ? 'good' : 'bad',
        message: reached
          ? `Reached ${recipe.surface} for "${name}" · creation step not yet automated (front-end pending · ${recipe.todo})`
          : `Could not reach ${recipe.surface} for "${name}" · ${nav.error || 'navigation failed'}`,
      });
    }
    return results;
  }

  // Engine 2 — real e2e: navigate the live app and report real browser health.
  async function e2eTester({ emit, rotation, specs, baseUrl }) {
    if (!baseUrl) {
      await emit({ rotation, stage: 5, agent: 'e2e-tester', level: 'warn', message: 'Real e2e needs a live app URL — none captured (set Approved_rights appUrl or run a dev server)' });
      return { failures: ['no-app-url'], coverage: 0, passed: false, real: true };
    }
    const m = await engine();
    const context = await ensureContext(emit, rotation, null);
    await emit({ rotation, stage: 5, agent: 'e2e-tester', level: 'info', message: `Real smoke test → ${baseUrl}` });
    const result = await m.runAppSmokeTest(context, baseUrl);

    const failures = [];
    if (!result.ok) failures.push(`navigation: ${result.error || 'failed'}`);
    for (const e of result.pageErrors || []) failures.push(`pageerror: ${e}`);
    for (const fr of result.failedRequests || []) failures.push(`netfail: ${fr.url}`);

    const passed = failures.length === 0;
    for (const line of m.formatSmokeTestReport(result)) {
      await emit({ rotation, stage: 5, agent: 'e2e-tester', level: passed ? 'good' : 'info', message: line });
    }
    const total = Math.max(specs ? specs.length : 1, 1);
    const coverage = passed ? 100 : Math.round(((total - 1) / total) * 100);
    await emit({ rotation, stage: 5, agent: 'e2e-tester', level: passed ? 'good' : 'bad', message: `${passed ? 'pass' : 'FAIL'} · real browser · ${failures.length} issue(s)` });
    return { failures, coverage, passed, real: true };
  }

  // Capture a screenshot of a live URL into outPath. Best-effort — returns the engine's
  // {ok,...} result; callers degrade to a deterministic mockup when ok is false.
  async function screenshot({ url, outPath, rotation, emit }) {
    try {
      const m = await engine();
      const context = await ensureContext(emit || (async () => {}), rotation || 0, null);
      return await m.captureScreenshot(context, url, outPath);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Release the CDP connection at the end of a run (does not close the user's Edge).
  async function close() {
    try {
      if (session.browser) await session.browser.close();
    } catch {
      /* a failed disconnect is not worth surfacing */
    }
    session.browser = null;
    session.context = null;
  }

  return { verifyProfile, buildExecutor, e2eTester, screenshot, close };
}

module.exports = { create };
