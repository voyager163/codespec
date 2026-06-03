'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { runLoop } = require('./loop');
const { readEvents } = require('./bus');
const { liveDir } = require('./paths');
const { approvalFile } = require('./rights');
const { deriveState } = require('./state');
const { serve } = require('./server');
const { scoreCompliance } = require('./compliance');
const { proposeMvp } = require('./mvp');
const { reflect } = require('./reflect');
const { initWorkspace } = require('./workspace');

// Minimal HTTP helper for the live-server checks.
function req(port, method, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: '127.0.0.1', port, path: pathName, method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = {};
          }
          resolve({ code: res.statusCode, json: parsed });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// "Use the product to check against yourself": run the loop end-to-end in a throwaway
// workspace and assert the product actually produced what the plan promises.
async function selftest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-selftest-'));
  const checks = [];
  const check = (name, ok) => {
    checks.push(!!ok);
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  };

  try {
    console.log('PowerCodex Lifecycle · self-test (simulated, 2 rotations)\n');
    const summary = await runLoop(root, { fresh: true, simulate: true, rotations: 2, render: true });
    const events = readEvents(root);
    const stages = new Set(events.map((e) => e.stage));

    check('status bus recorded events', events.length > 12);
    check('Approved_rights/approval.json created', fs.existsSync(approvalFile(root)));
    check('all 7 lifecycle stages emitted (0..6)', [0, 1, 2, 3, 4, 5, 6].every((s) => stages.has(s)));
    check('build executor produced assets', events.some((e) => e.agent === 'build-executor' && e.level === 'good'));
    check('run step honored push-vs-dev rule', events.some((e) => e.agent === 'runner' && /power-apps push|npm run dev/.test(e.message)));
    check('self-heal triggered at least once', summary.selfHeals >= 1);
    check('observer authored a spec from observation', summary.observations >= 1);
    check('loop finished without false stop', summary.stopped === false);

    const indexHtml = path.join(liveDir(root), 'index.html');
    check('live dashboard index.html rendered', fs.existsSync(indexHtml));
    const html = fs.readFileSync(indexHtml, 'utf8');
    check('dashboard carries PowerCodex brand', /PowerCodex/.test(html));
    check('dashboard reflects completion', /complete|matches approved MVP/.test(html));

    // Derived state powers the live dashboard — assert it is well-formed.
    const state = deriveState(root);
    check('derived state has all 7 stages', Array.isArray(state.stages) && state.stages.length === 7);
    check('derived state lists the agents', Array.isArray(state.agents) && state.agents.length >= 5);
    check('derived state reports MVP coverage', state.test && state.test.coverage === 100);

    // Live dashboard server: boot it, hit /api/state, POST control actions + emit.
    const serverChecks = await new Promise((resolve) => {
      const srv = serve(root, { port: 0 });
      srv.on('listening', async () => {
        const port = srv.address().port;
        try {
          const state = await req(port, 'GET', '/api/state');
          const intake = await req(port, 'POST', '/api/action', { type: 'intake', goal: 'track projects and tasks', mvp: 'Projects grid to track projects and tasks' });
          const right = await req(port, 'POST', '/api/action', { type: 'rights', flag: 'allowBuild', value: true });
          const emitted = await req(port, 'POST', '/api/emit', { agent: 'claude', message: 'self-test progress ping', level: 'good' });
          const mvpAct = await req(port, 'POST', '/api/action', { type: 'propose-mvp', goal: 'track projects' });
          const reflectAct = await req(port, 'POST', '/api/action', { type: 'reflect', title: 'server lesson' });
          const after = await req(port, 'GET', '/api/state');
          srv.close(() =>
            resolve({
              state200: state.code === 200 && state.json.brand === 'PowerCodex',
              hasControl: !!(state.json.control && 'running' in state.json.control),
              intakeApplied: intake.json.ok && after.json.intake.goal === 'track projects and tasks',
              complianceComputed: after.json.intake.complianceDetail && after.json.intake.compliance >= 60,
              rightApplied: right.json.ok && after.json.intake.rights.allowBuild === true,
              emitShown: emitted.json.ok && after.json.feed.some((e) => e.agent === 'claude'),
              mvpAct: mvpAct.json.ok && !!mvpAct.json.path,
              reflectAct: reflectAct.json.ok && !!reflectAct.json.lesson,
              hasInsights: after.json.insights && typeof after.json.insights.reworkRate === 'number',
            }),
          );
        } catch {
          srv.close(() => resolve({}));
        }
      });
    });
    check('live server answers /api/state with 200 + JSON', serverChecks.state200);
    check('state exposes control status for the dashboard', serverChecks.hasControl);
    check('POST /api/action intake updates goal', serverChecks.intakeApplied);
    check('intake recomputes real goal↔MVP compliance', serverChecks.complianceComputed);
    check('POST /api/action rights toggles Approved_rights flag', serverChecks.rightApplied);
    check('POST /api/emit shows external progress on the board', serverChecks.emitShown);
    check('POST /api/action propose-mvp generates an MVP', serverChecks.mvpAct);
    check('POST /api/action reflect logs a lesson', serverChecks.reflectAct);
    check('state exposes computed insights', serverChecks.hasInsights);

    // Pure-function + module checks for the refinement features.
    check('compliance scores alignment', scoreCompliance('track projects and tasks', 'grid to track projects and tasks').aligned === true);
    check('compliance detects drift', scoreCompliance('track projects and tasks', 'an unrelated widget').aligned === false);
    const mvpPath = proposeMvp(root, { goal: 'track projects and tasks' });
    check('MVP proposer writes a self-contained preview.html', fs.existsSync(mvpPath) && /<!doctype html>/i.test(fs.readFileSync(mvpPath, 'utf8')));
    const lesson = reflect(root, { title: 'verify source access before planning', severity: 'major' });
    check('reflection writes a Learning_Experience lesson', fs.existsSync(lesson.file));
    const refreshed = deriveState(root);
    check('insights count logged lessons', refreshed.insights.lessons >= 1);
    check('insights compute self-heals from the run', refreshed.insights.selfHeals >= 1);
    check('notifications surface pending approvals', refreshed.notifications.length >= 1);

    // Cross-project learning: a lesson logged in project A is visible from project B.
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-ws-'));
    const projA = path.join(wsRoot, 'app-a');
    const projB = path.join(wsRoot, 'app-b');
    fs.mkdirSync(projA, { recursive: true });
    fs.mkdirSync(projB, { recursive: true });
    initWorkspace(wsRoot, { name: 'demo-workspace' });
    reflect(projA, { title: 'shared lesson from app-a', severity: 'major' });
    const stateB = deriveState(projB);
    check('lesson from project A is visible from project B (shared brain)', stateB.insights.lessons >= 1);
    check('dashboard state reports the workspace', stateB.workspace && stateB.workspace.name === 'demo-workspace');
    fs.rmSync(wsRoot, { recursive: true, force: true });

    // Guardrail proof: with no granted rights and real (non-simulated) mode, build must stop.
    const gateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-gate-'));
    const gated = await runLoop(gateRoot, { fresh: true, simulate: false, rotations: 1, render: false });
    check('rights gate blocks build when not allowed (real mode)', gated.stopped === true);
    fs.rmSync(gateRoot, { recursive: true, force: true });

    const passed = checks.filter(Boolean).length;
    const ok = checks.every(Boolean);
    console.log(`\n${ok ? 'PASS' : 'FAIL'} · ${passed}/${checks.length} checks · summary ${JSON.stringify(summary)}`);
    return ok;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { selftest };
