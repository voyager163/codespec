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
const providers = require('./providers');
const planRegistry = require('./plans');
const { createSession } = require('./cockpit');
const { importInto, detectStack } = require('./import');

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

    // ── v2 cockpit · providers · plans · import ──────────────────────────────
    // Providers: registry always usable, simulated streams tokens, switch works.
    const provList = providers.list();
    check('providers registry lists claude-code + github-copilot + simulated', ['claude-code', 'github-copilot', 'simulated'].every((id) => provList.some((p) => p.id === id)));
    check('a provider always resolves (simulated fallback never null)', !!providers.resolve('does-not-exist'));
    let streamed = '';
    const sim = await providers.resolve('simulated').send({ prompt: 'add a due-date column', onToken: (t) => (streamed += t) });
    check('simulated provider streams tokens to onToken', streamed.length > 0 && sim.text === streamed);
    const ac = new AbortController();
    ac.abort();
    const aborted = await providers.resolve('simulated').send({ prompt: 'long task', signal: ac.signal });
    check('provider send honors an abort signal (interrupt)', aborted.aborted === true);

    // Plan registry + viewer.
    planRegistry.ensurePlans(root);
    fs.writeFileSync(path.join(planRegistry.plansDir(root), 'sample-plan.html'), '<!doctype html><title>sample</title>');
    const planEntry = planRegistry.registerPlan(root, { title: 'Sample plan', file: '.powercodex/plans/sample-plan.html', provider: 'simulated', sections: 3 });
    check('plan registry records a plan with an id', /^P\d+$/.test(planEntry.id));
    check('plan registry lists + finds the latest plan', planRegistry.latestPlan(root) && planRegistry.latestPlan(root).id === planEntry.id);
    const resolvedPlan = planRegistry.resolvePlan(root, 'latest', 4321);
    check('plan resolver returns a servable url + path', resolvedPlan && /\/\.powercodex\//.test(resolvedPlan.url) && fs.existsSync(resolvedPlan.absPath));

    // Cockpit session: command routing + chat streaming, no TTY required.
    const session = createSession(root, { provider: 'simulated' });
    const help = await session.handle('/help');
    check('cockpit /help lists commands', help.kind === 'command' && help.lines.some((l) => /\/provider/.test(l)));
    const provCmd = await session.handle('/provider');
    check('cockpit /provider shows the active brain', provCmd.lines.some((l) => /simulated/.test(l)));
    const rightsCmd = await session.handle('/rights build on');
    check('cockpit /rights toggles the consent gate on disk', rightsCmd.sideEffect === 'rights' && fs.existsSync(approvalFile(root)));
    let chatStream = '';
    const chat = await session.handle('add a status chip to the list', { onToken: (t) => (chatStream += t) });
    check('cockpit chat turn streams an assistant reply', chat.kind === 'chat' && chatStream.length > 0);
    check('cockpit records prompt history', session.history.includes('/help') && session.history.length >= 4);
    const planList = await session.handle('/plan list');
    check('cockpit /plan list surfaces registered plans', planList.lines.some((l) => /Sample plan/.test(l)));

    // Live server now serves /api/plans and the plan HTML itself.
    const planServerChecks = await new Promise((resolve) => {
      const srv = serve(root, { port: 0 });
      srv.on('listening', async () => {
        const port = srv.address().port;
        try {
          const apiPlans = await req(port, 'GET', '/api/plans');
          const getRaw = (p) => new Promise((res2) => {
            http.get({ host: '127.0.0.1', port, path: p }, (r) => {
              let d = '';
              r.on('data', (c) => (d += c));
              r.on('end', () => res2({ code: r.statusCode, body: d }));
            }).on('error', () => res2({ code: 0, body: '' }));
          });
          const planPage = await getRaw('/' + resolvedPlan.entry.file);
          const guidePage = await getRaw('/guide');
          srv.close(() => resolve({
            apiOk: apiPlans.code === 200 && Array.isArray(apiPlans.json.plans) && apiPlans.json.plans.length >= 1,
            pageOk: planPage.code === 200 && /sample/.test(planPage.body),
            guideOk: guidePage.code === 200 && /User Guide/.test(guidePage.body),
          }));
        } catch {
          srv.close(() => resolve({}));
        }
      });
    });
    check('live server answers /api/plans', planServerChecks.apiOk);
    check('live server serves the generated plan HTML', planServerChecks.pageOk);
    check('live server serves the user guide at /guide', planServerChecks.guideOk);

    // Portable import into a throwaway "any project".
    const impRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-import-'));
    fs.writeFileSync(path.join(impRoot, 'package.json'), JSON.stringify({ name: 'acme-portal', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }, null, 2));
    const imp = importInto(impRoot, { providers: 'both' });
    check('import detects the stack (local-run for non-Dataverse)', detectStack(impRoot).mode === 'local-run');
    check('import scaffolds .powercodex/config.json', fs.existsSync(path.join(impRoot, '.powercodex', 'config.json')));
    check('import creates the consent gate + plan registry', fs.existsSync(approvalFile(impRoot)) && fs.existsSync(path.join(impRoot, '.powercodex', 'plans', 'index.json')));
    const impPkg = JSON.parse(fs.readFileSync(path.join(impRoot, 'package.json'), 'utf8'));
    check('import wires a "cockpit" script into package.json', impPkg.scripts.cockpit === 'powercodex');
    check('import configures the chosen providers', Array.isArray(imp.config.providers) && imp.config.providers.length >= 1);
    fs.rmSync(impRoot, { recursive: true, force: true });

    // ── brownfield ingestion · code-grounded intake · freeze ─────────────────
    const { buildDigest, writeDigest, readDigest } = require('./digest');
    const { buildStories, readStories, refineStories } = require('./stories');
    const { scoreStoriesGrounding, scoreMvpAgainstStories } = require('./compliance');
    const freeze = require('./freeze');

    // A throwaway pre-existing app to read.
    const bfRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-brownfield-'));
    fs.mkdirSync(path.join(bfRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(bfRoot, 'package.json'), JSON.stringify({ name: 'acme-portal', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }, null, 2));
    fs.writeFileSync(path.join(bfRoot, 'src', 'App.tsx'), 'import {Routes,Route} from "react-router";\nexport default function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/projects" element={<ProjectsList/>}/></Routes>}');
    fs.writeFileSync(path.join(bfRoot, 'src', 'ProjectsList.tsx'), 'import {useQuery} from "@tanstack/react-query";\nexport function ProjectsList(){const q=useQuery({queryKey:["p"],queryFn:()=>fetch("/api/p")});return <div/>}');

    const digest = buildDigest(bfRoot);
    writeDigest(bfRoot, digest);
    check('digest reads routes from the existing code', digest.routes.some((r) => r.path === '/projects'));
    check('digest reads components from the existing code', digest.components.some((c) => c.name === 'ProjectsList'));
    check('digest records each surface with its source file (provenance)', digest.routes.every((r) => /\.tsx?$/.test(r.source)));
    check('digest auto-detects stack mode', digest.mode === 'local-run');
    check('digest records coverage and is persisted', !!digest.coverage && fs.existsSync(path.join(bfRoot, '.powercodex', 'digest.json')));

    const built = buildStories(bfRoot, { goal: 'manage projects' });
    check('stories are generated from the digest', built.doc.stories.length >= 1);
    check('every story cites a source file', built.doc.stories.every((s) => Array.isArray(s.sources) && s.sources.length > 0));
    check('stories.json + stories.html are written', fs.existsSync(built.path) && fs.existsSync(built.htmlPath));
    check('stories are grounded in the code (compliance)', scoreStoriesGrounding(built.doc.stories, digest).score === 100);

    const groundedMvp = proposeMvp(bfRoot, { goal: 'manage projects', digest });
    check('MVP is grounded in the digest, not goal keywords', /from your code/.test(fs.readFileSync(groundedMvp, 'utf8')));
    check('MVP serves the reviewed stories (compliance)', scoreMvpAgainstStories(fs.readFileSync(groundedMvp, 'utf8'), built.doc.stories).score >= 50);

    // Goal-only fallback still works where there is no digest.
    const greenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-green-'));
    const greenMvp = proposeMvp(greenRoot, { goal: 'track invoices and payments' });
    check('MVP falls back to goal-only when no digest exists', fs.existsSync(greenMvp) && /from your goal/.test(fs.readFileSync(greenMvp, 'utf8')));
    check('no code-grounded stories are fabricated without a digest', buildStories(greenRoot, {}).doc.stories.length === 0 && readDigest(greenRoot) === null);
    fs.rmSync(greenRoot, { recursive: true, force: true });

    // Refine preserves the user's edits.
    const editedDoc = readStories(bfRoot);
    editedDoc.stories[0].title = 'EDITED · custom story title';
    const refined = await refineStories(bfRoot, { edited: editedDoc, provider: providers.resolve('simulated') });
    check('refine preserves the user edit (not regenerated)', refined.ok && readStories(bfRoot).stories[0].title === 'EDITED · custom story title');
    check('refine reports an explainable diff', refined.diff && refined.diff.changed.includes(editedDoc.stories[0].id));

    // Freeze: the loop reads but never rewrites; only unlock reopens.
    freeze.freeze(bfRoot, 'stories');
    freeze.freeze(bfRoot, 'mvp');
    check('freeze sets status to frozen', freeze.isFrozen(bfRoot, 'stories') && freeze.statusOf(bfRoot, 'mvp') === 'frozen');
    const blockedRefine = await refineStories(bfRoot, { edited: editedDoc });
    check('a frozen artifact rejects refine (not rewritten)', blockedRefine.ok === false);
    const mvpBefore = fs.readFileSync(groundedMvp, 'utf8');
    proposeMvp(bfRoot, { goal: 'a completely different app', digest });
    check('a frozen MVP is not regenerated by proposeMvp', fs.readFileSync(groundedMvp, 'utf8') === mvpBefore);
    const loopAfterFreeze = await runLoop(bfRoot, { fresh: true, simulate: true, rotations: 1, render: false });
    const frozenStill = readStories(bfRoot).stories[0].title === 'EDITED · custom story title';
    check('the loop runs against a frozen benchmark without rewriting it', loopAfterFreeze && frozenStill);
    freeze.unlock(bfRoot, 'stories');
    check('unlock reopens a frozen artifact to draft', freeze.statusOf(bfRoot, 'stories') === 'draft');
    fs.rmSync(bfRoot, { recursive: true, force: true });

    // import --analyze writes a digest without touching the user's source.
    const anRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-analyze-'));
    fs.mkdirSync(path.join(anRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(anRoot, 'package.json'), JSON.stringify({ name: 'an-app', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }, null, 2));
    const srcFile = path.join(anRoot, 'src', 'App.tsx');
    fs.writeFileSync(srcFile, 'export default function App(){return null}');
    const srcBefore = fs.readFileSync(srcFile, 'utf8');
    const analyzed = importInto(anRoot, { providers: 'both', analyze: true });
    check('import --analyze produces a digest', !!analyzed.digest && fs.existsSync(path.join(anRoot, '.powercodex', 'digest.json')));
    check('import --analyze does not modify the user source tree', fs.readFileSync(srcFile, 'utf8') === srcBefore);
    check('plain import (no --analyze) produces no digest', !importInto(fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-plain-')), {}).digest);
    fs.rmSync(anRoot, { recursive: true, force: true });

    // Real-engine resolution & the Playwright recommendation (deterministic — no browser).
    const { resolveEngines } = require('./engines');
    const { hasPlaywright, browserBased, recommendation } = require('./playwright-check');
    const writeDigestFn = require('./digest').writeDigest;
    const enginePath = path.join(__dirname, '..', 'engine', 'mdm-attach.mjs');
    check('vendored MDM engine is present', fs.existsSync(enginePath));
    check('vendored MDM engine exposes runAppSmokeTest', /export\s+async\s+function\s+runAppSmokeTest/.test(fs.readFileSync(enginePath, 'utf8')));

    const simEng = await resolveEngines(root, { simulate: true });
    check('resolveEngines(simulate) yields the simulated bundle', simEng.mode === 'simulate' && simEng.real === false && typeof simEng.e2eTester === 'function');

    // A browser-based project (web routes/components) → real requested without Playwright recommends it.
    const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-web-'));
    writeDigestFn(webRoot, { name: 'web-app', mode: 'local-run', routes: [{ path: '/', source: 'a' }], components: [{ name: 'App', source: 'a' }], data: [], scripts: [{ name: 'dev', cmd: 'vite', source: 'package.json' }], coverage: {} });
    check('browserBased() is true for a web app', browserBased(webRoot) === true);
    const webNotes = [];
    const webEng = await resolveEngines(webRoot, { simulate: false, emit: async (e) => webNotes.push(e.message) });
    if (!hasPlaywright(webRoot)) {
      // No package.json here (digest only), so it is not a code app either → falls back
      // to simulation, but still recommends Playwright for the live-app smoke test.
      check('real on a browser app without Playwright (and no code app) recommends it + falls back', /playwright/i.test(webNotes.join(' ')) && webEng.real === false);
    } else {
      check('real on a browser app with Playwright resolves the real bundle', webEng.real === true);
    }
    fs.rmSync(webRoot, { recursive: true, force: true });

    // A code app (package.json with react) builds for REAL without Playwright — the code
    // engine authors + compiles on-device, no browser needed. This is the autonomy spine.
    const codeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-code-'));
    fs.writeFileSync(path.join(codeRoot, 'package.json'), JSON.stringify({ name: 'c', dependencies: { react: '^19.0.0' }, scripts: { build: 'tsc --noEmit' } }));
    const codeEng = await resolveEngines(codeRoot, { simulate: false, emit: async () => {} });
    check('a code app resolves the real code engine without Playwright', codeEng.real === true && /code-gen/.test(codeEng.mode) && typeof codeEng.heal === 'function');
    fs.rmSync(codeRoot, { recursive: true, force: true });

    // A UI-less project (library/CLI, no package.json) → nothing real to drive → simulate.
    const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-lib-'));
    writeDigestFn(libRoot, { name: 'lib', mode: 'local-run', routes: [], components: [], data: [], scripts: [{ name: 'build', cmd: 'tsc', source: 'package.json' }], coverage: {} });
    check('browserBased() is false for a UI-less project', browserBased(libRoot) === false);
    const libNotes = [];
    const libEng = await resolveEngines(libRoot, { simulate: false, emit: async (e) => libNotes.push(e.message) });
    check('a non-browser, non-code project is not nagged to install Playwright', !/playwright/i.test(libNotes.join(' ')) && /no real target/.test(libEng.mode));
    check('recommendation() explains real engines are not advised for a non-browser app', recommendation(libRoot).needed === false && recommendation(libRoot).browserBased === false);
    fs.rmSync(libRoot, { recursive: true, force: true });

    // Derived state carries the engine recommendation for the dashboard banner.
    check('deriveState exposes an engine recommendation', !!deriveState(root).engine && typeof deriveState(root).engine.message === 'string');

    // Engine 1 entry — maker recipes map build tasks to real Power Platform surfaces.
    const { recipeFor } = require('./maker-recipes');
    const tableRecipe = recipeFor('dataverse.table.create');
    check('every default build task has a maker recipe', ['dataverse.table.create', 'dataverse.column.add'].every((t) => !!recipeFor(t)));
    check('a maker recipe builds an env-scoped Power Platform URL', /make\.powerapps\.com\/environments\/ENV123\/tables/.test(tableRecipe.url('ENV123')));
    check('a maker recipe falls back to the portal home without an env', /^https:\/\/make\.powerapps\.com$/.test(tableRecipe.url(null)));
    check('the Power Automate recipe targets make.powerautomate.com', /make\.powerautomate\.com/.test(recipeFor('powerautomate.flow.create').url('ENV123')));
    check('table.create now has real DOM automation (build fn)', tableRecipe.automated === true && typeof tableRecipe.build === 'function');
    check('column.add now has real DOM automation (build fn)', recipeFor('dataverse.column.add').automated === true && typeof recipeFor('dataverse.column.add').build === 'function');

    // Edge profile picker — discover from a Local State file, resolve a selection, persist it.
    const edgeProfiles = require('./edge-profiles');
    const { setProfile, profileVerified, load: loadRights2 } = require('./rights');
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-edge-'));
    const statePath = path.join(stateDir, 'Local State');
    fs.writeFileSync(statePath, JSON.stringify({ profile: { info_cache: {
      'Default': { name: 'Personal', user_name: 'me@gmail.com' },
      'Profile 1': { name: 'Work', user_name: 'you@tenant.com' },
    } } }));
    const discovered = edgeProfiles.discoverProfiles(statePath);
    check('edge-profiles discovers profiles from Local State', discovered.length === 2 && discovered[1].directory === 'Profile 1');
    check('profile selection resolves by 1-based index', edgeProfiles.resolveSelection(discovered, '2').directory === 'Profile 1');
    check('profile selection resolves by email substring', edgeProfiles.resolveSelection(discovered, 'tenant.com').directory === 'Profile 1');
    check('profile selection resolves by exact directory', edgeProfiles.resolveSelection(discovered, 'Default').directory === 'Default');
    check('an unmatched selection returns null', edgeProfiles.resolveSelection(discovered, 'nope') === null);
    const picked = edgeProfiles.resolveSelection(discovered, 'Work');
    const pRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-prof-'));
    setProfile(pRoot, { name: picked.directory, path: `./.profiles/${picked.directory}`, label: edgeProfiles.label(picked) });
    check('selecting a profile persists it to Approved_rights (always reused)', profileVerified(pRoot) && loadRights2(pRoot).browserProfile === 'Profile 1' && /tenant\.com/.test(loadRights2(pRoot).browserProfileLabel));
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(pRoot, { recursive: true, force: true });

    // Security: a malicious screen name must never escape src/pages/ when the build
    // executor authors code tasks (path-traversal → arbitrary file write).
    const cgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-codegen-'));
    try {
      fs.mkdirSync(path.join(cgRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(cgRoot, 'src', 'main.tsx'), '');
      const { buildCodeTasks } = require('./codegen');
      const evil = path.join(cgRoot, 'PWNED.tsx');
      await buildCodeTasks({
        root: cgRoot,
        tasks: [{ type: 'code.screen', name: '../../PWNED', componentName: 'X', route: '/x', goal: 'x' }],
      });
      // The traversal must never escape: no file written outside src/pages/.
      check('a traversing screen name cannot escape src/pages/', !fs.existsSync(evil) && !fs.existsSync(path.join(cgRoot, 'src', 'PWNED.tsx')));
      const safe = await buildCodeTasks({
        root: cgRoot,
        tasks: [{ type: 'code.screen', name: 'My Screen!!', componentName: 'MyScreen', route: '/my', goal: 'x' }],
      });
      check('a normal screen name still writes inside src/pages/', safe[0] && safe[0].created === true && fs.existsSync(path.join(cgRoot, 'src', 'pages', 'my-screen.tsx')));
    } finally {
      fs.rmSync(cgRoot, { recursive: true, force: true });
    }

    // ── agent harness (P1) · godmode + codeapps + craft/verify/change blend ────
    const harness = require('./harness');
    check('harness routes a build request to build mode', harness.route('build a screen to track tasks', 'plan').mode === 'build');
    check('harness routes a bug report to fix mode', harness.route('the save button is broken', 'act').mode === 'fix');
    check('harness routes Dataverse work to the dataverse specialist', harness.route('add a Dataverse table for invoices', 'plan').codeapps === 'dataverse-specialist');
    check('harness routes a connector task to the connector specialist', harness.route('add a SharePoint connector data source to the code app', 'plan').codeapps === 'connector-integrator');
    check('harness flags UI work for the craft router', harness.route('polish the landing page layout and typography', 'act').ui === true);
    check('harness flags a runnable surface for verification', harness.route('build a login form screen', 'plan').verify === true);
    check('harness leaves a plain question unrouted', harness.route('what is the capital of France', 'answer').mode === 'plain');
    const hOn = { allowHarness: true };
    check('harness composes a non-empty block on a substantive turn', harness.compose({ taskText: 'build a tasks screen', intent: 'plan', rights: hOn }).includes('POWERCODEX HARNESS'));
    check('harness skips greetings (chat intent)', harness.compose({ taskText: 'hi there', intent: 'chat', rights: hOn }) === '');
    check('harness injects nothing when the consent flag is off', harness.compose({ taskText: 'build a tasks screen', intent: 'plan', rights: { allowHarness: false } }) === '');
    check('harness fails open when rights are missing (default on)', harness.compose({ taskText: 'build a tasks screen', intent: 'plan', rights: null }).includes('POWERCODEX HARNESS'));
    check('harness always carries the ponytail core + guardrails', /leanest|laziest/i.test(harness.compose({ taskText: 'build x', intent: 'plan', rights: hOn })) && /CLAUDE\.md/.test(harness.compose({ taskText: 'build x', intent: 'plan', rights: hOn })));
    check('harness appends the codeapps essence for Power Platform tasks', /dataverse/i.test(harness.compose({ taskText: 'add a Dataverse table', intent: 'plan', rights: hOn })));
    check('harness omits the codeapps block for non-Power-Platform tasks', !/CODEAPPS\//.test(harness.compose({ taskText: 'answer a general question about history', intent: 'answer', rights: hOn })));
    check('harness never throws — always returns a string', typeof harness.compose({}) === 'string' && harness.compose({ taskText: null, intent: undefined }) !== undefined);
    check('harness status line names the mode + codeapps skill', /Harness · build/.test(harness.statusLine(harness.route('build a Dataverse app', 'plan'))));
    // Wiring: the prompt builders prepend the composed harness at the three agent-facing sites.
    const agentMod = require('./agent');
    check('agent-mode prompt includes the harness block', /POWERCODEX HARNESS/.test(agentMod.buildAgentPrompt({ message: 'build a tasks screen', rights: hOn })));
    check('agent-mode prompt omits the harness when disabled', !/POWERCODEX HARNESS/.test(agentMod.buildAgentPrompt({ message: 'build a tasks screen', rights: { allowHarness: false } })));
    const chatMod = require('./chat');
    check('chat prompt includes the harness on a plan turn', /POWERCODEX HARNESS/.test(chatMod.buildPrompt({ system: 'x', message: 'build a tasks screen', intent: 'plan', rights: hOn })));
    check('chat prompt has no harness on a greeting', !/POWERCODEX HARNESS/.test(chatMod.buildPrompt({ system: 'x', message: 'hello', intent: 'chat', rights: hOn })));
    check('harness flag defaults to on in the consent gate', require('./rights').DEFAULTS.allowHarness === true);

    // Live preview (on-device dev server) — guard rails without spawning a real server.
    const preview = require('./preview');
    check('preview reports needs-install when node_modules is absent', (() => {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
      const c = preview.canRun(root);
      return c.ok === false && c.needsInstall === true;
    })());
    check('preview refuses a project with no dev script', (() => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-nodev-'));
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: {} }));
      fs.mkdirSync(path.join(d, 'node_modules'));
      const ok = preview.canRun(d).ok === false;
      fs.rmSync(d, { recursive: true, force: true });
      return ok;
    })());
    check('preview status is not-running before start', preview.status(root).running === false);

    // Publish (Power Platform) — consent gate + URL capture, no live tenant needed.
    const publish = require('./publish');
    check('publish blocks without explicit consent', (await publish.publish(root, { confirm: false })).needsConsent === true);
    check('publish captures the live app URL from pac output', publish.extractAppUrl('done. Play at https://apps.powerapps.com/play/e/env/a/app now') === 'https://apps.powerapps.com/play/e/env/a/app');
    check('publish check never throws when pac is absent', typeof (await publish.check(root)).appName === 'string');

    // Real e2e engine — element planning, failure classification, and the heal loop,
    // exercised with a fake browser driver (no Playwright/browser needed here).
    const e2e = require('./e2e');
    const plan = e2e.planInteractions([
      { kind: 'input', type: 'email', selector: '#e' },
      { kind: 'select', selector: '#s', options: ['a', 'b'] },
      { kind: 'button', text: 'Go', selector: '#g' },
      { kind: 'link', text: 'Home', selector: '#h', href: '/' },
    ]);
    check('e2e plans fills before clicks and exercises every option', plan.map((s) => s.action).indexOf('fill') < plan.map((s) => s.action).indexOf('click') && plan.filter((s) => s.action === 'select').length === 2);
    check('e2e classifies real failures and filters benign noise', (() => {
      const f = e2e.classifyFailures({ consoleErrors: ['boom', 'favicon.ico 404'], pageErrors: ['TypeError'] });
      return f.length === 2 && f.some((x) => x.type === 'pageerror');
    })());
    const fakeDriver = (queue) => ({ async open() {}, async listInteractive() { return [{ kind: 'input', type: 'text', selector: '#a' }, { kind: 'button', text: 'Go', selector: '#b' }]; }, async fill() {}, async check() {}, async click() {}, async select() {}, async navigate() {}, async drainEvents() { return queue.shift() || {}; }, async close() {} });
    check('e2e run reports green when the app is clean', (await e2e.runE2E('http://x', fakeDriver([{}, {}, {}]))).passed === true);
    check('e2e run reports red on a real page error', (await e2e.runE2E('http://x', fakeDriver([{ pageErrors: ['Cannot read null'] }, {}, {}]))).passed === false);
    check('e2e heal loop reaches green after a fix', (() => {
      let fixed = false;
      return e2e.healLoop({ url: 'http://x', makeDriver: async () => fixed ? fakeDriver([{}, {}, {}]) : fakeDriver([{ pageErrors: ['bug'] }, {}, {}]), onFix: async () => { fixed = true; }, rebuild: async () => ({ passed: true }), maxRounds: 3 }).then((h) => h.passed === true && h.rounds === 2);
    })());
    check('e2e heal loop stops on no-progress', (await e2e.healLoop({ url: 'http://x', makeDriver: async () => fakeDriver([{ pageErrors: ['same'] }, {}, {}]), onFix: async () => {}, rebuild: async () => ({ passed: true }), maxRounds: 5 })).noProgress === true);

    // Preview mock data — generated from the declared schema, typed by column.
    const mockdata = require('./mockdata');
    const mockGen = mockdata.generate({ tables: [{ displayName: 'Job', pluralName: 'Jobs', columns: [{ displayName: 'Status', type: 'choice', choices: ['Open', 'Closed'] }, { displayName: 'Hours', type: 'number' }] }] }, { rows: 2 });
    check('mock data generates typed rows per table', mockGen.Jobs.length === 2 && mockGen.Jobs[0].Status === 'Open' && typeof mockGen.Jobs[0].Hours === 'number');
    check('mock data write is a no-op without the data convention', mockdata.writeMockModule(root).written === false);

    const passed = checks.filter(Boolean).length;
    const ok = checks.every(Boolean);
    console.log(`\n${ok ? 'PASS' : 'FAIL'} · ${passed}/${checks.length} checks · summary ${JSON.stringify(summary)}`);
    return ok;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { selftest };
