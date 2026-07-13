'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { emit: busEmit, reset } = require('./bus');
const { ensureRights, allowed, profileVerified, setProfile, setAppUrl } = require('./rights');
const { resolveEngines } = require('./engines');
const { render } = require('./dashboard');
const { scoreCompliance } = require('./compliance');
const freeze = require('./freeze');
const { readStories } = require('./stories');
const pacInit = require('./pac-init');
const preview = require('./preview');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The autonomous lifecycle loop: Intake -> Plan -> Approve -> Build -> Run -> Test
// -> Observe, re-rendering the live dashboard on every event. Guardrails keep
// "never-ending" safe: rights gate, iteration cap, and a no-progress detector.
//
// `opts.delayMs` paces the emits so the live dashboard can be watched moving.
// Fix-mode controls what happens when tests remain red after the first self-heal:
//   'manual' (default) — stop and escalate to the user
//   'diff'             — apply the fix, emit the diff summary, wait for approval, then re-run
//   'auto'             — keep applying fixes and re-running until green (up to maxHealRetries)
const VALID_FIX_MODES = ['manual', 'diff', 'auto'];

async function runLoop(root, opts = {}) {
  const simulate = opts.simulate !== false; // simulated unless explicitly --real
  const maxRotations = opts.rotations || 1;
  const fixMode = VALID_FIX_MODES.includes(opts.fixMode) ? opts.fixMode : 'manual';
  const maxHealRetries = typeof opts.maxHealRetries === 'number' ? opts.maxHealRetries : 3;
  const liveRender = opts.render !== false;
  const delayMs = opts.delayMs || 0;
  if (opts.fresh) reset(root);

  const rights = ensureRights(root, opts.rights);
  const emit = async (event) => {
    const record = busEmit(root, event);
    if (liveRender) render(root);
    // Forward every event to the caller's listener (MCP progress, CLI streaming, etc.).
    // Wrapped in try/catch so a listener error never derails the loop.
    if (typeof opts.emit === 'function') {
      try { await opts.emit(record || event); } catch { /* listener errors are non-fatal */ }
    }
    // Honor a dashboard "pause" between every event.
    if (opts.isPaused) {
      while (opts.isPaused()) await sleep(150);
    }
    if (delayMs) await sleep(delayMs);
    return record;
  };

  // Resolve the engine bundle up front: simulate, or real (code-gen + optional browser).
  // The provider (an AI CLI when present, else the deterministic brain) lets the code
  // engine author richer screens; it is never required. `realMode` drives the rights
  // gate and honest messaging below.
  let provider = null;
  if (!simulate) {
    try {
      provider = require('./providers').resolve(opts.provider);
    } catch {
      provider = null;
    }
  }
  const eng = await resolveEngines(root, { simulate, emit, provider });
  const realMode = !!eng.real;
  const summary = { rotations: 0, specsRun: 0, selfHeals: 0, observations: 0, stopped: false, mode: eng.mode, fixMode };

  // Everything from here runs inside try/finally so the real-mode browser (CDP) is
  // always released — on normal completion, a thrown error, or a duration-cap abort.
  try {
  // Step 0 — intake + rights gate
  await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'info', message: 'Project start · dashboard opened, intake gate active' });
  const goal = opts.goal || 'Describe what the app should do for its users';
  const mvp =
    opts.mvp || 'The first slice to build — a primary view with the core action and fields';

  // Frozen review artifacts are the benchmark: read them, never regenerate. The
  // loop has no path to flip frozen → draft; only the explicit unlock action does.
  const storiesFrozen = freeze.isFrozen(root, 'stories');
  const mvpFrozen = freeze.isFrozen(root, 'mvp');
  if (storiesFrozen || mvpFrozen) {
    const frozenStories = storiesFrozen ? readStories(root) : null;
    const count = frozenStories && Array.isArray(frozenStories.stories) ? frozenStories.stories.length : 0;
    await emit({
      rotation: 0,
      stage: 0,
      agent: 'intake',
      level: 'good',
      message: `Frozen benchmark in effect · ${[storiesFrozen ? `${count} user stories` : null, mvpFrozen ? 'MVP' : null].filter(Boolean).join(' + ')} · building against approved spec (not regenerating)`,
      data: { frozen: { stories: storiesFrozen, mvp: mvpFrozen } },
    });
  }

  const compliance = scoreCompliance(goal, mvp);
  await emit({
    rotation: 0,
    stage: 0,
    agent: 'intake',
    level: compliance.aligned ? 'good' : 'warn',
    message: `Goal + MVP present · compliance ${compliance.score}% · ${compliance.aligned ? 'gate unlocked' : 'DRIFT — clarify before build'}`,
    data: { goal, mvp, compliance: compliance.score, mode: summary.mode },
  });

  // MDM browser profile — verified once for this project, then reused. The pointer
  // is stored in Approved_rights/; the real session stays under a gitignored .profiles/.
  const profile = opts.profile || rights.browserProfile || 'mdm-edge';
  const profilePath = rights.profilePath || `./.profiles/${profile}`;
  await eng.verifyProfile({
    emit,
    rotation: 0,
    profile,
    profilePath,
    alreadyVerified: profileVerified(root),
    persist: (p) => setProfile(root, p),
  });

  let prevFailureSignature = null;
  // The latest rotation's real results, folded back into the plan document at the end so
  // the saved plan records what was actually created and whether it verified.
  let lastBuild = [];
  let lastTest = null;
  let shots = {}; // { after: 'shots/Pxxx-after.png' } when a real screenshot is captured

  for (let r = 1; r <= maxRotations; r += 1) {
    summary.rotations = r;

    // Wall-clock guardrail: an MCP duration cap (or any caller) can abort between
    // rotations so a long real run stops cleanly instead of being killed by a host
    // timeout (which would skip eng.close() below).
    if (opts.shouldAbort && opts.shouldAbort()) {
      await emit({ rotation: r, stage: 0, agent: 'loop', level: 'warn', message: 'Duration cap reached → stopping before next rotation' });
      summary.stopped = true;
      break;
    }

    // Step 1 — plan
    await emit({ rotation: r, stage: 1, agent: 'planner', level: 'info', message: 'Authoring HTML spec artifact (Now→After, recommendation, questions)' });
    await emit({ rotation: r, stage: 1, agent: 'planner', level: 'good', message: 'Artifact ready · "I am completely ready, I have no more questions to ask."' });

    // Step 2 — approve. Real gate: if the caller supplies isApproved, block here
    // until the maker approves (e.g. presses "Build this"). A bounded wait keeps an
    // unattended run from hanging forever — it escalates instead of building unasked.
    if (opts.isApproved) {
      const okToBuild = await waitForApproval(opts.isApproved, opts.isPaused, emit, r, { isRejected: opts.isRejected, shouldAbort: opts.shouldAbort });
      if (!okToBuild) {
        await emit({ rotation: r, stage: 2, agent: 'planner', level: 'warn', message: 'No approval within the wait window → stopping before any build' });
        summary.stopped = true;
        break;
      }
    }
    await emit({ rotation: r, stage: 2, agent: 'planner', level: 'good', message: 'Change approved · proceeding to build' });

    // Step 3 — build (rights-gated). Tasks come from the approved plan via the planner,
    // so the loop builds what the maker actually asked for. Only when no plan and no
    // explicit tasks are supplied do we fall back to a representative sample (keeps the
    // simulated demo legible).
    const tasks = resolveTasks(opts, root);
    if (!allowed(rights, 'allowBuild') && !simulate) {
      await emit({ rotation: r, stage: 3, agent: 'build-executor', level: 'warn', message: 'Approved_rights/ allowBuild=false → stopping to ask before touching the tenant' });
      summary.stopped = true;
      break;
    }
    lastBuild = (await eng.buildExecutor({ emit, rotation: r, tasks, env: opts.env || rights.environmentId, maker: opts.maker || rights.makerUrl })) || [];

    // Make it a real, registered Power Apps Code App when we can. `pac code init` writes
    // the authoritative power.config.json (the Code App marker) at the project root —
    // this is what turns a plain React app into a compliant Code App, the product's whole
    // reason to exist. Runs only in real mode, only when pac is reachable, and only once
    // (skips if already initialised). If pac is missing/unauthed it degrades to a plain-
    // language nudge instead of blocking — auth needs the setup step, which is fine to
    // defer. ponytail: pac owns the SDK version + config schema, so we never hand-author
    // them; we just invoke the real CLI at the root where package.json lives.
    if (realMode) {
      const reg = await pacInit.registerCodeApp(root, {
        appName: opts.name || path.basename(root),
        environmentUrl: opts.env || rights.makerUrl,
        emit: (e) => emit({ rotation: r, stage: 3, agent: 'build-executor', ...e }),
      });
      if (reg && reg.message) {
        await emit({ rotation: r, stage: 3, agent: 'build-executor', level: reg.level || 'info', message: reg.message });
      }
    }

    // Step 4 — run. On-device code builds verify by compiling (no publish needed);
    // publishing live is a separate, gated step. `dataverse` defaults off in real mode
    // (build on the maker's machine) and on in simulate (to show the push narrative).
    const dataverse = opts.dataverse != null ? opts.dataverse : !realMode;
    let baseUrl;
    if (dataverse) {
      if (!allowed(rights, 'allowPush') && !simulate) {
        await emit({ rotation: r, stage: 4, agent: 'runner', level: 'warn', message: 'Publishing is off (Approved_rights allowPush=false) → built on-device only; flip Publish to go live' });
        summary.stopped = true;
        break;
      }
      if (realMode) {
        // Real publish: pac code push deploys the Code App to the tenant. Best-effort —
        // a push failure is surfaced in plain language and doesn't crash the loop; the
        // maker can fix setup and re-run.
        try {
          await pacInit.pushCodeApp(root, { emit: (e) => emit({ rotation: r, stage: 4, agent: 'runner', ...e }) });
        } catch (e) {
          const first = (e && e.message ? String(e.message).split('\n')[0] : 'pac code push failed');
          await emit({ rotation: r, stage: 4, agent: 'runner', level: 'warn', message: `Publish to Power Platform failed: ${first} · check Power Platform setup and try again` });
        }
      } else {
        await emit({ rotation: r, stage: 4, agent: 'runner', level: 'good', message: 'Dataverse connected → pac code push · got app link (simulated)' });
      }
      baseUrl = opts.appUrl || rights.appUrl || (realMode ? '' : 'https://apps.powerapps.com/play/e/demo-env/a/demo-app');
      if (baseUrl) {
        setAppUrl(root, baseUrl);
        rights.appUrl = baseUrl;
        await emit({ rotation: r, stage: 4, agent: 'runner', level: 'good', message: `Captured app URL → ${baseUrl} · stored in Approved_rights/approval.json` });
      }
    } else {
      // On-device: the build gate compiles the app (real) via a live preview server, or a
      // local dev URL (simulate — unchanged, a labeled demo value, never touched here).
      // Real mode calls preview.start() for a genuine dev-server URL instead of leaving
      // baseUrl fabricated/empty by accident; honest degrade (never a fake URL) mirrors
      // pacInit.pushCodeApp's try/catch a few lines above. Extracted to
      // resolveOnDeviceBaseUrl() so it's testable without running the whole loop (same
      // shape as pacInit.registerCodeApp's `_pac` boundary).
      baseUrl = opts.appUrl || rights.appUrl || '';
      if (!baseUrl) {
        baseUrl = realMode
          ? await resolveOnDeviceBaseUrl(root, { rotation: r, emit, _previewStart: opts._previewStart })
          : 'http://127.0.0.1:5173';
      }
      await emit({
        rotation: r,
        stage: 4,
        agent: 'runner',
        level: 'good',
        message: realMode ? 'Built on your device · verifying by compiling your app' : `No Dataverse → npm run dev on ${(baseUrl || 'localhost').replace('http://', '')}`,
      });
    }

    // Step 5 — test, with self-heal + fix-mode loop.
    // fixMode controls what happens when tests remain red after the first heal:
    //   manual — stop immediately and escalate (current default)
    //   diff   — apply the fix, emit a diff event, wait for approval, then re-run once
    //   auto   — keep healing and re-running until green or maxHealRetries is exhausted
    const specs = opts.specs || ['projects-grid.spec.ts', 'status-chip.spec.ts', 'new-project.spec.ts'];
    const injectDefect = r === 1 && opts.selfHeal !== false ? specs[0] : null;
    summary.specsRun += specs.length;
    let result = await eng.e2eTester({ emit, rotation: r, specs, injectDefect, baseUrl });

    if (!result.passed) {
      const signature = result.failures.join(',');
      if (signature === prevFailureSignature) {
        await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: 'No-progress detector: same failure twice with no spec change → stop & escalate' });
        summary.stopped = true;
        break;
      }
      prevFailureSignature = signature;
      await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'bad', message: `${result.failures.length} check(s) red · coverage ${result.coverage}%` });

      // First heal attempt (always runs regardless of fixMode).
      await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'info', message: `Self-heal: repairing ${result.failures[0]}` });
      summary.selfHeals += 1;
      if (eng.heal) await eng.heal({ emit, rotation: r, failures: result.failures });
      result = await eng.e2eTester({ emit, rotation: r, specs, injectDefect: null, baseUrl });

      // If still red, apply the chosen fix strategy.
      if (!result.passed) {
        if (fixMode === 'auto') {
          // Keep healing up to maxHealRetries without pausing.
          let retries = 0;
          while (!result.passed && retries < maxHealRetries) {
            retries += 1;
            const newSig = result.failures.join(',');
            if (newSig === prevFailureSignature) {
              await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: `Auto-fix: no progress after ${retries} attempt(s) · stopping` });
              summary.stopped = true;
              break;
            }
            prevFailureSignature = newSig;
            await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'info', message: `Auto-fix attempt ${retries}/${maxHealRetries}: repairing ${result.failures[0]}` });
            summary.selfHeals += 1;
            if (eng.heal) await eng.heal({ emit, rotation: r, failures: result.failures });
            result = await eng.e2eTester({ emit, rotation: r, specs, injectDefect: null, baseUrl });
          }
          if (!result.passed && !summary.stopped) {
            await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: `Auto-fix exhausted (${maxHealRetries} attempt(s)) · still red · escalating` });
            summary.stopped = true;
          }
        } else if (fixMode === 'diff') {
          // Emit the fix summary so the user can review, then wait for approval.
          await emit({
            rotation: r,
            stage: 5,
            agent: 'e2e-tester',
            level: 'info',
            message: `Fix applied for ${result.failures.length} issue(s) · review the diff and approve to re-run`,
            data: { fixMode: 'diff', failures: result.failures, needsApproval: true },
          });
          if (opts.isApproved) {
            const approved = await waitForApproval(opts.isApproved, opts.isPaused, emit, r, { timeoutMs: 300000, isRejected: opts.isRejected, shouldAbort: opts.shouldAbort });
            if (approved) {
              await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'info', message: 'Diff approved · re-running tests' });
              if (eng.heal) await eng.heal({ emit, rotation: r, failures: result.failures });
              result = await eng.e2eTester({ emit, rotation: r, specs, injectDefect: null, baseUrl });
              if (!result.passed) {
                await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: `Still red after approved fix · ${result.failures.length} issue(s) · escalating` });
                summary.stopped = true;
              }
            } else {
              await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: 'Diff not approved within timeout · stopping' });
              summary.stopped = true;
            }
          } else {
            // No approval gate configured: apply fix and continue (best-effort).
            if (eng.heal) await eng.heal({ emit, rotation: r, failures: result.failures });
            result = await eng.e2eTester({ emit, rotation: r, specs, injectDefect: null, baseUrl });
            if (!result.passed) {
              await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: `Still red after fix (no approval gate) · ${result.failures.length} issue(s) · escalating` });
              summary.stopped = true;
            }
          }
        } else {
          // manual (default): stop and escalate.
          await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: `Still red after self-heal · ${result.failures.length} issue(s) · escalating to you` });
          summary.stopped = true;
        }
      }
    }

    if (summary.stopped) break;
    lastTest = result;
    // Only claim green when it actually is. A real app still red after self-heal escalates.
    if (result.passed) {
      await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'good', message: `Green · ${specs.length}/${specs.length} specs · ${result.coverage}% MVP coverage` });
      // Tier-2 "After" screenshot for the plan's Now/After visuals — only when a live app
      // URL and a real browser engine are available; otherwise the plan keeps its mockup.
      if (opts.planId && eng.screenshot && baseUrl) {
        try {
          const codeTask = (tasks || []).find((t) => String(t.type || '').startsWith('code.'));
          const route = codeTask && codeTask.route ? codeTask.route : '';
          const url = baseUrl.replace(/\/$/, '') + route;
          const shotsDir = path.join(require('./plans').plansDir(root), 'shots');
          fs.mkdirSync(shotsDir, { recursive: true });
          const rel = `shots/${opts.planId}-after.png`;
          const shot = await eng.screenshot({ url, outPath: path.join(shotsDir, `${opts.planId}-after.png`), rotation: r, emit });
          if (shot && shot.ok) {
            shots.after = rel;
            await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'good', message: `Captured an "after" screenshot for the plan → ${rel}` });
          }
        } catch {
          /* screenshots are a nice-to-have; never let one fail the run */
        }
      }
    }

    // Step 6 — observe -> re-spec
    const observation = pickObservation(r);
    if (observation) {
      summary.observations += 1;
      const auto = observation.signal === 'defect' && allowed(rights, 'allowAutoApplyDefects');
      await emit({
        rotation: r,
        stage: 6,
        agent: 'observer',
        level: 'observation',
        message: `Authored next spec from observation · ${observation.signal} · ${observation.title}`,
        data: { signal: observation.signal, confidence: observation.confidence, needsApproval: !auto },
      });
    }
  }

  await emit({
    rotation: summary.rotations,
    stage: 7,
    agent: 'loop',
    level: summary.stopped ? 'warn' : 'good',
    message: summary.stopped ? 'Loop stopped (guardrail / escalation to you)' : 'Loop complete · green & matches approved MVP',
  });

  // Fold the real build outcome back into the comprehensive plan document so the saved
  // plan records what was actually created and whether it verified — making it learnable.
  if (opts.planId) {
    try {
      const codeBuilt = (lastBuild || []).filter((b) => String(b.task || '').startsWith('code.'));
      const outcome = {
        built: codeBuilt.map((b) => ({ name: b.name, file: b.file || null, created: !!b.created, wired: !!b.wired, source: b.source || null })),
        verified: lastTest ? lastTest.passed : null,
        ran: !!lastTest,
        coverage: lastTest ? lastTest.coverage : null,
        errors: lastTest && Array.isArray(lastTest.failures) ? lastTest.failures.slice(0, 12) : [],
        shots: Object.keys(shots).length ? shots : undefined,
        finishedAt: new Date().toISOString(),
      };
      require('./planhtml').foldOutcome(root, opts.planId, outcome);
      try {
        require('./memory').noteOutcome(root, outcome);
      } catch {
        /* memory is best-effort */
      }
    } catch {
      /* re-rendering the plan must never affect the loop's result */
    }
  }
  } finally {
    if (eng.close) await eng.close(); // release the CDP connection in real mode (no-op when simulated)
    if (liveRender) render(root);
  }
  return summary;
}

// Real-mode stage-4 baseUrl: calls preview.js for a genuine dev-server URL instead of
// leaving baseUrl fabricated/empty by accident. Honest degrade (result.ok === false)
// emits the plain-language message and leaves baseUrl empty — never a fake URL. Exported
// as its own function (mirrors pacInit.registerCodeApp's testable-without-the-loop shape,
// `_pac` → `_previewStart`) so selftest can inject a fake preview.start instead of
// spawning a real npm/vite process.
async function resolveOnDeviceBaseUrl(root, { rotation, emit, _previewStart } = {}) {
  const previewStart = _previewStart || preview.start;
  const result = await previewStart(root, { emit: (e) => emit({ rotation, stage: 4, agent: 'runner', ...e }) });
  if (result && result.url) return result.url;
  if (result && result.ok === false) {
    await emit({ rotation, stage: 4, agent: 'runner', level: 'warn', message: result.message });
  }
  return '';
}

// Turn the run options into concrete build tasks. Priority: explicit opts.tasks →
// planner output from the approved plan/goal → a representative sample (demo legibility).
function resolveTasks(opts, root) {
  if (Array.isArray(opts.tasks) && opts.tasks.length) return opts.tasks;
  if (opts.plan || opts.goal) {
    try {
      const { planTasks } = require('./planner');
      const { readDigest } = require('./digest');
      const out = planTasks({ goal: opts.goal, plan: opts.plan, digest: readDigest(root) });
      if (out.tasks && out.tasks.length) return out.tasks;
    } catch {
      /* fall through to the sample */
    }
  }
  // No plan/goal. For a code app, fall back to building a real generic screen on-device
  // (never a tenant task that would require Power Platform sign-in). Only a non-code
  // project falls back to the Dataverse sample, which keeps the simulated demo legible.
  try {
    if (require('./codegen').isCodeApp(root)) {
      const { planTasks } = require('./planner');
      const out = planTasks({ goal: 'A simple list screen for your app', plan: { title: 'Plan: Main screen', items: ['Show a searchable list', 'Mark items done'] } });
      if (out.tasks && out.tasks.length) return out.tasks;
    }
  } catch {
    /* fall through to the sample */
  }
  return [
    { type: 'dataverse.table.create', displayName: 'Project', name: 'cr123_project' },
    { type: 'dataverse.column.add', displayName: 'Status (choice)', name: 'status' },
    { type: 'dataverse.column.add', displayName: 'DueDate (datetime)', name: 'duedate' },
  ];
}

// Block at the Approve stage until isApproved() returns true, honoring pause and a
// bounded timeout. Returns true when approved, false if the window elapses, the caller
// rejects (isRejected), or the run is aborted (shouldAbort). The first poll
// short-circuits the common case (chat's Build = pre-approved) with no waiting.
async function waitForApproval(isApproved, isPaused, emit, rotation, { timeoutMs = 600000, pollMs = 200, isRejected, shouldAbort } = {}) {
  if (isApproved()) return true;
  await emit({ rotation, stage: 2, agent: 'planner', level: 'info', message: 'Waiting for your approval to build (press “Build this”)' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isRejected && isRejected()) return false;
    if (shouldAbort && shouldAbort()) return false;
    if (isPaused) {
      while (isPaused()) await sleep(150);
    }
    if (isApproved()) return true;
    await sleep(pollMs);
  }
  return false;
}

function pickObservation(rotation) {
  const list = [
    { signal: 'gap', confidence: 0.74, title: 'Approved "Archive" screen has no e2e spec' },
    { signal: 'improvement', confidence: 0.63, title: 'Empty-state on Tasks list feels abrupt' },
  ];
  return list[(rotation - 1) % list.length];
}

module.exports = { runLoop, resolveOnDeviceBaseUrl };
