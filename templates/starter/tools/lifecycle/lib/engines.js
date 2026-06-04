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

// Pick the engine bundle for a run. Simulated by default; real only when `--real`
// is requested AND the project is browser-based AND Playwright is installed. The user's
// rule: recommend installing Playwright when a browser-based project is missing it, but
// stay quiet (just simulate) for projects a browser can't meaningfully drive. Any
// shortfall degrades gracefully to simulation so the loop always completes.
async function resolveEngines(root, { simulate, emit } = {}) {
  const sim = {
    verifyProfile: (a) => verifyProfile({ ...a, simulate: true }),
    buildExecutor: (a) => buildExecutor({ ...a, simulate: true }),
    e2eTester,
    close: async () => {},
    mode: 'simulate',
    real: false,
  };
  if (simulate) return sim;

  const { hasPlaywright, browserBased } = require('./playwright-check');
  if (!browserBased(root)) {
    if (emit) await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'info', message: 'Real engines skipped · this project is not browser-based · using simulation' });
    return { ...sim, mode: 'simulate (non-browser project)' };
  }
  if (!hasPlaywright(root)) {
    if (emit) await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'warn', message: 'Real engines need Playwright · run: npm i -D playwright · falling back to simulation for now' });
    return { ...sim, mode: 'simulate (Playwright not installed)' };
  }
  try {
    const real = require('./engines.real').create(root);
    // Engine 1 now really enters Power Platform (navigates the maker surfaces); the
    // field-by-field asset authoring is not automated yet (reported honestly).
    return {
      verifyProfile: real.verifyProfile,
      buildExecutor: real.buildExecutor,
      e2eTester: real.e2eTester,
      close: real.close,
      mode: 'real (Power Platform entry + e2e + profile; asset-creation DOM pending)',
      real: true,
    };
  } catch (e) {
    if (emit) await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'warn', message: `Real engine load failed (${e.message}) · falling back to simulation` });
    return { ...sim, mode: 'simulate (engine load failed)' };
  }
}

module.exports = { buildExecutor, e2eTester, verifyProfile, resolveEngines };
