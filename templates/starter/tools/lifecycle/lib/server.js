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
const browse = require('./browse');
const { importInto } = require('./import');
const { scaffold, installDeps, isScaffolded } = require('./scaffold');

const CLIENT = path.join(__dirname, '..', 'assets', 'dashboard.html');
const GUIDE = path.join(__dirname, '..', 'assets', 'user-guide.html');
const CHAT = path.join(__dirname, '..', 'assets', 'chat.html');

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
    return { name, root: activeRoot, mode };
  }

  const server = http.createServer(async (req, res) => {
    try {
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
        const out = await chat.respond(activeRoot, { message: body.message || '', history: body.history || [], providerId: body.provider });
        if (out && out.plan) {
          try {
            const entry = require('./planhtml').authorPlan(activeRoot, { goal: body.message || '', plan: out.plan, provider: out.provider });
            out.planFile = entry.file;
            out.planId = entry.id;
          } catch (e) {
            // Leave the reply intact; the Canvas falls back to its inline skeleton.
            out.planError = e.message;
          }
        }
        return json(res, 200, out);
      }
      if (req.method === 'POST' && req.url.startsWith('/api/action')) {
        const body = await readBody(req);
        // open-project re-points the live root; create-project scaffolds a fresh code
        // app into the active workspace; everything else is loop control.
        if (body.type === 'open-project') return json(res, 200, openProject(body.path));
        if (body.type === 'create-project') return json(res, 200, createProject(body));
        return json(res, 200, await controller.action(body));
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
      if (/\.powercodex\/plans\//.test(req.url) && /\.(html|json|png)$/.test(req.url.split('?')[0])) {
        const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
        const abs = path.resolve(activeRoot, rel);
        if (abs.startsWith(path.resolve(plansDir(activeRoot))) && fs.existsSync(abs)) {
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

  server.listen(port, () => {
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
