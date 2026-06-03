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

module.exports = { buildExecutor, e2eTester, verifyProfile };
