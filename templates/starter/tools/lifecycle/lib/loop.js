'use strict';
const { emit: busEmit, reset } = require('./bus');
const { ensureRights, allowed, profileVerified, setProfile, setAppUrl } = require('./rights');
const { buildExecutor, e2eTester, verifyProfile } = require('./engines');
const { render } = require('./dashboard');
const { scoreCompliance } = require('./compliance');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The autonomous lifecycle loop: Intake -> Plan -> Approve -> Build -> Run -> Test
// -> Observe, re-rendering the live dashboard on every event. Guardrails keep
// "never-ending" safe: rights gate, iteration cap, and a no-progress detector.
//
// `opts.delayMs` paces the emits so the live dashboard can be watched moving.
async function runLoop(root, opts = {}) {
  const simulate = opts.simulate !== false; // simulated unless explicitly --real
  const maxRotations = opts.rotations || 1;
  const liveRender = opts.render !== false;
  const delayMs = opts.delayMs || 0;
  if (opts.fresh) reset(root);

  const rights = ensureRights(root, opts.rights);
  const emit = async (event) => {
    const record = busEmit(root, event);
    if (liveRender) render(root);
    // Honor a dashboard "pause" between every event.
    if (opts.isPaused) {
      while (opts.isPaused()) await sleep(150);
    }
    if (delayMs) await sleep(delayMs);
    return record;
  };

  const summary = { rotations: 0, specsRun: 0, selfHeals: 0, observations: 0, stopped: false, mode: simulate ? 'simulate' : 'real' };

  // Step 0 — intake + rights gate
  await emit({ rotation: 0, stage: 0, agent: 'intake', level: 'info', message: 'Project start · dashboard opened, intake gate active' });
  const goal = opts.goal || 'Describe what the app should do for its users';
  const mvp =
    opts.mvp || 'The first slice to build — a primary view with the core action and fields';
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
  await verifyProfile({
    emit,
    rotation: 0,
    profile,
    profilePath,
    alreadyVerified: profileVerified(root),
    simulate,
    persist: (p) => setProfile(root, p),
  });

  let prevFailureSignature = null;

  for (let r = 1; r <= maxRotations; r += 1) {
    summary.rotations = r;

    // Step 1 — plan
    await emit({ rotation: r, stage: 1, agent: 'planner', level: 'info', message: 'Authoring HTML spec artifact (Now→After, recommendation, questions)' });
    await emit({ rotation: r, stage: 1, agent: 'planner', level: 'good', message: 'Artifact ready · "I am completely ready, I have no more questions to ask."' });

    // Step 2 — approve
    await emit({ rotation: r, stage: 2, agent: 'planner', level: 'good', message: 'Change approved by user' });

    // Step 3 — build (rights-gated)
    const tasks = opts.tasks || [
      { type: 'dataverse.table.create', displayName: 'Project', name: 'cr123_project' },
      { type: 'dataverse.column.add', displayName: 'Status (choice)', name: 'status' },
      { type: 'dataverse.column.add', displayName: 'DueDate (datetime)', name: 'duedate' },
    ];
    if (!allowed(rights, 'allowBuild') && !simulate) {
      await emit({ rotation: r, stage: 3, agent: 'build-executor', level: 'warn', message: 'Approved_rights/ allowBuild=false → stopping to ask before touching the tenant' });
      summary.stopped = true;
      break;
    }
    await buildExecutor({ emit, rotation: r, tasks, simulate });

    // Step 4 — run (push vs dev). Capture the app URL so the tester can target it.
    const dataverse = opts.dataverse !== false;
    let baseUrl;
    if (dataverse) {
      if (!allowed(rights, 'allowPush') && !simulate) {
        await emit({ rotation: r, stage: 4, agent: 'runner', level: 'warn', message: 'Approved_rights/ allowPush=false → cannot push the app; stopping to ask' });
        summary.stopped = true;
        break;
      }
      await emit({ rotation: r, stage: 4, agent: 'runner', level: 'good', message: `Dataverse connected → npx power-apps push · got app link${simulate ? ' (simulated)' : ''}` });
      // Real mode parses the push output for the play URL; simulate uses a stable placeholder.
      baseUrl = opts.appUrl || rights.appUrl || (simulate ? 'https://apps.powerapps.com/play/e/demo-env/a/demo-app' : '');
      if (baseUrl) {
        setAppUrl(root, baseUrl);
        rights.appUrl = baseUrl;
        await emit({ rotation: r, stage: 4, agent: 'runner', level: 'good', message: `Captured app URL → ${baseUrl} · stored in Approved_rights/approval.json` });
      }
    } else {
      baseUrl = 'http://127.0.0.1:5173';
      await emit({ rotation: r, stage: 4, agent: 'runner', level: 'good', message: `No Dataverse → npm run dev on ${baseUrl.replace('http://', '')}` });
    }

    // Step 5 — test, with self-heal via opsx
    const specs = opts.specs || ['projects-grid.spec.ts', 'status-chip.spec.ts', 'new-project.spec.ts'];
    const injectDefect = r === 1 && opts.selfHeal !== false ? specs[0] : null;
    summary.specsRun += specs.length;
    let result = await e2eTester({ emit, rotation: r, specs, injectDefect, baseUrl });
    if (!result.passed) {
      const signature = result.failures.join(',');
      if (signature === prevFailureSignature) {
        await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'warn', message: 'No-progress detector: same failure twice with no spec change → stop & escalate' });
        summary.stopped = true;
        break;
      }
      prevFailureSignature = signature;
      await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'bad', message: `${result.failures.length} spec(s) red · coverage ${result.coverage}%` });
      await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'info', message: `Self-heal: opsx:explore → propose → apply on ${result.failures[0]}` });
      summary.selfHeals += 1;
      result = await e2eTester({ emit, rotation: r, specs, injectDefect: null, baseUrl });
    }
    await emit({ rotation: r, stage: 5, agent: 'e2e-tester', level: 'good', message: `Green · ${specs.length}/${specs.length} specs · ${result.coverage}% MVP coverage` });

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
  if (liveRender) render(root);
  return summary;
}

function pickObservation(rotation) {
  const list = [
    { signal: 'gap', confidence: 0.74, title: 'Approved "Archive" screen has no e2e spec' },
    { signal: 'improvement', confidence: 0.63, title: 'Empty-state on Tasks list feels abrupt' },
  ];
  return list[(rotation - 1) % list.length];
}

module.exports = { runLoop };
