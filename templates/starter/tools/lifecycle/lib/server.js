'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { deriveState } = require('./state');
const { emit } = require('./bus');
const { render } = require('./dashboard');
const { Controller } = require('./control');
const { listPlans, plansDir } = require('./plans');

const CLIENT = path.join(__dirname, '..', 'assets', 'dashboard.html');
const GUIDE = path.join(__dirname, '..', 'assets', 'user-guide.html');

// A tiny zero-dependency live dashboard server. The client polls /api/state and
// re-renders, and POSTs to /api/action and /api/emit to control the loop. Works
// over http:// — no browser file:// fetch restrictions.
function serve(root, opts = {}) {
  const port = opts.port != null ? opts.port : 4321;
  const controller = new Controller(root, { simulate: opts.simulate !== false });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url.startsWith('/api/emit')) {
        const body = await readBody(req);
        emit(root, {
          rotation: body.rotation,
          stage: body.stage,
          agent: body.agent || 'external',
          level: body.level || 'info',
          message: body.message || '',
          data: body.data,
        });
        render(root);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/action')) {
        return json(res, 200, await controller.action(await readBody(req)));
      }
      if (req.url.startsWith('/api/state')) {
        return json(res, 200, Object.assign(deriveState(root), { control: controller.status() }));
      }
      if (req.url.startsWith('/api/plans')) {
        return json(res, 200, { plans: listPlans(root) });
      }
      if (req.url.startsWith('/api/stories')) {
        const { readStories } = require('./stories');
        return json(res, 200, readStories(root) || { stories: [], grounded: false, status: 'draft' });
      }
      // The readable user-stories view, opened from the dashboard.
      if (req.url.startsWith('/stories')) {
        const { storiesHtmlPath } = require('./stories');
        const p = storiesHtmlPath(root);
        if (fs.existsSync(p)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(p, 'utf8'));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('No stories yet — run: powercodex import --analyze');
        return;
      }
      // The user guide — a self-contained help page, opened from the dashboard.
      if (req.url.startsWith('/guide') || req.url.startsWith('/user-guide')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(GUIDE, 'utf8'));
        return;
      }
      // Serve generated HTML plans (the plan viewer). Path-traversal guarded:
      // only files inside .powercodex/plans/ are served.
      if (/\.powercodex\/plans\//.test(req.url) && req.url.endsWith('.html')) {
        const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
        const abs = path.resolve(root, rel);
        if (abs.startsWith(path.resolve(plansDir(root))) && fs.existsSync(abs)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(abs, 'utf8'));
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
