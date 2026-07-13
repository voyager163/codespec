# Desktop Terminal-Action Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the PowerCodex chat/desktop UI trigger `pac code push`, `pac code add-data-source`, and a full new-project scaffold via a button click or a typed chat request — no terminal required.

**Architecture:** Each action is a small library function (`buildAndPush`, `addDataSource`, `scaffoldNewProject`) called from two thin entry points that already exist in this codebase — `Controller.action()` (button clicks, `/api/action`) and `agent.js`'s `run()` (chat intent, `/api/agent`) — so button and chat share one implementation per action, matching how the existing `propose-mvp` / `artifact` actions are already wired.

**Tech Stack:** Node.js (`node:child_process` spawn, zero new dependencies), the existing zero-dependency lifecycle HTTP server, vanilla JS in `chat.html`.

## Global Constraints

- Every file under `tools/lifecycle/` has a byte-identical mirror at `templates/starter/tools/lifecycle/` (verified: `diff tools/lifecycle/lib/control.js templates/starter/tools/lifecycle/lib/control.js` → identical, no sync script exists). **Every edit to a `tools/lifecycle/lib/*.js` or `tools/lifecycle/assets/chat.html` file in this plan must be applied identically to both locations**, or `npm run lifecycle:selftest`'s existing lockstep check (`selftest.js:632-644`) and future drift will silently diverge the generated-app copy from the engine copy.
- `Push` and `Add datasource` change a live Power Platform environment. Both must be refused unless `Approved_rights/approval.json`'s `allowPush` flag is `true` (`tools/lifecycle/lib/rights.js` — `DEFAULTS.allowPush = false`). `Create new project` (scaffold) touches no live environment and has no gate.
- The existing action name `'create-project'` is already taken (`server.js:115` `createProject()` — scaffolds a *lightweight* starter into the *already-open, empty* workspace, no OpenSpec/OPSX/git). The new "full scaffold, brand-new named folder" feature this plan builds uses the distinct name `'scaffold-project'` throughout, so it does not collide with or change existing behavior.
- No new npm dependencies. Follow the existing `spawn` + line-parsing pattern already used in `pac-init.js` and `scaffold.js`.
- Test convention for `tools/lifecycle/lib`: there is no `node --test` suite for this directory — correctness is asserted via `tools/lifecycle/lib/selftest.js`'s `check(name, ok)` calls, run with `npm run lifecycle:selftest`. Add new checks there; do not invent a different test framework for this code.

---

### Task 1: `pac-init.js` — `buildAndPush()` (build then push)

**Files:**
- Modify: `tools/lifecycle/lib/pac-init.js`
- Modify (mirror): `templates/starter/tools/lifecycle/lib/pac-init.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Produces: `buildAndPush(root, { appDir, emit }) => Promise<{ pushed: boolean, built: boolean, output: string, error?: string }>` — exported from `pac-init.js` alongside the existing exports. Also exports `runPac(args, opts)` (an alias for the module's internal `pac()` helper), so `datasource.js` (Task 2) can spawn `pac` without duplicating the binary-resolution logic.

- [ ] **Step 1: Add the failing selftest check**

In `tools/lifecycle/lib/selftest.js`, immediately after the existing `pacInit` block (after line 444's `fs.rmSync(pacRoot, { recursive: true, force: true });`), add:

```js
    // ── buildAndPush: runs npm run build first when a build script exists, then push ──
    const buildPushRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-buildpush-'));
    fs.writeFileSync(path.join(buildPushRoot, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'node -e "require(\'fs\').writeFileSync(\'built.txt\',\'ok\')"' } }));
    const bpLog = [];
    const bpPacFake = { pushed: true, output: 'push ok' };
    const bpResult = await pacInit.buildAndPush(buildPushRoot, {
      emit: async ({ level, message }) => bpLog.push(`[${level}] ${message}`),
      _push: async () => bpPacFake,
    });
    check('buildAndPush runs the build script when present', fs.existsSync(path.join(buildPushRoot, 'built.txt')));
    check('buildAndPush reports built:true after a successful build', bpResult.built === true);
    check('buildAndPush calls through to push and returns its result', bpResult.pushed === true);
    const noBuildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-buildpush-nobuild-'));
    fs.writeFileSync(path.join(noBuildRoot, 'package.json'), JSON.stringify({ name: 'x' }));
    const bpNoBuild = await pacInit.buildAndPush(noBuildRoot, { emit: async () => {}, _push: async () => bpPacFake });
    check('buildAndPush skips the build step when no build script exists', bpNoBuild.built === false && bpNoBuild.pushed === true);
    fs.rmSync(buildPushRoot, { recursive: true, force: true });
    fs.rmSync(noBuildRoot, { recursive: true, force: true });
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — `TypeError: pacInit.buildAndPush is not a function`

- [ ] **Step 3: Implement `buildAndPush` in `pac-init.js`**

In `tools/lifecycle/lib/pac-init.js`, add after `pushCodeApp` (before the `registerCodeApp` block) — note the `_push` injection point mirrors the existing `_pac` injection pattern used by `registerCodeApp` for deterministic testing:

```js
// Run `npm run build` first (only if package.json declares a build script), then
// pac code push. Mirrors the maker's own "npm run build && pac code push" habit as
// one action. Never throws — callers check the returned booleans/error.
function hasBuildScript(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return !!(pkg.scripts && pkg.scripts.build);
  } catch {
    return false;
  }
}

function runNpmBuild(root, { emit = async () => {} } = {}) {
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['run', 'build'], { cwd: root, shell: process.platform === 'win32' });
    let out = '';
    const relay = async (b) => { out += String(b); await emit({ level: 'info', message: String(b).trim() }).catch(() => {}); };
    if (child.stdout) child.stdout.on('data', relay);
    if (child.stderr) child.stderr.on('data', relay);
    child.on('error', (e) => resolve({ ok: false, output: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, output: out }));
  });
}

async function buildAndPush(root, { appDir, emit = async () => {}, _push } = {}) {
  const push = _push || pushCodeApp;
  let built = false;
  if (hasBuildScript(root)) {
    await emit({ level: 'info', message: 'npm run build' });
    const b = await runNpmBuild(root, { emit });
    if (!b.ok) {
      await emit({ level: 'bad', message: `npm run build failed:\n${b.output}` });
      return { pushed: false, built: false, output: b.output, error: 'build failed' };
    }
    built = true;
    await emit({ level: 'good', message: 'npm run build succeeded' });
  } else {
    await emit({ level: 'info', message: 'no "build" script in package.json — skipping build, pushing as-is' });
  }
  const result = await push(root, { appDir, emit });
  return Object.assign({ built }, result);
}
```

- [ ] **Step 4: Export the new functions**

In `tools/lifecycle/lib/pac-init.js`, change the final `module.exports` line to:

```js
module.exports = { checkPac, preflight, listAuthProfiles, ensureAuth, initCodeApp, pushCodeApp, registerCodeApp, buildAndPush, runPac: pac };
```

- [ ] **Step 5: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on the 4 new checks (look for `✓ buildAndPush runs the build script when present`, etc.)

- [ ] **Step 6: Mirror the two edited files into `templates/starter/`**

```bash
cp tools/lifecycle/lib/pac-init.js templates/starter/tools/lifecycle/lib/pac-init.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/pac-init.js templates/starter/tools/lifecycle/lib/pac-init.js
diff tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
```
Expected: both `diff` calls print nothing (identical).

- [ ] **Step 7: Commit**

```bash
git add tools/lifecycle/lib/pac-init.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/pac-init.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): add buildAndPush — npm run build then pac code push"
```

---

### Task 2: `datasource.js` (new) — `addDataSource()`

**Files:**
- Create: `tools/lifecycle/lib/datasource.js`
- Create (mirror): `templates/starter/tools/lifecycle/lib/datasource.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Consumes: `runPac(args, opts)` and `checkPac()` from `pac-init.js` (Task 1).
- Produces: `addDataSource(root, { api, table, appDir, emit }) => Promise<{ added: boolean, output: string, error?: string }>`.

- [ ] **Step 1: Add the failing selftest check**

In `tools/lifecycle/lib/selftest.js`, right after Task 1's new block, add:

```js
    // ── datasource.js: pac code add-data-source wrapper ────────────────────────
    const datasourceMod = require('./datasource');
    const dsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-datasource-'));
    const dsFakeRuns = [];
    const dsFakePac = {
      checkPac: async () => '1.46',
      runPac: async (args) => { dsFakeRuns.push(args); return { code: 0, stdout: 'added', stderr: '' }; },
    };
    const dsOk = await datasourceMod.addDataSource(dsRoot, { api: 'dataverse', table: 'cr_invoice', emit: async () => {}, _pac: dsFakePac });
    check('addDataSource succeeds and reports added:true', dsOk.added === true);
    check('addDataSource builds -a and -t flags for a Dataverse table', dsFakeRuns[0].join(' ') === ['code', 'add-data-source', '-a', 'dataverse', '-t', 'cr_invoice'].join(' '));
    const dsNoTable = await datasourceMod.addDataSource(dsRoot, { api: 'shared_sharepointonline', emit: async () => {}, _pac: dsFakePac });
    check('addDataSource omits -t for a non-Dataverse connector with no table', !dsFakeRuns[1].includes('-t'));
    const dsMissingApi = await datasourceMod.addDataSource(dsRoot, { emit: async () => {}, _pac: dsFakePac });
    check('addDataSource refuses when no api/connector id is given', dsMissingApi.added === false && /api|connector/i.test(dsMissingApi.error || ''));
    fs.rmSync(dsRoot, { recursive: true, force: true });
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — `Cannot find module './datasource'`

- [ ] **Step 3: Implement `datasource.js`**

Create `tools/lifecycle/lib/datasource.js`:

```js
'use strict';
// datasource.js — wraps `pac code add-data-source`, wiring a Dataverse table or
// another already-connected connector into the Code App's power.config.json.
// Table logical names must already exist (created via `dataverse-schema.js`'s
// applySchema); this module only performs the pac CLI wiring step.
const pacInit = require('./pac-init');

// Add a data source to the Code App at `root`/`appDir`.
//   api   — the pac connector id, e.g. "dataverse" or a shared_* connector id
//   table — required for Dataverse (a table logical name); omitted for other connectors
// `_pac` injects { checkPac, runPac } for deterministic tests (defaults to pac-init.js).
async function addDataSource(root, { api, table, appDir, emit = async () => {}, _pac } = {}) {
  const p = _pac || { checkPac: pacInit.checkPac, runPac: pacInit.runPac };
  if (!api) {
    return { added: false, output: '', error: 'No api/connector id given — which data source? (e.g. "dataverse")' };
  }
  try {
    await p.checkPac();
  } catch (e) {
    return { added: false, output: '', error: e.message };
  }
  const args = ['code', 'add-data-source', '-a', api];
  if (table) args.push('-t', table);
  const dir = appDir || root;
  await emit({ level: 'info', message: `pac ${args.join(' ')} in ${dir}` });
  const r = await p.runPac(args, { cwd: dir });
  if (r.code !== 0) {
    await emit({ level: 'bad', message: `pac code add-data-source failed:\n${r.stderr || r.stdout}` });
    return { added: false, output: r.stdout + '\n' + r.stderr, error: r.stderr || r.stdout };
  }
  await emit({ level: 'good', message: `Data source "${api}"${table ? ' (' + table + ')' : ''} added` });
  return { added: true, output: r.stdout };
}

module.exports = { addDataSource };
```

- [ ] **Step 4: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on all 4 new checks.

- [ ] **Step 5: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/lib/datasource.js templates/starter/tools/lifecycle/lib/datasource.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/datasource.js templates/starter/tools/lifecycle/lib/datasource.js
```
Expected: no output (identical).

- [ ] **Step 6: Commit**

```bash
git add tools/lifecycle/lib/datasource.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/datasource.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): add datasource.js — pac code add-data-source wrapper"
```

---

### Task 3: `scaffold-cli.js` (new) — `scaffoldNewProject()`

**Files:**
- Create: `tools/lifecycle/lib/scaffold-cli.js`
- Create (mirror): `templates/starter/tools/lifecycle/lib/scaffold-cli.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Produces: `binPath()`, `scaffoldNewProject(targetDir, { name, emit }) => Promise<{ scaffolded: boolean, projectDir?: string, output: string, error?: string }>`.

**Context:** `bin/create-powercodex.js` (the full CLI — starter + OpenSpec + all OPSX prompts/skills + git init) only exists at the repo root, not inside a generated project. This module resolves it the same two-candidate way `scaffold.js`'s `starterDir()` already resolves `templates/starter` — repo checkout vs. the desktop app's vendored copy — and returns `null` when neither exists (e.g. inside an already-generated app, where "scaffold another brand-new PowerCodex project" isn't available), exactly the graceful-degrade convention `starterDir()` already established.

- [ ] **Step 1: Add the failing selftest check**

In `tools/lifecycle/lib/selftest.js`, right after Task 2's new block, add:

```js
    // ── scaffold-cli.js: spawns bin/create-powercodex.js, parses [run]/[ok]/[fail] lines ──
    const scaffoldCli = require('./scaffold-cli');
    const scParent = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-scaffold-cli-'));
    const scLog = [];
    // Inject a fake CLI script so this never spawns npm install / git init for real.
    const fakeCliPath = path.join(scParent, 'fake-create.js');
    fs.writeFileSync(fakeCliPath, `
      console.log('[run] Copy starter template');
      console.log('[ok] Copy starter template');
      console.log('[run] Initialize git repository');
      console.log('[ok] Initialize git repository');
    `);
    const scOk = await scaffoldCli.scaffoldNewProject(scParent, {
      name: 'demo-app',
      emit: async ({ level, message }) => scLog.push(`[${level}] ${message}`),
      _binPath: fakeCliPath,
    });
    check('scaffoldNewProject reports scaffolded:true on a clean exit', scOk.scaffolded === true);
    check('scaffoldNewProject resolves projectDir to targetDir/name', scOk.projectDir === path.join(scParent, 'demo-app'));
    check('scaffoldNewProject relays [ok] lines as good-level progress', scLog.some((l) => l.startsWith('[good]') && l.includes('Copy starter template')));
    const scMissing = await scaffoldCli.scaffoldNewProject(scParent, { name: 'x', emit: async () => {}, _binPath: null });
    check('scaffoldNewProject degrades honestly when the CLI is not available', scMissing.scaffolded === false && /not available/i.test(scMissing.error || ''));
    fs.rmSync(scParent, { recursive: true, force: true });
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — `Cannot find module './scaffold-cli'`

- [ ] **Step 3: Implement `scaffold-cli.js`**

Create `tools/lifecycle/lib/scaffold-cli.js`:

```js
'use strict';
// scaffold-cli.js — spawns bin/create-powercodex.js (the full PowerCodex scaffold:
// starter template + OpenSpec + all 11 OPSX prompts/skills + git init) to create a
// brand-new named project, streaming its [run]/[ok]/[skip]/[fail] step lines as
// progress. Resolves the CLI across two layouts, same pattern as scaffold.js's
// starterDir(): the repo checkout (tools/lifecycle/lib → <repo>/bin) and the
// vendored desktop app (desktop/vendor/lifecycle/lib → desktop/vendor/bin). Returns
// null when neither exists (e.g. inside an already-generated app) so callers can
// degrade honestly instead of crashing.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function binPath() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'bin', 'create-powercodex.js'),
    path.resolve(__dirname, '..', '..', 'bin', 'create-powercodex.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const STEP_LINE = /^\[(run|ok|skip|fail)\]\s+(.+)$/;
const LEVEL = { run: 'info', ok: 'good', skip: 'info', fail: 'bad' };

// Create a brand-new PowerCodex project named `name` inside `targetDir`.
// `_binPath` injects the CLI script path for deterministic tests (defaults to binPath()).
function scaffoldNewProject(targetDir, { name, emit = async () => {}, _binPath } = {}) {
  return new Promise((resolve) => {
    const cli = _binPath !== undefined ? _binPath : binPath();
    if (!cli) {
      resolve({ scaffolded: false, output: '', error: 'Full project scaffolding is not available here — the PowerCodex CLI isn’t bundled with this build.' });
      return;
    }
    if (!name) {
      resolve({ scaffolded: false, output: '', error: 'A project name is required.' });
      return;
    }
    const child = spawn(process.execPath, [cli, name], { cwd: targetDir });
    let out = '';
    let err = '';
    const onLine = (line) => {
      const m = line.match(STEP_LINE);
      if (m) emit({ level: LEVEL[m[1]] || 'info', message: m[2] }).catch(() => {});
    };
    const relay = (buf, isErr) => {
      const s = String(buf);
      (isErr ? (err += s) : (out += s));
      s.split('\n').forEach((l) => l.trim() && onLine(l.trim()));
    };
    if (child.stdout) child.stdout.on('data', (b) => relay(b, false));
    if (child.stderr) child.stderr.on('data', (b) => relay(b, true));
    child.on('error', (e) => resolve({ scaffolded: false, output: out, error: e.message }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ scaffolded: false, output: out, error: err.trim() || `create-powercodex exited with code ${code}` });
        return;
      }
      resolve({ scaffolded: true, projectDir: path.join(targetDir, name), output: out });
    });
  });
}

module.exports = { binPath, scaffoldNewProject };
```

- [ ] **Step 4: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on all 4 new checks.

- [ ] **Step 5: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/lib/scaffold-cli.js templates/starter/tools/lifecycle/lib/scaffold-cli.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/scaffold-cli.js templates/starter/tools/lifecycle/lib/scaffold-cli.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tools/lifecycle/lib/scaffold-cli.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/scaffold-cli.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): add scaffold-cli.js — spawn create-powercodex.js for a full new-project scaffold"
```

---

### Task 4: `chat.js` — teach `classifyIntent()` push / add-datasource / scaffold-project

**Files:**
- Modify: `tools/lifecycle/lib/chat.js`
- Modify (mirror): `templates/starter/tools/lifecycle/lib/chat.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Produces: `classifyIntent(message, history)` now also returns `'push'`, `'add-datasource'`, or `'scaffold-project'` (in addition to the existing `'chat' | 'act' | 'answer' | 'artifact' | 'plan'`).

**Context:** Today, `deploy`, `publish`, and `push (it|this|to)` are folded into the generic `'act'` regex (`chat.js:71`), which hands the request to a free-form AI provider — there is no guarantee it actually runs `pac code push`. A bare `"push my changes"` doesn't even match that phrase and currently falls through to the default `'plan'` intent (would incorrectly start the build loop). This task carves out three precise, deterministic intents, checked before the existing `'act'` regex, and removes the now-redundant tokens from it.

- [ ] **Step 1: Add the failing selftest checks**

In `tools/lifecycle/lib/selftest.js`, right after Task 3's new block, add:

```js
    // ── classifyIntent: push / add-datasource / scaffold-project ───────────────
    const { classifyIntent } = require('./chat');
    check('classifyIntent recognizes "push my changes"', classifyIntent('push my changes') === 'push');
    check('classifyIntent recognizes "deploy this"', classifyIntent('deploy this') === 'push');
    check('classifyIntent recognizes "publish to my environment"', classifyIntent('publish to my environment') === 'push');
    check('classifyIntent recognizes "add a datasource for the Orders table"', classifyIntent('add a datasource for the Orders table') === 'add-datasource');
    check('classifyIntent recognizes "wire up a data source"', classifyIntent('wire up a data source') === 'add-datasource');
    check('classifyIntent recognizes "start a new project called Inspections"', classifyIntent('start a new project called Inspections') === 'scaffold-project');
    check('classifyIntent recognizes "create a new powercodex project"', classifyIntent('create a new powercodex project') === 'scaffold-project');
    check('classifyIntent leaves an unrelated build ask as plan', classifyIntent('build a screen to track tasks') === 'plan');
    check('classifyIntent leaves "fix it" as act', classifyIntent('fix it') === 'act');
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — the new `push` / `add-datasource` / `scaffold-project` checks report the old values (`'act'` or `'plan'`).

- [ ] **Step 3: Implement in `chat.js`**

In `tools/lifecycle/lib/chat.js`, in `classifyIntent()`, insert three new checks immediately after the "Short greetings" block (before the existing "Imperative action" `'act'` check at line 71), and trim the now-redundant tokens from that `'act'` regex:

```js
  // Deterministic actions with a real, specific engine behind them — checked before
  // the generic 'act' catch-all so they run the actual pac command, not a free-form
  // AI guess. Order matters: scaffold-project before add-datasource ("create a new
  // project" must not be read as "add a data source").
  if (/\b(start|create|make|set up|scaffold)\b.*\b(new )?(powercodex )?project\b/.test(g) || /\bnew powercodex project\b/.test(g)) {
    return 'scaffold-project';
  }
  if (/\b(add|wire up|connect|hook up)\b.*\b(data ?source|dataverse table|connector)\b/.test(g)) {
    return 'add-datasource';
  }
  if (/\b(push|deploy|publish)\b/.test(g) && !/\bpush notification/.test(g)) {
    return 'push';
  }

  // Imperative action on work that already exists.
  if (/\b(do it|just do it|go ahead|proceed|fix it|fix this|repair|ship it|make it live|run it|run the app|start it)\b/.test(g)) {
    return 'act';
  }
```

(This replaces the old `'act'` regex's alternation, which previously included `deploy|publish|push (it|this|to)` — those tokens are removed since the new `push` intent above already covers them, more precisely.)

- [ ] **Step 4: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on all 9 new checks, and all pre-existing `classifyIntent`/harness checks still pass (no regressions in `'plan'`/`'act'`/`'artifact'`/`'answer'` classification).

- [ ] **Step 5: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/lib/chat.js templates/starter/tools/lifecycle/lib/chat.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/chat.js templates/starter/tools/lifecycle/lib/chat.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tools/lifecycle/lib/chat.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/chat.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): classify push / add-datasource / scaffold-project chat intents"
```

---

### Task 5: `control.js` — `case 'push'` and `case 'add-datasource'`

**Files:**
- Modify: `tools/lifecycle/lib/control.js`
- Modify (mirror): `templates/starter/tools/lifecycle/lib/control.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Consumes: `pacInit.buildAndPush` (Task 1), `datasource.addDataSource` (Task 2), the already-imported `loadRights` from `./rights`.
- Produces: `Controller.action({ type: 'push', appDir? })` and `Controller.action({ type: 'add-datasource', api, table?, appDir? })`, both returning `{ ok: boolean, ... }`.

- [ ] **Step 1: Add the failing selftest checks**

In `tools/lifecycle/lib/selftest.js`, inside the existing "Live dashboard server" block (right after the `reflectAct` line at `selftest.js:95`, before `const after = await req(port, 'GET', '/api/state');`), add:

```js
          const pushBlocked = await req(port, 'POST', '/api/action', { type: 'push' });
          await req(port, 'POST', '/api/action', { type: 'rights', flag: 'allowPush', value: true });
          const dsBlockedThenAllowed = await req(port, 'POST', '/api/action', { type: 'add-datasource', api: 'dataverse', table: 'cr_demo' });
```

And extend the `resolve({...})` object a few lines below (after `rightApplied: ...`) with:

```js
              pushGatedWhenOff: pushBlocked.json.ok === false && /allowPush|Publish/i.test(pushBlocked.json.error || ''),
              addDatasourceReachable: 'ok' in dsBlockedThenAllowed.json,
```

Then, further down in the same function where `serverChecks` is consumed with individual `check(...)` calls (search for `check('server status endpoint returns 200'` or similar nearby existing lines), add two more:

```js
    check('push is refused while allowPush is off', serverChecks.pushGatedWhenOff);
    check('add-datasource action is reachable via /api/action', serverChecks.addDatasourceReachable);
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — `unknown action: push` / `unknown action: add-datasource`.

- [ ] **Step 3: Implement in `control.js`**

In `tools/lifecycle/lib/control.js`, add two `require`s at the top:

```js
const pacInit = require('./pac-init');
const { addDataSource } = require('./datasource');
```

Then add two new `case`s inside `Controller.action()`'s `switch`, right before the `case 'reflect':` block (`control.js:133`):

```js
      case 'push': {
        const rights = loadRights(this.root);
        if (!rights || rights.allowPush !== true) {
          return { ok: false, error: 'Push is off — turn on "Publish to my environment" in the rights panel first' };
        }
        const boundEmit = async ({ level, message }) => { emit(this.root, { rotation: 0, stage: 4, agent: 'runner', level, message }); render(this.root); };
        const result = await pacInit.buildAndPush(this.root, { appDir: body.appDir, emit: boundEmit });
        return Object.assign({ ok: result.pushed }, result);
      }
      case 'add-datasource': {
        const rights = loadRights(this.root);
        if (!rights || rights.allowPush !== true) {
          return { ok: false, error: 'Add datasource is off — turn on "Publish to my environment" in the rights panel first' };
        }
        const boundEmit = async ({ level, message }) => { emit(this.root, { rotation: 0, stage: 4, agent: 'runner', level, message }); render(this.root); };
        const result = await addDataSource(this.root, { api: body.api, table: body.table, appDir: body.appDir, emit: boundEmit });
        return Object.assign({ ok: result.added }, result);
      }
```

- [ ] **Step 4: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on both new checks (`push is refused while allowPush is off`, `add-datasource action is reachable via /api/action`).

- [ ] **Step 5: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/lib/control.js templates/starter/tools/lifecycle/lib/control.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/control.js templates/starter/tools/lifecycle/lib/control.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tools/lifecycle/lib/control.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/control.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): wire push and add-datasource into Controller.action()"
```

---

### Task 6: `agent.js` — chat-driven push / add-datasource / scaffold-project

**Files:**
- Modify: `tools/lifecycle/lib/agent.js`
- Modify (mirror): `templates/starter/tools/lifecycle/lib/agent.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Consumes: `pacInit.buildAndPush` (Task 1), `datasource.addDataSource` (Task 2), `classifyIntent` (Task 4, already imported).
- Produces: `run()` now returns `{ kind: 'push' | 'add-datasource', ok, reply, ... }` (work done inline, same as the existing `'artifact'` branch) or `{ kind: 'scaffold-project', name }` (deferred to the server, same as the existing `'plan'` branch, because re-pointing the active workspace after scaffolding requires the closure-scoped state that only `server.js` holds).

**Context:** `push` and `add-datasource` need no state beyond `root`, so — like the existing `'artifact'` branch — `agent.js` performs the real work itself. `scaffold-project` creates a *new* folder and must switch the live workspace to it afterward (`openProject()`), which only exists inside `server.js`'s `serve()` closure — so, like the existing `'plan'` branch, `agent.js` only classifies + extracts a name here; Task 7 does the real work server-side.

- [ ] **Step 1: Add the failing selftest checks**

In `tools/lifecycle/lib/selftest.js`, right after Task 4's `classifyIntent` block, add:

```js
    // ── agent.run(): push / add-datasource execute inline; scaffold-project defers ──
    const agentRunRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-agent-run-'));
    fs.writeFileSync(path.join(agentRunRoot, 'package.json'), JSON.stringify({ name: 'x' }));
    require('./rights').ensureRights(agentRunRoot, { allowPush: true });
    const agentPushEvents = [];
    const agentPushResult = await agentMod.run(agentRunRoot, {
      message: 'push my changes',
      emit: (e) => agentPushEvents.push(e),
      _pushFn: async () => ({ pushed: true, built: false, output: 'ok' }),
    });
    check('agent push intent executes inline and reports kind:push', agentPushResult.kind === 'push' && agentPushResult.ok === true);
    check('agent push intent streams progress onto the bus', agentPushEvents.length > 0);
    const agentDsResult = await agentMod.run(agentRunRoot, {
      message: 'add a datasource for the Orders table',
      emit: () => {},
      _addDataSourceFn: async () => ({ added: true, output: 'ok' }),
    });
    check('agent add-datasource intent executes inline and reports kind:add-datasource', agentDsResult.kind === 'add-datasource' && agentDsResult.ok === true);
    const agentScaffoldResult = await agentMod.run(agentRunRoot, { message: 'start a new project called Inspections', emit: () => {} });
    check('agent scaffold-project intent defers to the server with the extracted name', agentScaffoldResult.kind === 'scaffold-project' && agentScaffoldResult.name === 'Inspections');
    const agentScaffoldNoName = await agentMod.run(agentRunRoot, { message: 'start a new project', emit: () => {} });
    check('agent scaffold-project asks for a name when none is given', agentScaffoldNoName.kind === 'answer' && /name/i.test(agentScaffoldNoName.reply || ''));
    fs.rmSync(agentRunRoot, { recursive: true, force: true });
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — `kind` comes back `'act'` (or similar) for all three new messages, since `agent.js` doesn't yet branch on these intents.

- [ ] **Step 3: Implement in `agent.js`**

Add two `require`s near the top of `tools/lifecycle/lib/agent.js`:

```js
const pacInit = require('./pac-init');
const { addDataSource } = require('./datasource');
```

Then, in `run()`, insert three new branches immediately after the existing `if (intent === 'artifact') { ... }` block (before the `// 3) act / answer` comment). Note the `opts` object referenced below is the same destructured argument `run(root, { message, history, provider, emit, memory: mem } = {})` already receives — extend that destructure to also pull `_pushFn` and `_addDataSourceFn`:

```js
async function run(root, { message, history, provider, emit, memory: mem, _pushFn, _addDataSourceFn } = {}) {
```

```js
  // 2b) A push request → run it now (same pushGate + buildAndPush as the button).
  if (intent === 'push') {
    let rights = null;
    try { rights = rightsGate.load(root); } catch { /* fail closed below */ }
    if (!rights || rights.allowPush !== true) {
      return { kind: 'push', intent, ok: false, reply: 'Push is off — turn on "Publish to my environment" in the rights panel first.', provider: adapter.id, simulated };
    }
    const push = _pushFn || pacInit.buildAndPush;
    const result = await push(root, { emit: (e) => say(e.level, `Push · ${e.message}`) });
    say(result.pushed ? 'good' : 'bad', result.pushed ? 'Agent · push succeeded' : `Agent · push failed: ${result.error || ''}`);
    return { kind: 'push', intent, ok: !!result.pushed, reply: result.pushed ? 'Pushed to your environment.' : `Push failed: ${result.error || 'see activity log'}`, provider: adapter.id, simulated };
  }

  // 2c) An add-datasource request → run it now.
  if (intent === 'add-datasource') {
    let rights = null;
    try { rights = rightsGate.load(root); } catch { /* fail closed below */ }
    if (!rights || rights.allowPush !== true) {
      return { kind: 'add-datasource', intent, ok: false, reply: 'Adding a data source is off — turn on "Publish to my environment" in the rights panel first.', provider: adapter.id, simulated };
    }
    const tableMatch = message.match(/\bfor (?:the )?["“]?([a-z0-9 _-]+?)["”]?\s*(?:table|entity)?\s*$/i);
    const table = tableMatch ? tableMatch[1].trim() : undefined;
    const addFn = _addDataSourceFn || addDataSource;
    const result = await addFn(root, { api: 'dataverse', table, emit: (e) => say(e.level, `Datasource · ${e.message}`) });
    say(result.added ? 'good' : 'bad', result.added ? 'Agent · data source added' : `Agent · data source failed: ${result.error || ''}`);
    return { kind: 'add-datasource', intent, ok: !!result.added, reply: result.added ? `Added the ${table || 'requested'} data source.` : `Couldn't add that data source: ${result.error || 'see activity log'}`, provider: adapter.id, simulated };
  }

  // 2d) A scaffold-project request → classify + extract a name; the server does the
  //     real work (Task 7) because it must re-point the active workspace afterward.
  if (intent === 'scaffold-project') {
    const nameMatch = message.match(/\b(?:called|named)\s+["“]?([a-z0-9][a-z0-9 _-]{1,60}?)["”]?\s*$/i);
    const name = nameMatch ? nameMatch[1].trim() : null;
    if (!name) {
      return { kind: 'answer', intent, reply: 'What should the new project be called?', provider: adapter.id, simulated };
    }
    say('info', `Agent · recognised a new-project request — "${name}"`);
    return { kind: 'scaffold-project', intent, name, provider: adapter.id, simulated };
  }
```

- [ ] **Step 4: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on all 6 new checks.

- [ ] **Step 5: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/lib/agent.js templates/starter/tools/lifecycle/lib/agent.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/agent.js templates/starter/tools/lifecycle/lib/agent.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tools/lifecycle/lib/agent.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/agent.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): chat-driven push / add-datasource / scaffold-project intents"
```

---

### Task 7: `server.js` — `scaffoldProject()` + routing + `/api/agent` post-processing + `/api/dataverse-state`

**Files:**
- Modify: `tools/lifecycle/lib/server.js`
- Modify (mirror): `templates/starter/tools/lifecycle/lib/server.js`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror)

**Interfaces:**
- Consumes: `scaffoldCli.scaffoldNewProject` (Task 3), `openProject` (existing closure function), `agent.run`'s `{ kind: 'scaffold-project', name }` result (Task 6), `dataverse-schema.js`'s `readState` (existing).
- Produces: `/api/action` handles `type: 'scaffold-project'`; `/api/agent` performs the real scaffold when `agent.run()` returns `kind: 'scaffold-project'`, mirroring the existing `kind === 'build'` post-processing block; a new `GET /api/dataverse-state` route for the Add-datasource picker (Task 8).

- [ ] **Step 1: Add the failing selftest checks**

In `tools/lifecycle/lib/selftest.js`, add a new block right after the existing "Live dashboard server" block closes (after the `check('...')` calls that consume `serverChecks`, i.e. after Task 5's two new `check()` lines):

```js
    // ── scaffold-project: /api/action creates a new project + re-points the workspace ──
    const scaffoldParent = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-scaffold-parent-'));
    const scaffoldSrv = serve(root, { port: 0 });
    const scaffoldServerChecks = await new Promise((resolve) => {
      scaffoldSrv.on('listening', async () => {
        const port = scaffoldSrv.address().port;
        try {
          const result = await req(port, 'POST', '/api/action', { type: 'scaffold-project', targetDir: scaffoldParent, name: 'demo-app' });
          scaffoldSrv.close(() => resolve({ result }));
        } catch (e) {
          scaffoldSrv.close(() => resolve({ error: e.message }));
        }
      });
    });
    // The real bin/create-powercodex.js isn't spawned against a throwaway dir in this
    // fast selftest (it needs npm/git and takes real seconds); assert the route exists
    // and degrades honestly (never crashes, never fabricates success) when scaffolding
    // can't complete in this sandbox — the true happy path is covered by Task 3's unit
    // test (fake CLI) and Task 9's manual end-to-end run.
    check('scaffold-project route exists and returns a well-formed response', scaffoldServerChecks.result && 'ok' in scaffoldServerChecks.result.json);
    fs.rmSync(scaffoldParent, { recursive: true, force: true });

    // ── /api/dataverse-state: read-only table list for the Add-datasource picker ──
    const dvStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-dvstate-'));
    const { writeState: writeDvState } = require('./dataverse-schema');
    writeDvState(dvStateRoot, { tables: [{ displayName: 'Invoices', logicalName: 'cr_invoice', columns: [] }] });
    const dvSrv = serve(dvStateRoot, { port: 0 });
    const dvChecks = await new Promise((resolve) => {
      dvSrv.on('listening', async () => {
        const port = dvSrv.address().port;
        const state = await req(port, 'GET', '/api/dataverse-state');
        dvSrv.close(() => resolve({ state }));
      });
    });
    check('/api/dataverse-state returns the tables already applied to Dataverse', Array.isArray(dvChecks.state.json.tables) && dvChecks.state.json.tables[0].logicalName === 'cr_invoice');
    fs.rmSync(dvStateRoot, { recursive: true, force: true });
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — `/api/action` with `type: 'scaffold-project'` falls through to `controller.action(body)` and returns `{ ok: false, error: 'unknown action: scaffold-project' }` (still well-formed, so the first check may pass — but `/api/dataverse-state` returns 404/empty, failing the second check).

- [ ] **Step 3: Implement in `server.js`**

Add two `require`s near the top of `tools/lifecycle/lib/server.js` (next to the existing `scaffold.js` require):

```js
const scaffoldCli = require('./scaffold-cli');
const dataverseSchema = require('./dataverse-schema');
```

Add a new closure function inside `function serve(root, opts = {})`, right after the existing `createProject` function (`server.js:152`):

```js
  // Create a brand-new, fully-scaffolded PowerCodex project (starter + OpenSpec + all
  // OPSX prompts/skills + git init — the same output as `powercodex <name>` on the
  // command line) inside a folder the maker picked, then switch the live workspace to
  // it — same "re-point activeRoot" mechanism openProject() already uses.
  async function scaffoldProject(body = {}) {
    const targetDir = body.targetDir;
    if (!targetDir) return { ok: false, error: 'No target folder was selected' };
    let st;
    try { st = fs.statSync(targetDir); } catch { return { ok: false, error: 'That folder no longer exists: ' + targetDir }; }
    if (!st.isDirectory()) return { ok: false, error: 'That path is not a folder: ' + targetDir };
    const boundEmit = async ({ level, message }) => {
      emit(activeRoot, { rotation: 0, stage: 0, agent: 'intake', level, message: 'New project · ' + message });
      render(activeRoot);
    };
    const result = await scaffoldCli.scaffoldNewProject(targetDir, { name: body.name, emit: boundEmit });
    if (!result.scaffolded) return { ok: false, error: result.error || 'Could not scaffold the project' };
    const opened = openProject(result.projectDir);
    return Object.assign({ ok: opened.ok !== false, projectDir: result.projectDir }, opened);
  }
```

In the `/api/action` handler, add the new route right after the existing `create-project` line (`server.js:324`):

```js
        if (body.type === 'scaffold-project') return json(res, 200, await scaffoldProject(body));
```

In the `/api/agent` handler, right after the existing `if (result.kind === 'build') { ... }` block closes (`server.js:316`, before `return json(res, 200, result);`), add:

```js
        if (result.kind === 'scaffold-project' && result.name) {
          // Chat-driven scaffold has no folder picker (that's an Electron-only native
          // capability); default to a sibling of the current workspace, same as typing
          // a name with no location — matches the "usable immediately" goal without
          // requiring a UI round-trip.
          const parent = path.dirname(activeRoot);
          const scaffolded = await scaffoldProject({ targetDir: parent, name: result.name });
          result.ok = scaffolded.ok;
          result.reply = scaffolded.ok
            ? `Created "${result.name}" and switched to it. It's ready to build.`
            : `Couldn't create "${result.name}": ${scaffolded.error || 'see activity log'}`;
        }
```

Add a new route for the Add-datasource picker, right after the existing `/api/plans` GET route (search for `req.url.startsWith('/api/plans')` and add this immediately after that block's closing):

```js
      if (req.method === 'GET' && req.url.startsWith('/api/dataverse-state')) {
        return json(res, 200, dataverseSchema.readState(activeRoot));
      }
```

- [ ] **Step 4: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on both new checks.

- [ ] **Step 5: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/lib/server.js templates/starter/tools/lifecycle/lib/server.js
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/lib/server.js templates/starter/tools/lifecycle/lib/server.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tools/lifecycle/lib/server.js tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/server.js templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(lifecycle): wire scaffold-project routing + dataverse-state endpoint"
```

---

### Task 8: `chat.html` — Push / Add-datasource buttons + Create-new-project entry point

**Files:**
- Modify: `tools/lifecycle/assets/chat.html`
- Modify (mirror): `templates/starter/tools/lifecycle/assets/chat.html`
- Test: `tools/lifecycle/lib/selftest.js` (+ mirror) — markup assertions, matching the existing Preview\|Code toggle check style (`selftest.js:632-644`).

**Interfaces:**
- Consumes: `api('push', {})`, `api('add-datasource', {api, table})`, `api('scaffold-project', {targetDir, name})` (all from Task 5/7), `GET /api/dataverse-state` (Task 7), `window.pcDesktop.pickFolder()` (existing, desktop-only — falls back to the existing folder-path text input in the browser, same graceful degrade the "Open project" modal already uses).

- [ ] **Step 1: Add the failing selftest checks**

In `tools/lifecycle/lib/selftest.js`, inside the existing `for (const [i, p] of chatHtmlPaths.entries())` loop (`selftest.js:636-644`), add after the existing four `check(...)` lines:

```js
      check(`toolbar has a Push button gated on allowPush (${label})`, /id="pushBtn"/.test(html) && html.includes("rights.allowPush"));
      check(`toolbar has an Add datasource button (${label})`, /id="datasourceBtn"/.test(html));
      check(`Add-datasource panel lists Dataverse tables from /api/dataverse-state (${label})`, /api\/dataverse-state/.test(html) && /id="dsPanel"/.test(html));
      check(`there is a Create new project entry point calling scaffold-project (${label})`, /id="newProjectBtn"/.test(html) && html.includes("'scaffold-project'"));
```

- [ ] **Step 2: Run the selftest to see it fail**

Run: `npm run lifecycle:selftest`
Expected: FAIL — none of the new ids/strings exist yet.

- [ ] **Step 3: Add the toolbar buttons**

In `tools/lifecycle/assets/chat.html`, in the header `<div class="right">` block (around line 284-292), add three buttons right before the existing `<button class="statusbtn" id="statusBtn">`:

```html
      <button class="iconbtn" id="newProjectBtn" title="Create a brand-new PowerCodex project">✨ New project</button>
      <button class="iconbtn" id="datasourceBtn" title="Wire up a Dataverse table or connector">🧩 Add datasource</button>
      <button class="iconbtn" id="pushBtn" title="npm run build && pac code push" disabled>🚀 Push</button>
```

- [ ] **Step 4: Add the Add-datasource picker modal**

Right after the existing "folder picker" overlay `</div>` closing tag (end of the block starting `<!-- folder picker -->`, around line 378), add:

```html
  <!-- add datasource -->
  <div class="overlay" id="dsOverlay">
    <div class="modal" id="dsPanel">
      <div class="mh"><span>🧩</span><span class="t">Add a data source</span><button type="button" class="x" id="dsClose">✕</button></div>
      <div class="fpbar"><select id="dsTableSelect"><option value="">— pick a Dataverse table —</option></select></div>
      <div class="fpbar"><input id="dsConnectorInput" type="text" placeholder="…or a connector id, e.g. shared_sharepointonline" /></div>
      <div class="mf"><span class="hint">Dataverse tables come from what's already been created via the browser flow. Other connectors need to exist in make.powerapps.com first.</span><button type="button" class="btn go" id="dsGo">Add data source</button></div>
    </div>
  </div>
```

- [ ] **Step 5: Wire the buttons in the script**

In `tools/lifecycle/assets/chat.html`'s script, right after the existing `$('openVSCodeBtn').onclick = openInVSCode;` line (around line 997), add:

```js
  // ---------- Push ----------
  $('pushBtn').onclick = async () => {
    $('pushBtn').disabled = true;
    bubble('me', 'Push 🚀');
    const r = await api('push', {});
    bubble('ai', r.ok ? '✅ Pushed to your environment.' : '⚠️ ' + esc(r.error || 'Push failed'));
    if(app.treeRoot) loadTree();
  };

  // ---------- Add datasource ----------
  async function openDatasourcePanel(){
    $('dsOverlay').classList.add('open');
    const sel = $('dsTableSelect');
    sel.innerHTML = '<option value="">— pick a Dataverse table —</option>';
    try {
      const state = await (await fetch('/api/dataverse-state', {cache:'no-store'})).json();
      (state.tables||[]).forEach(t => { if(t.logicalName){ const o=document.createElement('option'); o.value=t.logicalName; o.textContent=t.displayName+' ('+t.logicalName+')'; sel.appendChild(o); } });
    } catch { /* picker still usable via the free-text connector field */ }
  }
  $('datasourceBtn').onclick = openDatasourcePanel;
  $('dsClose').onclick = () => $('dsOverlay').classList.remove('open');
  $('dsOverlay').onclick = (e) => { if(e.target===$('dsOverlay')) $('dsOverlay').classList.remove('open'); };
  $('dsGo').onclick = async () => {
    const table = $('dsTableSelect').value;
    const connector = $('dsConnectorInput').value.trim();
    $('dsOverlay').classList.remove('open');
    bubble('me', table ? 'Add datasource: '+table : (connector ? 'Add datasource: '+connector : 'Add datasource'));
    const r = await api('add-datasource', table ? {api:'dataverse', table} : {api: connector});
    bubble('ai', r.ok ? '✅ Data source added.' : '⚠️ ' + esc(r.error || 'Could not add that data source'));
  };

  // ---------- Create new project ----------
  $('newProjectBtn').onclick = async () => {
    const name = prompt('Project name:');
    if(!name) return;
    let targetDir = null;
    if(window.pcDesktop && window.pcDesktop.pickFolder) targetDir = await window.pcDesktop.pickFolder();
    if(!targetDir) targetDir = prompt('Folder to create it in (absolute path):');
    if(!targetDir) return;
    bubble('me', 'New project: '+name);
    const typing = showTyping();
    const r = await api('scaffold-project', {targetDir, name});
    typing.remove();
    bubble('ai', r.ok ? '✅ Created "'+esc(name)+'" and switched to it. It’s ready to build.' : '⚠️ ' + esc(r.error || 'Could not create the project'));
    if(r.ok){ loadTree(); }
  };
```

- [ ] **Step 6: Gate the Push/Add-datasource buttons on `allowPush`**

In the existing `paintStatus(state)` function (find it — called from `tick()` at `chat.html:577`), add at the end of its body:

```js
    const rights = (state.intake && state.intake.rights) || {};
    $('pushBtn').disabled = rights.allowPush !== true;
    $('datasourceBtn').title = rights.allowPush === true ? 'Wire up a Dataverse table or connector' : 'Turn on "Publish to my environment" first';
```

- [ ] **Step 7: Run the selftest to see it pass**

Run: `npm run lifecycle:selftest`
Expected: PASS on all 4 new checks (both the engine and vendored-starter copies, once Step 8 mirrors the file).

- [ ] **Step 8: Mirror into `templates/starter/`**

```bash
cp tools/lifecycle/assets/chat.html templates/starter/tools/lifecycle/assets/chat.html
cp tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/lib/selftest.js
diff tools/lifecycle/assets/chat.html templates/starter/tools/lifecycle/assets/chat.html
```
Expected: no output.

- [ ] **Step 9: Manual smoke test**

Run: `npm run lifecycle:serve -- --open` from the repo root, open the chat UI, confirm: "🚀 Push" is greyed out until you flip "Publish to my environment" on in the status panel; "🧩 Add datasource" opens the picker and lists any tables in `.powercodex/dataverse.json` if present; "✨ New project" prompts for a name and folder and, on a real run (not the selftest's faked CLI), actually creates a full PowerCodex project there.

- [ ] **Step 10: Commit**

```bash
git add tools/lifecycle/assets/chat.html tools/lifecycle/lib/selftest.js templates/starter/tools/lifecycle/assets/chat.html templates/starter/tools/lifecycle/lib/selftest.js
git commit -m "feat(chat): add Push, Add datasource, and New project to the toolbar"
```

---

### Task 9: `desktop/scripts/sync-lifecycle.js` — vendor the CLI + full templates dir

**Files:**
- Modify: `desktop/scripts/sync-lifecycle.js`

**Interfaces:**
- Consumes: nothing new — this only changes what gets copied into `desktop/vendor/` before `npm start`/`npm run dist`.
- Produces: `desktop/vendor/bin/create-powercodex.js` and `desktop/vendor/templates/` (the whole `templates/` tree, not just `templates/starter/`), so `scaffold-cli.js`'s `binPath()` candidate `path.resolve(__dirname, '..', '..', 'bin', 'create-powercodex.js')` (Task 3) resolves inside the packaged desktop app, and the spawned CLI's own `templateRoot = path.resolve(__dirname, '..', 'templates')` (in `bin/create-powercodex.js`, unmodified) finds `templates/github` and `templates/openspec` alongside `templates/starter`.

**Context:** Without this task, "✨ New project" works when running `npm start` inside the repo checkout (Task 3's repo-checkout candidate resolves), but silently fails with "Full project scaffolding is not available here" in the packaged `.exe`/`.dmg` — because today `sync-lifecycle.js` only vendors `tools/lifecycle` and `templates/starter`, never `bin/` or `templates/github`/`templates/openspec`. This is a real production gap in the design as originally approved; fixing it here keeps "one CLI, two entry points" true instead of only true in dev mode.

- [ ] **Step 1: Manually verify the current gap**

Run: `cd desktop && npm install && npm run sync && ls vendor/`
Expected: `vendor/bin` does **not** exist; `vendor/templates/` contains only `starter/`, not `github/` or `openspec/`.

- [ ] **Step 2: Update `sync-lifecycle.js`**

In `desktop/scripts/sync-lifecycle.js`, replace the "vendor the starter template" block (from `// The published starter is the canonical scaffold...` to the end of the file) with:

```js
// Vendor the whole templates/ tree (starter + github OPSX prompts/skills + the fixed
// openspec/config.yaml) and bin/create-powercodex.js, so "✨ New project" inside the
// packaged app can spawn the exact same full scaffold the `powercodex` CLI produces
// (one CLI, two entry points — decision D5, extended). scaffold-cli.js resolves the
// vendored bin at vendor/bin/create-powercodex.js, which in turn resolves its own
// template root at vendor/templates/ relative to itself — no path changes needed
// inside create-powercodex.js itself.
const templatesSrc = path.resolve(__dirname, '..', '..', 'templates');
const templatesDst = path.resolve(__dirname, '..', 'vendor', 'templates');
if (fs.existsSync(templatesSrc)) {
  fs.rmSync(templatesDst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(templatesDst), { recursive: true });
  fs.cpSync(templatesSrc, templatesDst, { recursive: true, filter: (s) => !SKIP.test(s) });
  console.log('synced templates →', path.relative(process.cwd(), templatesDst));
} else {
  console.warn('templates/ not found at', templatesSrc, '— desktop scaffold will fall back to the generic template, and "New project" will be unavailable');
}

const binSrc = path.resolve(__dirname, '..', '..', 'bin', 'create-powercodex.js');
const binDst = path.resolve(__dirname, '..', 'vendor', 'bin', 'create-powercodex.js');
if (fs.existsSync(binSrc)) {
  fs.mkdirSync(path.dirname(binDst), { recursive: true });
  fs.copyFileSync(binSrc, binDst);
  console.log('synced create-powercodex.js →', path.relative(process.cwd(), binDst));
} else {
  console.warn('bin/create-powercodex.js not found — "New project" will be unavailable in this build');
}
```

Also update `desktop/package.json`'s `"files"` array to include the vendored `bin/` alongside the existing `vendor/**/*` glob — verify `"files": ["main.js", "preload.js", "vendor/**/*", "package.json"]` already covers it (`vendor/**/*` is recursive, so `vendor/bin/create-powercodex.js` is included automatically — no change needed there; just confirm after Step 3).

- [ ] **Step 3: Re-run sync and verify**

Run: `cd desktop && npm run sync && ls vendor/bin && ls vendor/templates`
Expected: `vendor/bin/create-powercodex.js` exists; `vendor/templates/` contains `starter/`, `github/`, and `openspec/`.

- [ ] **Step 4: Manual end-to-end smoke test**

Run: `cd desktop && npm start`, click "✨ New project", give it a name and an empty target folder, confirm a real project is created there with `.github/prompts/`, `openspec/config.yaml`, and a git repo initialized — the same output `powercodex <name>` produces from the terminal.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/sync-lifecycle.js
git commit -m "fix(desktop): vendor bin/create-powercodex.js + full templates/ so New project works in the packaged app"
```
