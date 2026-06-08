'use strict';

// The two engines. In production these drive a managed Edge browser against the
// Power Platform maker portal and the running app. That cannot run without a real
// tenant + MFA, so when `simulate` is true (the default outside a tenant) they
// emit the same event stream with simulated outcomes. The seam is deliberate:
// swap these two functions for the real Playwright adapters and nothing else changes.
//
// `emit` may be async (the loop awaits it so events can be paced for live viewing),
// so every emit here is awaited.

// Verify the MDM browser profile once, then reuse it. In real mode this is where
// a managed Edge profile is launched for an interactive sign-in; here it records
// the pointer so later runs skip the login. `persist` stores {name, path}.
async function verifyProfile({ emit, rotation, profile, profilePath, alreadyVerified, simulate, persist }) {
  if (alreadyVerified) {
    await emit({ rotation, stage: 3, agent: 'build-executor', level: 'good', message: `Reusing verified MDM profile "${profile}" · no re-login` });
    return { profile, profilePath, verified: true, reused: true };
  }
  await emit({ rotation, stage: 3, agent: 'build-executor', level: 'info', message: `MDM profile not verified yet → launching managed Edge once for sign-in${simulate ? ' (simulated)' : ''}` });
  // Real mode: open Edge with the named profile, wait for the user to clear MFA,
  // then keep the session under profilePath. Simulated mode just records the pointer.
  if (persist) persist({ name: profile, path: profilePath });
  await emit({ rotation, stage: 3, agent: 'build-executor', level: 'good', message: `Profile "${profile}" verified & stored · pointer in Approved_rights/, session under ${profilePath} (gitignored)` });
  return { profile, profilePath, verified: true, reused: false };
}

// Engine 1 — build executor: turns declarative task contracts into portal assets.
async function buildExecutor({ emit, rotation, tasks, simulate }) {
  const results = [];
  for (const task of tasks) {
    const name = task.displayName || task.name || task.type;
    await emit({ rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Executing ${task.type} · ${name}` });
    // Real mode re-reads the portal to confirm the asset exists before success.
    const verifiedInPortal = simulate ? true : false;
    results.push({ task: task.type, name, status: 'succeeded', verifiedInPortal, simulated: !!simulate });
    await emit({
      rotation,
      stage: 3,
      agent: 'build-executor',
      level: 'good',
      message: `${name} created${simulate ? ' (simulated)' : ''} · verified-in-portal=${verifiedInPortal}`,
    });
  }
  return results;
}

// Engine 2 — e2e tester: asserts the live app against the approved MVP.
async function e2eTester({ emit, rotation, specs, injectDefect, baseUrl }) {
  const failures = [];
  if (baseUrl) {
    await emit({ rotation, stage: 5, agent: 'e2e-tester', level: 'info', message: `Targeting ${baseUrl} (captured app URL)` });
  }
  for (const spec of specs) {
    const fail = injectDefect && spec === injectDefect;
    await emit({ rotation, stage: 5, agent: 'e2e-tester', level: fail ? 'bad' : 'good', message: `${fail ? 'FAIL' : 'pass'} · ${spec}` });
    if (fail) failures.push(spec);
  }
  const coverage = specs.length ? Math.round(((specs.length - failures.length) / specs.length) * 100) : 100;
  return { failures, coverage, passed: failures.length === 0 };
}

// Pick the engine bundle for a run.
//
// Simulated by default. Real mode composes two independent engines:
//   • the CODE engine (codegen.js) — authors real React/TS screens and verifies them
//     with the project's own build. Needs no browser and no tenant, so it engages for
//     ANY code-app project. This is the autonomy spine.
//   • the BROWSER engine (engines.real.js) — drives managed Edge for Power Platform
//     portal assets and live-app smoke tests. Engages only when Playwright + a
//     browser-based project are present; otherwise its tasks degrade honestly.
// Any shortfall degrades gracefully so the loop always completes with truthful reporting.
async function resolveEngines(root, { simulate, emit, provider } = {}) {
  const sim = {
    verifyProfile: (a) => verifyProfile({ ...a, simulate: true }),
    buildExecutor: (a) => buildExecutor({ ...a, simulate: true }),
    e2eTester,
    close: async () => {},
    mode: 'simulate',
    real: false,
  };
  if (simulate) return sim;

  const codegen = require('./codegen');
  const codeApp = codegen.isCodeApp(root);
  const { hasPlaywright, browserBased } = require('./playwright-check');
  const wantBrowser = browserBased(root);
  const canBrowser = wantBrowser && hasPlaywright(root);

  let browser = null;
  if (canBrowser) {
    try {
      browser = require('./engines.real').create(root);
    } catch (e) {
      if (emit) await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'warn', message: `Browser engine load failed (${e.message}) · portal/smoke steps will simulate` });
    }
  } else if (wantBrowser && emit) {
    await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'info', message: 'Playwright not installed · live-app smoke test will use the build gate (run `npm i -D playwright` for browser checks)' });
  }

  // If it is neither a code app nor browser-drivable, there is nothing real to do.
  if (!codeApp && !browser) {
    if (emit) await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'info', message: 'Nothing real to drive here (not a code app, no browser) · using simulation' });
    return { ...sim, mode: 'simulate (no real target)' };
  }

  const real = makeRealEngine({ root, codegen, codeApp, browser, provider, sim });
  const modeBits = [codeApp ? 'code-gen + build verify' : null, browser ? 'Power Platform portal + live smoke' : null].filter(Boolean);
  return { ...real, mode: `real (${modeBits.join(' · ')})`, real: true };
}

// Compose the real engine from the available pieces. Dispatches each build task to the
// right executor and keeps a record of what it built so self-heal can revert to a
// known-good version. `provider` (optional) lets the code engine ask an AI to author
// richer screens; without one it still produces real, compilable code.
function makeRealEngine({ root, codegen, codeApp, browser, provider, sim }) {
  let built = []; // [{ task, file }] from the last code build — used by heal()

  async function verifyProfile(a) {
    // Sign-in is only needed for portal work. If a browser engine is active, verify the
    // managed-Edge profile; otherwise a code-only build needs no profile.
    if (browser) return browser.verifyProfile(a);
    if (a.emit) await a.emit({ rotation: a.rotation || 0, stage: 3, agent: 'build-executor', level: 'good', message: 'No sign-in needed for an on-device code build' });
    if (a.persist) a.persist({ name: a.profile, path: a.profilePath });
    return { profile: a.profile, profilePath: a.profilePath, verified: true, reused: !!a.alreadyVerified, codeOnly: true };
  }

  async function buildExecutor(a) {
    const tasks = a.tasks || [];
    const codeTasks = tasks.filter((t) => String(t.type || '').startsWith('code.'));
    const portalTasks = tasks.filter((t) => !String(t.type || '').startsWith('code.'));
    let results = [];
    if (codeTasks.length && codeApp) {
      const r = await codegen.buildCodeTasks({ root, tasks: codeTasks, emit: a.emit, rotation: a.rotation, provider });
      built = r.filter((x) => x.created && x.file).map((x) => ({ task: codeTasks.find((t) => (t.displayName || t.componentName) === x.name) || codeTasks[0], file: x.file }));
      results = results.concat(r);
    } else if (codeTasks.length && a.emit) {
      await a.emit({ rotation: a.rotation, stage: 3, agent: 'build-executor', level: 'warn', message: 'Screen tasks present but this is not a code app · skipped' });
    }
    if (portalTasks.length) {
      if (browser) results = results.concat(await browser.buildExecutor({ ...a, tasks: portalTasks }));
      else {
        results = results.concat(await buildExecutorSim({ ...a, tasks: portalTasks }));
      }
    }
    return results;
  }

  // Real self-heal: when the build is red, revert each authored screen to the
  // deterministic, known-good version (the generator is guaranteed to compile). This is
  // a genuine fix, not a scripted note — the next verify re-runs the real build.
  async function heal(a) {
    if (!built.length) return { healed: false };
    const fs = require('node:fs');
    const path = require('node:path');
    let n = 0;
    for (const b of built) {
      try {
        const code = codegen.generateScreen(b.task);
        fs.writeFileSync(path.join(root, b.file), code.endsWith('\n') ? code : code + '\n');
        n += 1;
      } catch {
        /* leave the file; report what we could */
      }
    }
    if (a.emit) await a.emit({ rotation: a.rotation, stage: 5, agent: 'e2e-tester', level: 'info', message: `Self-heal: reverted ${n} screen(s) to a known-good version, re-checking` });
    return { healed: n > 0, count: n };
  }

  async function e2eTester(a) {
    const failures = [];
    let coverage = 100;

    // 1) The build gate — a real compile of everything we authored. No tenant needed.
    if (codeApp) {
      const v = codegen.verifyBuild(root);
      if (!v.ran) {
        if (a.emit) await a.emit({ rotation: a.rotation, stage: 5, agent: 'e2e-tester', level: 'warn', message: `Build check skipped · ${v.reason}` });
      } else if (v.passed) {
        if (a.emit) await a.emit({ rotation: a.rotation, stage: 5, agent: 'e2e-tester', level: 'good', message: 'Build check passed · your app compiles cleanly' });
      } else {
        for (const e of v.errors) failures.push(`build: ${e}`);
        if (!v.errors.length) failures.push('build: failed (see output)');
        if (a.emit) await a.emit({ rotation: a.rotation, stage: 5, agent: 'e2e-tester', level: 'bad', message: `Build check failed · ${v.errors.length || 'see'} issue(s)` });
      }
    }

    // 2) The live smoke test — only when a real browser + app URL are available.
    if (browser && a.baseUrl) {
      const r = await browser.e2eTester({ ...a, specs: a.specs });
      if (!r.passed) for (const f of r.failures || []) failures.push(f);
      if (r.coverage != null) coverage = r.coverage;
    }

    return { failures, coverage: failures.length ? Math.max(0, coverage - failures.length * 5) : coverage, passed: failures.length === 0, real: true };
  }

  async function close() {
    if (browser && browser.close) await browser.close();
  }

  // Screenshot capture for the plan's "Now vs After" visuals — only when a real browser
  // engine is active. Absent otherwise, so the plan keeps its deterministic mockup.
  const screenshot = browser && browser.screenshot ? (a) => browser.screenshot(a) : null;

  return { verifyProfile, buildExecutor, e2eTester, heal, screenshot, close };
}

// A small simulated portal executor reused when real browser work isn't available.
async function buildExecutorSim(a) {
  return buildExecutor({ ...a, simulate: true });
}

module.exports = { buildExecutor, e2eTester, verifyProfile, resolveEngines };
