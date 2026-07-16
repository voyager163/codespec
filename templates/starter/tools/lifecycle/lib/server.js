'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { deriveState } = require('./state');
const { emit } = require('./bus');
const { render } = require('./dashboard');
const { Controller } = require('./control');
const { listPlans, plansDir } = require('./plans');
const providers = require('./providers');
const chat = require('./chat');
const memory = require('./memory');
const agent = require('./agent');
const artifacts = require('./artifacts');
const project = require('./project');
const mcp = require('./mcp');
const browse = require('./browse');
const { importInto } = require('./import');
const { scaffold, installDeps, isScaffolded } = require('./scaffold');
const preview = require('./preview');
const publish = require('./publish');
const e2e = require('./e2e');
const { verifyBuild } = require('./codegen');

const CLIENT = path.join(__dirname, '..', 'assets', 'dashboard.html');
const GUIDE = path.join(__dirname, '..', 'assets', 'user-guide.html');
const CHAT = path.join(__dirname, '..', 'assets', 'chat.html');

// Path containment that respects directory boundaries. `abs.startsWith(base)` alone
// lets a sibling like `<base>-evil` through; require an exact match or a real separator.
const within = (base, abs) => {
  const b = path.resolve(base);
  const a = path.resolve(abs);
  return a === b || a.startsWith(b + path.sep);
};

// A tiny zero-dependency live dashboard + maker-chat server. The client polls
// /api/state and re-renders, and POSTs to /api/action, /api/emit and /api/chat to
// drive the loop. Works over http:// — no browser file:// fetch restrictions.
function serve(root, opts = {}) {
  const port = opts.port != null ? opts.port : 4321;
  const simulate = opts.simulate !== false;
  // The active project. "Add existing" can re-point this at a chosen folder at
  // runtime; everything below reads activeRoot so the switch is seamless.
  let activeRoot = root;
  let controller = new Controller(activeRoot, { simulate });

  // Switch the live project to a chosen local folder: vendor PowerCodex into it
  // (consent gate + plan registry + config) and read its code into a digest — the
  // brownfield ingestion, behind a button. Returns a summary for the chat.
  function openProject(p) {
    if (!p) return { ok: false, error: 'No folder was selected' };
    const abs = path.resolve(String(p));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return { ok: false, error: 'That folder no longer exists: ' + abs };
    }
    if (!st.isDirectory()) return { ok: false, error: 'That path is not a folder: ' + abs };
    // Structural import first — cheap and safe (consent gate, plan registry, config).
    let summary;
    try {
      summary = importInto(abs, {});
    } catch (e) {
      return { ok: false, error: 'Could not set up that folder (check write permission): ' + e.message };
    }
    // Brownfield ingestion is best-effort: a scan hiccup must never block opening.
    let digest = null;
    try {
      const { buildDigest, writeDigest } = require('./digest');
      digest = buildDigest(abs);
      writeDigest(abs, digest);
    } catch {
      digest = null;
    }
    // Stop any dev server running for the project we're leaving.
    try { preview.stop(activeRoot); } catch { /* best-effort */ }
    activeRoot = abs;
    controller = new Controller(activeRoot, { simulate });
    render(activeRoot);
    return {
      ok: true,
      name: summary.stack.name,
      mode: summary.stack.mode,
      digest: digest ? { routes: (digest.routes || []).length, components: (digest.components || []).length } : null,
    };
  }

  // Scaffold a fresh, real code app into the active workspace and start installing its
  // dependencies in the background. Safe: only scaffolds a truly empty workspace (no
  // package.json), never over an existing project. The first build verifies once deps
  // land; until then the build gate reports honestly that deps aren't installed yet.
  function createProject(body = {}) {
    const hasPkg = fs.existsSync(path.join(activeRoot, 'package.json'));
    if (hasPkg && !isScaffolded(activeRoot)) {
      return { ok: false, error: 'This folder already has a project. Use “Open project” instead.' };
    }
    let result;
    try {
      result = scaffold(activeRoot, { name: body.name });
    } catch (e) {
      return { ok: false, error: 'Could not scaffold the app: ' + e.message };
    }
    // Make it a PowerCodex workspace (consent gate + config) like the import path does.
    try {
      importInto(activeRoot, { name: result.name || body.name });
    } catch {
      /* non-fatal — the scaffold itself is what matters */
    }
    // Install in the background; relay a few lines onto the bus so the UI shows life.
    installDeps(activeRoot, {
      onLine: (line) => {
        if (/added|packages|error|warn/i.test(line)) {
          emit(activeRoot, { rotation: 0, stage: 0, agent: 'intake', level: /error/i.test(line) ? 'bad' : 'info', message: 'Setup · ' + line.slice(0, 120) });
          render(activeRoot);
        }
      },
    }).then((r) => {
      emit(activeRoot, {
        rotation: 0,
        stage: 0,
        agent: 'intake',
        level: r.ok ? 'good' : 'warn',
        message: r.already ? 'Dependencies already present' : r.ok ? 'Setup complete · your app is ready to build' : `Setup finished with issues (${r.error || 'code ' + r.code}) · you can still build; verification needs deps`,
      });
      render(activeRoot);
    });
    render(activeRoot);
    return { ok: true, name: result.name, scaffolded: result.created, installing: true };
  }

  // Lightweight project identity for the chat header.
  function projectInfo() {
    let name = path.basename(activeRoot);
    let mode = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(activeRoot, '.powercodex', 'config.json'), 'utf8'));
      name = cfg.name || name;
      mode = cfg.mode || null;
    } catch {
      /* no config yet — basename is fine */
    }
    // Detected project type + any MCP servers, so the UI can show "Power BI project"
    // and the agent can route to the right tool. Best-effort; never blocks state.
    let type = null;
    let typeLabel = null;
    let servers = [];
    try {
      const det = project.detect(activeRoot);
      type = det.type;
      typeLabel = det.label;
    } catch {
      /* leave null */
    }
    try {
      servers = mcp.list(activeRoot);
    } catch {
      servers = [];
    }
    return { name, root: activeRoot, mode, type, typeLabel, mcp: servers };
  }

  const server = http.createServer(async (req, res) => {
    try {
      // CSRF / cross-origin protection. The dashboard API mutates the local workspace —
      // it writes files and drives the real build loop — so a request originating from any
      // other web origin must never be honored. Browsers attach an Origin header to every
      // cross-site request (including "simple" text/plain POSTs that skip preflight), so a
      // mutating request carrying a non-local Origin is a forged cross-site request: reject
      // it. Same-origin calls from our own dashboard send a localhost Origin (or none, for
      // server-to-server/CLI callers), which are allowed.
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && !isLocalOrigin(origin)) {
          return json(res, 403, { ok: false, error: 'cross-origin request blocked' });
        }
      }
      if (req.method === 'POST' && req.url.startsWith('/api/emit')) {
        const body = await readBody(req);
        emit(activeRoot, {
          rotation: body.rotation,
          stage: body.stage,
          agent: body.agent || 'external',
          level: body.level || 'info',
          message: body.message || '',
          data: body.data,
        });
        render(activeRoot);
        return json(res, 200, { ok: true });
      }
      // Provider-backed conversation: plain-language in → friendly reply + optional plan.
      // When a plan is produced we author the comprehensive plan document to the repo
      // (.powercodex/plans/) and register it, so the Canvas can render the rich plan and
      // the agent can refer back to it later. Authoring must never break the chat reply.
      if (req.method === 'POST' && req.url.startsWith('/api/chat')) {
        const body = await readBody(req);
        // Feed the durable project memory into the turn so the assistant stays in context.
        let mem = '';
        try {
          mem = memory.summarize(activeRoot);
        } catch {
          mem = '';
        }
        const out = await chat.respond(activeRoot, { message: body.message || '', history: body.history || [], providerId: body.provider, memory: mem });
        // Learn from the turn (cheap heuristics; never blocks the reply).
        try {
          memory.noteTurn(activeRoot, { message: body.message || '', intent: out.intent });
        } catch {
          /* memory is best-effort */
        }
        if (out && out.plan) {
          try {
            const entry = require('./planhtml').authorPlan(activeRoot, { goal: body.message || '', plan: out.plan, provider: out.provider });
            out.planFile = entry.file;
            out.planId = entry.id;
            try {
              memory.record(activeRoot, { artifact: { id: entry.id, kind: 'plan', title: entry.title } });
            } catch {
              /* best-effort */
            }
          } catch (e) {
            // Leave the reply intact; the Canvas falls back to its inline skeleton.
            out.planError = e.message;
          }
        } else if (out && (out.intent === 'artifact' || (out.intent === 'answer' && artifacts.kindFromMessage(body.message || '') === 'architecture'))) {
          // A non-build deliverable (Power BI dashboard, architecture overview, document…)
          // is authored as an artifact the Canvas renders — this is the "architecture
          // overview" path the maker asked for.
          try {
            const kind = artifacts.kindFromMessage(body.message || '');
            const entry = artifacts.save(activeRoot, { kind, goal: body.message || '' });
            out.artifactFile = entry.file;
            out.artifactId = entry.id;
            out.artifactKind = entry.kind;
            try {
              memory.record(activeRoot, { artifact: entry });
            } catch {
              /* best-effort */
            }
          } catch (e) {
            out.artifactError = e.message;
          }
        }
        return json(res, 200, out);
      }
      // Agent mode: EXECUTE against the active workspace. Streams activity onto the live
      // bus, authors artifacts, or (for a build request) drives the real lifecycle loop —
      // the same engine the chat's "Build this" uses.
      if (req.method === 'POST' && req.url.startsWith('/api/agent')) {
        const body = await readBody(req);
        const boundEmit = (e) => {
          emit(activeRoot, Object.assign({ rotation: 0, stage: 3, agent: 'agent', level: 'info', message: '' }, e));
          render(activeRoot);
        };
        let memSummary = '';
        try {
          memSummary = memory.summarize(activeRoot);
        } catch {
          memSummary = '';
        }
        const result = await agent.run(activeRoot, { message: body.message || '', history: body.history || [], provider: body.provider, emit: boundEmit, memory: memSummary });
        try {
          memory.noteTurn(activeRoot, { message: body.message || '', intent: result.intent });
        } catch {
          /* best-effort */
        }
        if (result.kind === 'build') {
          // Plan deterministically, author the plan document, then intake + start the loop.
          const plan = chat.heuristicPlan(body.message || '');
          try {
            const entry = require('./planhtml').authorPlan(activeRoot, { goal: body.message || '', plan, provider: result.provider });
            result.planFile = entry.file;
            result.planId = entry.id;
            result.plan = { title: 'Plan: ' + plan.title, items: plan.items };
            try {
              memory.record(activeRoot, { artifact: { id: entry.id, kind: 'plan', title: entry.title } });
            } catch {
              /* best-effort */
            }
            await controller.action({
              type: 'intake',
              goal: body.message || '',
              mvp: plan.items.map((i) => '• ' + i).join('\n'),
              plan: { title: plan.title, items: plan.items },
              provider: body.provider,
              planId: entry.id,
            });
            const started = await controller.action({ type: 'start', rotations: 2 });
            result.building = !!(started && started.started);
            result.reply = result.reply || 'On it — building now. Watch the progress in the status panel.';
          } catch (e) {
            result.buildError = e.message;
          }
        }
        return json(res, 200, result);
      }
      if (req.method === 'POST' && req.url.startsWith('/api/action')) {
        const body = await readBody(req);
        // open-project re-points the live root; create-project scaffolds a fresh code
        // app into the active workspace; everything else is loop control.
        if (body.type === 'open-project') return json(res, 200, openProject(body.path));
        if (body.type === 'create-project') return json(res, 200, createProject(body));
        // Open the whole project in VS Code, or launch a provider sign-in in a terminal.
        if (body.type === 'open-in-vscode') return json(res, 200, require('./setup').openInVSCode(activeRoot));
        if (body.type === 'provider-signin') return json(res, 200, require('./setup').signIn(body.provider));
        // Live localhost preview — run the app for real, no Dataverse/auth needed.
        if (body.type === 'preview-start') {
          const boundEmit = (line) => {
            emit(activeRoot, { rotation: 0, stage: 4, agent: 'preview', level: /error|fail/i.test(line) ? 'bad' : 'info', message: 'Preview · ' + String(line).slice(0, 120) });
            render(activeRoot);
          };
          const onExit = (info) => {
            emit(activeRoot, { rotation: 0, stage: 4, agent: 'preview', level: 'warn', message: `Preview stopped unexpectedly (exit ${info.code}) · ${(info.tail || []).slice(-1)[0] || ''}` });
            render(activeRoot);
          };
          const result = await preview.start(activeRoot, { onLine: boundEmit, onExit });
          emit(activeRoot, { rotation: 0, stage: 4, agent: 'preview', level: result.ok ? 'good' : 'warn', message: result.ok ? `Preview running → ${result.url}` : `Preview not started · ${result.error || ''}` });
          render(activeRoot);
          return json(res, 200, result);
        }
        if (body.type === 'preview-stop') return json(res, 200, preview.stop(activeRoot));
        // Real end-to-end test: exercise every element on the running app (Rule 3).
        if (body.type === 'e2e-run') {
          const boundEmit = (level, message) => { emit(activeRoot, { rotation: 0, stage: 5, agent: 'e2e-tester', level, message }); render(activeRoot); };
          let url = preview.status(activeRoot).url;
          if (!url) {
            const started = await preview.start(activeRoot, { onLine: () => {} });
            if (!started.ok) { boundEmit('warn', 'Cannot test — app not running: ' + (started.error || '')); return json(res, 200, { ok: false, error: started.error, needsInstall: started.needsInstall }); }
            url = started.url;
          }
          const driver = await e2e.createPlaywrightDriver({ headless: true }).catch(() => null);
          if (!driver) { boundEmit('warn', 'Playwright not installed — run: npm i -D playwright'); return json(res, 200, { ok: false, needsPlaywright: true, url }); }
          boundEmit('info', `Testing every element on ${url}…`);
          let shown = 0;
          const result = await e2e.runE2E(url, driver, { onStep: (s) => { if (shown++ < 12) boundEmit('info', 'Exercised · ' + s.label); } });
          boundEmit(result.passed ? 'good' : 'bad', result.passed
            ? `Green · exercised ${result.exercised}/${result.planned} interactions across ${result.elements} elements`
            : `${result.hardFailures.length} issue(s) found across ${result.exercised} interactions`);
          return json(res, 200, Object.assign({ ok: true, url }, result));
        }
        // Verified fix: apply an AI fix for a reported bug, then prove the app still
        // builds (and, if it's running, that the element test is green) before claiming done.
        if (body.type === 'fix') {
          const boundEmit = (e) => { emit(activeRoot, Object.assign({ rotation: 0, stage: 3, agent: 'agent', level: 'info', message: '' }, e)); render(activeRoot); };
          const desc = String(body.message || '').trim();
          if (!desc) return json(res, 200, { ok: false, error: 'Describe the bug to fix.' });
          boundEmit({ level: 'info', message: 'Fixing: ' + desc.slice(0, 100) });
          let agentResult = null;
          try {
            agentResult = await agent.run(activeRoot, { message: 'Fix this issue and keep the app building: ' + desc, history: body.history || [], provider: body.provider, emit: boundEmit });
          } catch (e) { agentResult = { reply: 'fix attempt failed: ' + e.message }; }
          const build = verifyBuild(activeRoot);
          boundEmit({ level: build.passed ? 'good' : 'bad', message: build.ran ? (build.passed ? 'Build verified after fix' : 'Still not building — ' + (build.errors || []).slice(0, 2).join(' · ')) : 'Build not verified (' + (build.reason || 'deps') + ')' });
          const out = { ok: build.passed !== false, build: { ran: build.ran, passed: build.passed, errors: build.errors || [] }, reply: agentResult && agentResult.reply };
          return json(res, 200, out);
        }
        // Publish to Power Platform (consent-gated, real pac flow).
        if (body.type === 'publish-check') return json(res, 200, await publish.check(activeRoot));
        if (body.type === 'publish') {
          const boundEmit = async (e) => {
            emit(activeRoot, Object.assign({ rotation: 0, stage: 4, agent: 'publish', level: 'info', message: '' }, e));
            render(activeRoot);
          };
          const result = await publish.publish(activeRoot, {
            appName: body.appName,
            environmentUrl: body.environmentUrl,
            confirm: body.confirm === true,
            emit: boundEmit,
          });
          return json(res, 200, result);
        }
        return json(res, 200, await controller.action(body));
      }
      // Deep readiness: installed AND signed in, per provider (probes the CLIs, so it can
      // take a few seconds). Drives the no-degrade setup gate.
      if (req.url.startsWith('/api/providers/ready')) {
        const list = await providers.readiness();
        return json(res, 200, { providers: list, anyReady: providers.anyRealReady(list), vscode: require('./setup').vsCodeAvailable() });
      }
      if (req.url.startsWith('/api/providers')) {
        return json(res, 200, { providers: providers.list() });
      }
      // Read-only local folder listing for the "Add existing" picker.
      if (req.url.startsWith('/api/fs')) {
        const u = new URL(req.url, 'http://localhost');
        try {
          return json(res, 200, Object.assign({ ok: true }, browse.listDir(u.searchParams.get('path'))));
        } catch (e) {
          return json(res, 200, { ok: false, error: e.message });
        }
      }
      // The workspace file tree (files + folders), scoped to the active project.
      if (req.url.startsWith('/api/tree')) {
        const u = new URL(req.url, 'http://localhost');
        const p = u.searchParams.get('path');
        const wsRoot = path.resolve(activeRoot);
        const abs = p ? path.resolve(p) : wsRoot;
        if (!within(wsRoot, abs)) return json(res, 200, { ok: false, error: 'outside workspace', root: activeRoot });
        try {
          return json(res, 200, Object.assign({ ok: true, root: activeRoot }, browse.listTree(abs)));
        } catch (e) {
          return json(res, 200, { ok: false, error: e.message, root: activeRoot });
        }
      }
      // Saved artifacts (architecture overviews, dashboards, documents…) for the Canvas switcher.
      if (req.url.startsWith('/api/artifacts')) {
        return json(res, 200, { artifacts: artifacts.list(activeRoot) });
      }
      // Preview any file inside the active workspace (HTML renders, images show, text/code
      // is wrapped in a readable page). Path-traversal guarded to the workspace root.
      if (req.url.startsWith('/api/file')) {
        const u = new URL(req.url, 'http://localhost');
        const rel = u.searchParams.get('path');
        if (!rel) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('path required');
          return;
        }
        const wsRoot = path.resolve(activeRoot);
        const abs = path.resolve(activeRoot, rel);
        if (!within(wsRoot, abs) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const ext = path.extname(abs).toLowerCase();
        const RAW = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
        if (ext === '.html' || ext === '.htm') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(fs.readFileSync(abs, 'utf8'));
          return;
        }
        if (RAW[ext]) {
          res.writeHead(200, { 'content-type': RAW[ext], 'cache-control': 'no-store' });
          res.end(fs.readFileSync(abs));
          return;
        }
        // Text / code: wrap in a styled page so the Canvas iframe shows it cleanly.
        let content = '';
        try {
          const st = fs.statSync(abs);
          content = st.size > 2_000_000 ? '(file too large to preview)' : fs.readFileSync(abs, 'utf8');
        } catch {
          content = '';
        }
        const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const page =
          '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b0d12;color:#cdd6ea;font:12.5px/1.6 ui-monospace,Menlo,Consolas,monospace}' +
          '.h{position:sticky;top:0;background:#11151e;color:#99a2b8;padding:8px 14px;border-bottom:1px solid #262c3a;font-family:-apple-system,Segoe UI,sans-serif}' +
          'pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word}</style>' +
          '<div class="h">' + escHtml(rel) + '</div><pre>' + escHtml(content) + '</pre>';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(page);
        return;
      }
      if (req.url.startsWith('/api/preview')) {
        return json(res, 200, preview.status(activeRoot));
      }
      if (req.url.startsWith('/api/state')) {
        return json(res, 200, Object.assign(deriveState(activeRoot), { control: controller.status(), project: projectInfo() }));
      }
      if (req.url.startsWith('/api/plans')) {
        return json(res, 200, { plans: listPlans(activeRoot) });
      }
      if (req.url.startsWith('/api/stories')) {
        const { readStories } = require('./stories');
        return json(res, 200, readStories(activeRoot) || { stories: [], grounded: false, status: 'draft' });
      }
      // The readable user-stories view, opened from the dashboard.
      if (req.url.startsWith('/stories')) {
        const { storiesHtmlPath } = require('./stories');
        const p = storiesHtmlPath(activeRoot);
        if (fs.existsSync(p)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(p, 'utf8'));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('No stories yet — run: powercodex import --analyze');
        return;
      }
      // The friendly maker surface — Chat & Agent modes. The same engine as the
      // dashboard, but a conversation-first front door for low-code makers.
      if (req.url === '/chat' || req.url.startsWith('/chat?') || req.url.startsWith('/chat/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(CHAT, 'utf8'));
        return;
      }
      // The user guide — a self-contained help page, opened from the dashboard.
      if (req.url.startsWith('/guide') || req.url.startsWith('/user-guide')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(GUIDE, 'utf8'));
        return;
      }
      // Serve generated plan artifacts (the plan viewer): the rich .html, its structured
      // .json sibling, and any captured screenshots under shots/. Path-traversal guarded —
      // only files inside .powercodex/plans/ are served.
      if (/\.powercodex\/(plans|artifacts)\//.test(req.url) && /\.(html|json|png)$/.test(req.url.split('?')[0])) {
        const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
        const abs = path.resolve(activeRoot, rel);
        const okBase = within(plansDir(activeRoot), abs) || within(artifacts.artifactsDir(activeRoot), abs);
        if (okBase && fs.existsSync(abs)) {
          const type = abs.endsWith('.json') ? 'application/json' : abs.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
          res.end(abs.endsWith('.png') ? fs.readFileSync(abs) : fs.readFileSync(abs, 'utf8'));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Plan not found');
        return;
      }
      if (!req.url || req.url === '/' || req.url.startsWith('/index') || req.url.startsWith('/?')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(CLIENT, 'utf8'));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
  });

  // Never leave a preview dev server running after the dashboard server closes.
  server.on('close', () => { try { preview.stopAll(); } catch { /* best-effort */ } });

  // Bind to loopback only. The dashboard drives privileged local actions (file writes,
  // build loop, provider sign-in) and has no network authentication, so it must not be
  // reachable from other hosts on the LAN.
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    const url = `http://localhost:${actual}`;
    console.log(`PowerCodex live dashboard → ${url}`);
    console.log(`PowerCodex maker chat     → ${url}/chat  (Chat & Agent modes)`);
    console.log('Monitoring .powercodex/live/status.json — open the URL and drive it from there.');
    if (opts.open) openBrowser(url);
    if (opts.demo) {
      console.log('Demo mode: driving a paced simulated loop so the dashboard visibly moves…');
      controller
        .start({ rotations: opts.rotations || 3, delayMs: opts.delayMs || 850 })
        .then(() => console.log('Demo loop finished — dashboard shows the final state.'))
        .catch((error) => console.error('Demo loop error:', error.message));
    }
  });

  return server;
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* opening is best-effort */
  }
}

// True when an Origin header points at our own loopback server (the dashboard itself).
// Used to reject forged cross-site requests to the mutating /api endpoints.
function isLocalOrigin(origin) {
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

module.exports = { serve };
