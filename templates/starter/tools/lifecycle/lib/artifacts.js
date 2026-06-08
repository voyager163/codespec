'use strict';
// The artifact system — the canvas's universal content layer. The plan-document
// generator (planhtml.js) proved the pattern: produce a rich, self-contained HTML file,
// save it into the repo, register it, and let the canvas render it by URL. Artifacts
// generalise that to ANY deliverable PowerCodex makes: an architecture overview, a
// Power BI dashboard mockup, a written document, a diagram — or a free-form HTML page
// the agent authored itself.
//
//   .powercodex/artifacts/
//     index.json            — the registry (id, kind, title, file, createdAt)
//     A001-architecture.html
//     A002-powerbi.html      ...
//
// Deterministic-first: every renderer produces a complete artifact with no AI and no
// network. A provider can pass richer structured `data`; absent that, sensible synth
// builders fill in from the goal and the repo digest, so the canvas always has something
// real to show.
const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['architecture', 'powerbi-dashboard', 'document', 'diagram', 'page'];

function artifactsDir(root) {
  return path.join(root, '.powercodex', 'artifacts');
}
function registryFile(root) {
  return path.join(artifactsDir(root), 'index.json');
}
function ensure(root) {
  const dir = artifactsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = registryFile(root);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ artifacts: [] }, null, 2) + '\n');
  return file;
}
function readRegistry(root) {
  try {
    const data = JSON.parse(fs.readFileSync(registryFile(root), 'utf8'));
    return data && Array.isArray(data.artifacts) ? data : { artifacts: [] };
  } catch {
    return { artifacts: [] };
  }
}
function list(root) {
  return readRegistry(root).artifacts;
}
function latest(root) {
  const a = list(root);
  return a.length ? a[a.length - 1] : null;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- shared HTML shell (matches the PowerCodex dark theme) ---------------------
function shell({ id, kind, title, subtitle, body }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} · ${esc(id || '')}</title>
<style>
  :root{--bg:#0b0d12;--soft:#12151d;--panel:#161a24;--panel2:#1c2130;--line:#262c3a;--line2:#313a4d;
    --text:#e8ecf4;--muted:#99a2b8;--faint:#6b7488;--accent:#6ea8fe;--accent2:#a78bfa;--good:#5ad19a;--bad:#f08a8a;--warn:#f5c97b;--cyan:#67e8f9;}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(900px 460px at 80% -12%,rgba(167,139,250,.16),transparent 60%),var(--bg);
    color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;line-height:1.6}
  .wrap{max-width:880px;margin:0 auto;padding:30px 22px 80px}
  code{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.86em;background:var(--panel2);border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:#cdd6ea}
  .eb{display:inline-flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:rgba(110,168,254,.1);border:1px solid rgba(110,168,254,.25);padding:5px 12px;border-radius:999px}
  h1{font-size:30px;line-height:1.12;margin:14px 0 8px;letter-spacing:-.02em}
  .lead{color:var(--muted);font-size:15px;max-width:700px;margin:0}
  .kick{color:var(--accent2);font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:34px 0 0}
  h2{font-size:18px;margin:8px 0 4px;letter-spacing:-.01em}
  h3{font-size:15px;margin:16px 0 4px}
  .panel{background:linear-gradient(180deg,var(--panel),var(--soft));border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:10px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--muted)}
  th{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  td b{color:var(--text)}
  ul.clean{list-style:none;padding:0;margin:10px 0 0}
  ul.clean li{position:relative;padding-left:22px;margin:7px 0;color:var(--muted);font-size:13.5px}
  ul.clean li::before{content:"→";position:absolute;left:0;color:var(--accent)}
  ul.clean li b{color:var(--text)}
  .pill{display:inline-block;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .pill.acc{color:var(--accent);border-color:rgba(110,168,254,.35);background:rgba(110,168,254,.08)}
  .pill.pur{color:var(--accent2);border-color:rgba(167,139,250,.35);background:rgba(167,139,250,.08)}
  .pill.good{color:var(--good);border-color:rgba(90,209,154,.35);background:rgba(90,209,154,.08)}
  .callout{border-left:3px solid var(--accent);background:rgba(110,168,254,.06);padding:12px 14px;border-radius:0 9px 9px 0;color:var(--muted);font-size:13.5px;margin-top:12px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px}
  @media(max-width:680px){.grid{grid-template-columns:1fr}}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px}
  @media(max-width:680px){.kpis{grid-template-columns:repeat(2,1fr)}}
  .kpi{border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:14px}
  .kpi .v{font-size:24px;font-weight:800;color:var(--text)}
  .kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-top:3px}
  .kpi .h{font-size:11px;color:var(--accent);margin-top:6px}
  .viz{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:14px;min-height:120px}
  .viz .vt{font-size:13px;font-weight:700}
  .viz .vk{font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em}
  .bars{display:flex;align-items:flex-end;gap:8px;height:80px;margin-top:12px}
  .bars i{flex:1;background:linear-gradient(180deg,var(--accent),var(--accent2));border-radius:5px 5px 0 0;display:block;opacity:.85}
  .flow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
  .flow .node{border:1px solid var(--line2);border-radius:9px;background:var(--panel2);padding:8px 12px;font-size:12.5px;color:var(--text)}
  .flow .to{color:var(--accent);font-weight:800}
  pre.ascii{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#cdd6ea;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;line-height:1.5}
  p{color:var(--muted);font-size:14px}
  .meta{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;color:var(--faint);font-size:12px}
  .meta span{border:1px solid var(--line);border-radius:999px;padding:4px 11px}
  .foot{margin-top:54px;border-top:1px solid var(--line);padding-top:18px;color:var(--faint);font-size:12px;text-align:center}
</style></head>
<body><div class="wrap">
  <span class="eb">● ${esc(kind)} · ${esc(id || 'draft')}</span>
  <h1>${esc(title)}</h1>
  <p class="lead">${esc(subtitle || '')}</p>
  ${body}
  <div class="foot">PowerCodex · ${esc(id || '')} · generated ${esc(new Date().toISOString().slice(0, 19).replace('T', ' '))}</div>
</div></body></html>
`;
}

// ---- per-kind body renderers ---------------------------------------------------

function archBody(data) {
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const routes = Array.isArray(data.routes) ? data.routes : [];
  const comps = Array.isArray(data.components) ? data.components : [];
  const flow = Array.isArray(data.dataFlow) ? data.dataFlow : [];
  const deploy = Array.isArray(data.deploy) ? data.deploy : [];
  const layerCards = layers
    .map((l) => `<div class="viz"><div class="vk">layer</div><div class="vt">${esc(l.name)}</div><ul class="clean">${(l.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`)
    .join('');
  const flowHtml = flow.length
    ? `<div class="flow">${flow.map((n, i) => `${i ? '<span class="to">→</span>' : ''}<span class="node">${esc(n)}</span>`).join('')}</div>`
    : '';
  return (
    (data.summary ? `<p class="kick">Summary</p><div class="panel"><p style="margin:0">${esc(data.summary)}</p></div>` : '') +
    (layerCards ? `<p class="kick">Layers</p><div class="grid">${layerCards}</div>` : '') +
    (flowHtml ? `<p class="kick">Data flow</p>${flowHtml}` : '') +
    (routes.length ? `<p class="kick">Routes</p><div class="panel"><table><tr><th>Path</th><th>Screen</th></tr>${routes.map((r) => `<tr><td><code>${esc(r.path || r)}</code></td><td>${esc(r.name || '')}</td></tr>`).join('')}</table></div>` : '') +
    (comps.length ? `<p class="kick">Components</p><div class="panel">${comps.map((c) => `<span class="pill acc" style="margin:3px">${esc(c.name || c)}</span>`).join('')}</div>` : '') +
    (deploy.length ? `<p class="kick">Build &amp; deploy</p><div class="panel"><ul class="clean">${deploy.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>` : '')
  );
}

function powerbiBody(data) {
  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  const visuals = Array.isArray(data.visuals) ? data.visuals : [];
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const kpiHtml = kpis.length
    ? `<div class="kpis">${kpis.map((k) => `<div class="kpi"><div class="v">${esc(k.value)}</div><div class="l">${esc(k.label)}</div>${k.hint ? `<div class="h">${esc(k.hint)}</div>` : ''}</div>`).join('')}</div>`
    : '';
  const vizHtml = visuals.length
    ? `<div class="grid">${visuals
        .map(
          (v) =>
            `<div class="viz"><div class="vk">${esc(v.type || 'visual')}</div><div class="vt">${esc(v.title)}</div>` +
            `<div class="bars">${Array.from({ length: 6 }, (_, i) => `<i style="height:${30 + ((i * 37 + (v.title || '').length * 11) % 60)}%"></i>`).join('')}</div>` +
            (v.desc ? `<p style="font-size:12px;margin:10px 0 0">${esc(v.desc)}</p>` : '') +
            `</div>`,
        )
        .join('')}</div>`
    : '';
  return (
    (data.summary ? `<p class="kick">Overview</p><div class="panel"><p style="margin:0">${esc(data.summary)}</p></div>` : '') +
    (kpiHtml ? `<p class="kick">Key metrics</p>${kpiHtml}` : '') +
    (vizHtml ? `<p class="kick">Visuals</p>${vizHtml}` : '') +
    (pages.length ? `<p class="kick">Report pages</p><div class="panel"><ul class="clean">${pages.map((p) => `<li><b>${esc(p.title || p)}</b>${p.desc ? ' — ' + esc(p.desc) : ''}</li>`).join('')}</ul></div>` : '') +
    `<div class="callout">This is a deterministic mockup of the dashboard. Connect the Power BI MCP (in your workspace’s <code>.vscode/mcp.json</code>) and PowerCodex can drive a live dataset instead.</div>`
  );
}

// Tiny, safe markdown-ish renderer for documents: #/##/### headings, - bullets,
// **bold**, `code`, and paragraphs. Everything is escaped first.
function mdToHtml(md) {
  const lines = String(md || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      if (inList) { html += '</ul>'; inList = false; }
      const tag = m[1].length === 1 ? 'h2' : m[1].length === 2 ? 'h3' : 'h3';
      html += `<${tag}>${inline(m[2])}</${tag}>`;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul class="clean">'; inList = true; }
      html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`;
      continue;
    }
    if (!line.trim()) { if (inList) { html += '</ul>'; inList = false; } continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function documentBody(data) {
  if (data.markdown || data.body) return `<div class="panel">${mdToHtml(data.markdown || data.body)}</div>`;
  const sections = Array.isArray(data.sections) ? data.sections : [];
  return sections.map((s) => `<p class="kick">${esc(s.kick || '')}</p><h2>${esc(s.heading || '')}</h2><div class="panel">${mdToHtml(s.body || '')}</div>`).join('');
}

function diagramBody(data) {
  if (data.ascii) return `<pre class="ascii">${esc(data.ascii)}</pre>`;
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  return `<div class="flow">${nodes.map((n, i) => `${i ? '<span class="to">→</span>' : ''}<span class="node">${esc(n)}</span>`).join('')}</div>`;
}

function renderBody(kind, data) {
  switch (kind) {
    case 'architecture':
      return archBody(data || {});
    case 'powerbi-dashboard':
      return powerbiBody(data || {});
    case 'diagram':
      return diagramBody(data || {});
    case 'document':
    default:
      return documentBody(data || {});
  }
}

// ---- deterministic synthesisers (offline-safe) ---------------------------------

// Build an architecture overview from the repo digest when one is present, else a
// generic-but-honest description. This is what the "architecture overview" ask renders.
function synthArchitecture(root, { goal } = {}) {
  let digest = null;
  try {
    digest = require('./digest').readDigest(root);
  } catch {
    digest = null;
  }
  const routes = digest && Array.isArray(digest.routes) ? digest.routes.map((r) => ({ path: r.path, name: r.component || r.name || '' })) : [];
  const components = digest && Array.isArray(digest.components) ? digest.components.map((c) => ({ name: c.name })) : [];
  const summary = digest
    ? `This project has ${routes.length} route(s) and ${components.length} component(s). PowerCodex authors real React + TypeScript screens, verifies them by compiling the app, and (when permitted) publishes via the Power Platform.`
    : `An overview of how a PowerCodex code app fits together: screens are authored as real React + TypeScript, verified by a real build, and deployed through the Power Platform when you allow it.`;
  return {
    summary,
    layers: [
      { name: 'Surface', items: ['Chat & Agent UI (the maker window)', 'Live dashboard + plan canvas'] },
      { name: 'Engine', items: ['Intent router & memory', 'Code generation', 'Build-verify & self-heal'] },
      { name: 'Targets', items: ['Local code app (React/TS)', 'Power Platform tenant (gated)', 'Browser automation (Edge/Playwright)'] },
    ],
    dataFlow: ['Maker', 'Intent router', 'Plan / Agent', 'Engine', 'Build verify', 'Deploy (gated)'],
    routes,
    components,
    deploy: ['Compile the whole app as a real pass/fail gate (no tenant needed)', 'Publish to your environment only when Publish is toggled on'],
  };
}

function synthPowerBI({ goal } = {}) {
  const topic = String(goal || 'your data').replace(/^.*\b(for|of|about|on)\b\s*/i, '').slice(0, 60) || 'your data';
  return {
    summary: `A starter dashboard for ${topic}. Swap the sample figures for a live dataset via the Power BI MCP when it’s configured.`,
    kpis: [
      { label: 'Total', value: '1,248', hint: '▲ 12% vs last period' },
      { label: 'Active', value: '312', hint: '▲ 4%' },
      { label: 'At risk', value: '27', hint: '▼ 3%' },
      { label: 'Completed', value: '909', hint: '▲ 18%' },
    ],
    visuals: [
      { title: 'Trend over time', type: 'line', desc: 'How the headline metric moves across the period.' },
      { title: 'Breakdown by category', type: 'bar', desc: 'Where the volume concentrates.' },
      { title: 'Status distribution', type: 'donut', desc: 'Open vs in-progress vs done.' },
      { title: 'Top contributors', type: 'table', desc: 'The rows driving the totals.' },
    ],
    pages: [
      { title: 'Overview', desc: 'KPIs + trend at a glance' },
      { title: 'Detail', desc: 'Drill-down by category and owner' },
    ],
  };
}

// ---- save + register -----------------------------------------------------------

// Save an artifact to disk and register it. `data` is the structured payload for the
// renderer; `html` (optional) lets the caller pass fully-authored HTML to capture as-is.
// Returns the registry entry { id, kind, title, file, createdAt }.
function save(root, { kind = 'document', title, subtitle, data, html, goal } = {}) {
  ensure(root);
  const reg = readRegistry(root);
  const n = reg.artifacts.length + 1;
  const id = `A${String(n).padStart(3, '0')}`;
  const safeKind = KINDS.includes(kind) ? kind : 'document';

  // Synthesise structured data when none was supplied, so offline still produces something real.
  let payload = data;
  if (!payload && !html) {
    if (safeKind === 'architecture') payload = synthArchitecture(root, { goal });
    else if (safeKind === 'powerbi-dashboard') payload = synthPowerBI({ goal });
    else payload = { summary: subtitle || '', markdown: '' };
  }

  const cleanTitle = String(title || goal || 'Artifact').replace(/^Plan:\s*/i, '').slice(0, 120);
  const sub = subtitle || (goal ? String(goal).slice(0, 200) : '');
  const doc = html
    ? html
    : shell({ id, kind: safeKind, title: cleanTitle, subtitle: sub, body: renderBody(safeKind, payload) });

  const slug = safeKind.replace(/[^a-z0-9]+/gi, '-');
  const fileName = `${id}-${slug}.html`;
  const rel = `.powercodex/artifacts/${fileName}`;
  fs.writeFileSync(path.join(artifactsDir(root), fileName), doc);

  const entry = { id, kind: safeKind, title: cleanTitle, file: rel, provider: 'powercodex', createdAt: new Date().toISOString() };
  reg.artifacts.push(entry);
  fs.writeFileSync(registryFile(root), JSON.stringify(reg, null, 2) + '\n');
  return entry;
}

// Pick the most likely artifact kind from a free-text request. Used by both the chat
// route (to render answers) and the agent (to decide what to produce).
function kindFromMessage(message) {
  const g = String(message || '').toLowerCase();
  if (/\b(power ?bi|pbix|dashboard|kpi|report)\b/.test(g)) return 'powerbi-dashboard';
  if (/\b(architecture|overview of (this|the|my) (app|project|code|codebase|system)|how (it|this|the app|things) (fit|work)s? together|system design|tech stack)\b/.test(g)) return 'architecture';
  if (/\b(diagram|flow ?chart|wireframe|mind ?map|sequence)\b/.test(g)) return 'diagram';
  return 'document';
}

module.exports = { save, list, latest, ensure, artifactsDir, registryFile, readRegistry, KINDS, kindFromMessage, synthArchitecture, synthPowerBI, renderBody, shell };
