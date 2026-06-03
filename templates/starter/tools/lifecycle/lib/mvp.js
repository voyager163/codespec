'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { keywords } = require('./compliance');

// MVP proposer: when no prototype exists, generate an HTML MVP from the goal so
// the user has something concrete to refine. Self-contained, design-eng styled.
function proposeMvp(root, opts = {}) {
  const goal = opts.goal || 'Your app';
  const keys = keywords(goal).slice(0, 8);
  const dir = path.join(root, '.powercodex', 'mvp');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'preview.html');
  fs.writeFileSync(out, html(goal, keys));
  return out;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function html(goal, keys) {
  const features = (keys.length ? keys : ['records', 'status', 'actions']).map(
    (k) => `<li><span class="dot"></span> ${esc(k.charAt(0).toUpperCase() + k.slice(1))}</li>`,
  ).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Proposed MVP</title><style>
:root{--ease:cubic-bezier(.23,1,.32,1);--bg:#0b0d12;--panel:#161a24;--line:#262c3a;--text:#e8ecf4;--muted:#99a2b8;--accent:#6ea8fe;--accent2:#a78bfa;--good:#5ad19a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(900px 480px at 80% -10%,rgba(167,139,250,.14),transparent 60%),var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;line-height:1.55}
.wrap{max-width:920px;margin:0 auto;padding:48px 24px}
.eyebrow{display:inline-block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid rgba(110,168,254,.25);background:rgba(110,168,254,.1);padding:5px 12px;border-radius:999px}
h1{font-size:30px;margin:16px 0 8px;letter-spacing:-.02em}
.goal{color:var(--muted);max-width:680px}
.app{margin-top:26px;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px -20px rgba(0,0,0,.6)}
.bar{display:flex;gap:8px;padding:10px 14px;background:#0e1118;border-bottom:1px solid var(--line)}
.bar i{width:11px;height:11px;border-radius:50%;display:block}.bar .r{background:#f0716f}.bar .y{background:#f5c97b}.bar .g{background:#5ad19a}
.body{display:grid;grid-template-columns:180px 1fr}
.nav{background:#0f1219;border-right:1px solid var(--line);padding:16px 12px}
.nav b{display:flex;align-items:center;gap:9px;font-size:14px;padding:2px 8px 14px}
.nav .mk{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#06203f;font-weight:900}
.nav a{display:block;padding:8px 10px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:13px}
.nav a.on{background:rgba(110,168,254,.12);color:var(--text)}
.main{padding:20px}
.main h2{margin:0 0 14px;font-size:18px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
li{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:11px 13px;color:var(--muted);font-size:14px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--good)}
.note{margin-top:18px;color:var(--muted);font-size:13.5px}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body><div class="wrap">
<span class="eyebrow">Proposed MVP · refine me</span>
<h1>${esc(goal)}</h1>
<p class="goal">A starting point generated from your goal. Keep prompting to refine it until it's right — then it becomes the benchmark the app is built and tested against.</p>
<div class="app"><div class="bar"><i class="r"></i><i class="y"></i><i class="g"></i></div>
<div class="body"><div class="nav"><b><span class="mk">P</span> App</b><a class="on">Home</a><a>Records</a><a>Reports</a></div>
<div class="main"><h2>Key surfaces (from your goal)</h2><ul>${features}</ul>
<p class="note">This is a draft. Tell PowerCodex what to change and it will re-propose until you approve.</p></div></div></div>
</div></body></html>`;
}

module.exports = { proposeMvp };
