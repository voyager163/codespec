'use strict';
// The comprehensive plan-document generator. This is what turns a maker's approved
// plan into the rich, illustrated HTML the Canvas shows — and saves it into the repo
// so the agent can re-open it, diff it, and learn from how past plans turned out.
//
// Two artifacts per plan, side by side under .powercodex/plans/:
//   • plan-N.html  — the human view (summary, remarks, capability table, Now→After,
//                    build steps, task list, and an outcome log filled in after build).
//   • plan-N.json  — the structured record the agent reads to learn (goal, capabilities,
//                    tasks, the real build outcome). Everything needed to re-render too.
//
// Deterministic-first: it never needs an AI or a browser to produce a complete plan.
// The "Now vs After" picture is an always-on mockup rendered from the same sample-data
// shape codegen.js uses, so the preview matches the code that actually gets generated.
// Real screenshots replace the mockup opportunistically (see foldOutcome → shots).
const fs = require('node:fs');
const path = require('node:path');
const { planTasks, parseCapabilities, nameFrom } = require('./planner');
const plansReg = require('./plans');

// Sample rows mirror codegen.js's SAMPLE so the mockup looks like the generated screen.
const SAMPLE = [
  { title: 'First item', owner: 'you', due: '2026-06-01', status: 'Open' },
  { title: 'Second item', owner: 'alex', due: '2026-06-10', status: 'Open' },
  { title: 'Third item', owner: 'you', due: '2026-05-20', status: 'Done' },
  { title: 'Fourth item', owner: 'you', due: '2026-07-02', status: 'Open' },
  { title: 'Fifth item', owner: 'sam', due: '2026-06-18', status: 'Open' },
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
function stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/[<>]/g, '');
}

// Plain-English label + behaviour note for each capability flag — the "remarks" that
// make the plan readable. Order is stable so the same request reads back the same way.
const CAP_LABELS = [
  ['filterByUser', 'Only your items', 'Filters the list to the signed-in user, so people see just their own work.'],
  ['sort', 'Most important first', 'Sorts by due date so the soonest / most urgent rises to the top.'],
  ['highlight', 'Attention in red', 'Overdue or at-risk rows turn red so nothing important slips by.'],
  ['search', 'Search box', 'A search field at the top filters the list as you type.'],
  ['rowAction', 'Quick action per row', 'A one-tap status / action button on each row (e.g. Mark done).'],
];

// Build the structured plan record from a goal + approved plan. Pure — no disk writes.
function buildRecord({ id, goal, plan, provider, digest, history } = {}) {
  const items = (plan && Array.isArray(plan.items) ? plan.items : []).map((s) => stripTags(String(s)));
  const cleanTitle = String((plan && plan.title) || goal || 'Your screen').replace(/^Plan:\s*/i, '');
  const capabilities = parseCapabilities(goal, items);
  const { componentName, route, kebab } = nameFrom(cleanTitle || goal);
  const planned = planTasks({ goal, plan: { title: cleanTitle, items }, digest });

  // "Now" — does a screen already live at this route / under this name?
  const routes = (digest && Array.isArray(digest.routes) ? digest.routes : []).map((r) => r.path);
  const comps = (digest && Array.isArray(digest.components) ? digest.components : []).map((c) => c.name);
  const exists = routes.includes(route) || comps.includes(componentName);

  return {
    id: id || null,
    title: cleanTitle,
    goal: oneLine(goal),
    provider: provider || 'unknown',
    createdAt: new Date().toISOString(),
    items,
    capabilities,
    screen: { componentName, route, kebab },
    tasks: planned.tasks.map((t) => ({ type: t.type, name: t.name, route: t.route || null, displayName: t.displayName || t.name })),
    now: { exists, route },
    visuals: 'mockup',
    shots: { now: null, after: null },
    history: Array.isArray(history) ? history : [],
    outcome: null,
  };
}

// ---- mockup rendering (Tier 1, always on) -------------------------------------

function activeRows(cap) {
  const today = '2026-06-08';
  let rows = SAMPLE.map((r) => ({ ...r, overdue: r.status !== 'Done' && r.due < today }));
  if (cap.filterByUser) rows = rows.filter((r) => r.owner === 'you');
  if (cap.sort) rows = [...rows].sort((a, b) => a.due.localeCompare(b.due));
  return rows.slice(0, 4);
}

function afterMockup(rec) {
  const cap = rec.capabilities;
  const rows = activeRows(cap);
  const search = cap.search
    ? '<div style="margin:8px 0 10px"><div class="mk-search">🔍 Search…</div></div>'
    : '';
  const head =
    '<tr><th>Title</th><th>Owner</th><th>Due</th><th>Status</th>' + (cap.rowAction ? '<th></th>' : '') + '</tr>';
  const body = rows
    .map((r) => {
      const dueCls = cap.highlight && r.overdue ? ' class="red"' : '';
      const action = cap.rowAction ? `<td><span class="mk-btn">${r.status === 'Done' ? 'Reopen' : 'Mark done'}</span></td>` : '';
      return `<tr><td>${esc(r.title)}</td><td>${esc(r.owner)}</td><td${dueCls}>${esc(r.due.slice(5))}</td><td>${esc(r.status)}</td>${action}</tr>`;
    })
    .join('');
  return (
    `<div class="mk-eb">● Proposed screen</div><div class="mk-h">${esc(rec.title)}</div>` +
    `<div class="mk-sub">${esc(rec.goal || 'Your screen')}</div>${search}` +
    `<table class="mk-tbl">${head}${body}</table>` +
    (cap.filterByUser ? '<div class="mk-note">Showing only your items</div>' : '')
  );
}

function nowMockup(rec) {
  if (rec.now && rec.now.exists) {
    return (
      `<div class="mk-eb dim">● Current screen</div><div class="mk-h dim">${esc(rec.title)}</div>` +
      `<div class="mk-sub">An earlier version already lives at <code>${esc(rec.now.route)}</code>. This plan extends it.</div>` +
      '<div class="mk-empty">existing screen — will be carried forward and improved</div>'
    );
  }
  return (
    '<div class="mk-eb dim">● Today</div><div class="mk-h dim">Nothing here yet</div>' +
    `<div class="mk-sub">There is no screen at <code>${esc(rec.now ? rec.now.route : '/')}</code> yet — this plan creates it.</div>` +
    '<div class="mk-empty">＋ blank — no screen yet</div>'
  );
}

// Embed a real screenshot when one was captured; otherwise the deterministic mockup.
function shotOrMockup(rec, which, mockupHtml) {
  const shot = rec.shots && rec.shots[which];
  if (shot) return `<img class="mk-shot" src="${esc(shot)}" alt="${which} screenshot" />`;
  return `<div class="mk-screen">${mockupHtml}</div>`;
}

// ---- outcome section ----------------------------------------------------------

function outcomeSection(rec) {
  const o = rec.outcome;
  if (!o) {
    return '<div class="callout">The build hasn’t run yet. Once it does, this section fills in with what was actually created, whether it compiled, and any issues found — so the next plan can learn from it.</div>';
  }
  const builtRows = (o.built || [])
    .map(
      (b) =>
        `<tr><td><b>${esc(b.name)}</b></td><td><code>${esc(b.file || '—')}</code></td>` +
        `<td>${b.created ? '<span class="pill good">created</span>' : '<span class="pill bad">not created</span>'}</td>` +
        `<td>${b.wired ? '<span class="pill acc">routed</span>' : '<span class="pill warn">not routed</span>'}</td>` +
        `<td>${esc(b.source || '—')}</td></tr>`,
    )
    .join('');
  const verdict = o.verified
    ? '<span class="pill good">build passed</span>'
    : o.ran === false
      ? '<span class="pill warn">not verified</span>'
      : '<span class="pill bad">build failed</span>';
  const errs = (o.errors || []).length
    ? `<div class="mk-lbl" style="margin-top:14px">Issues found</div><ul class="clean">${o.errors
        .slice(0, 8)
        .map((e) => `<li>${esc(e)}</li>`)
        .join('')}</ul>`
    : '';
  const table = builtRows
    ? `<table class="mk-tbl wide"><tr><th>Screen</th><th>File</th><th>Created</th><th>Routed</th><th>Author</th></tr>${builtRows}</table>`
    : '';
  return (
    `<div style="margin-bottom:10px">${verdict} <span class="dim">verified ${esc((o.finishedAt || '').slice(0, 19).replace('T', ' '))}` +
    `${o.coverage != null ? ' · coverage ' + esc(String(o.coverage)) + '%' : ''}</span></div>${table}${errs}`
  );
}

// ---- the HTML document --------------------------------------------------------

function renderPlanHtml(rec) {
  const capRows = CAP_LABELS.filter(([k]) => rec.capabilities[k])
    .map(([, label, note]) => `<tr><td><b>${esc(label)}</b></td><td>${esc(note)}</td></tr>`)
    .join('');
  const itemList = rec.items.map((i) => `<li>${esc(i)}</li>`).join('');
  const taskRows = rec.tasks
    .map(
      (t) =>
        `<tr><td><span class="pill ${t.type.startsWith('code.') ? 'acc' : 'pur'}">${esc(t.type)}</span></td>` +
        `<td><b>${esc(t.displayName)}</b></td><td><code>${esc(t.type.startsWith('code.') ? 'src/pages/' + t.name + '.tsx' : t.name)}</code></td></tr>`,
    )
    .join('');
  const histRows = (rec.history || [])
    .slice(-4)
    .reverse()
    .map(
      (h) =>
        `<tr><td>${esc(h.id || '')}</td><td>${esc(h.title || '')}</td><td>${
          h.verified == null ? '<span class="pill warn">unknown</span>' : h.verified ? '<span class="pill good">passed</span>' : '<span class="pill bad">failed</span>'
        }</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(rec.title)} · plan ${esc(rec.id || '')}</title>
<style>
  :root{--bg:#0b0d12;--soft:#12151d;--panel:#161a24;--panel2:#1c2130;--line:#262c3a;--line2:#313a4d;
    --text:#e8ecf4;--muted:#99a2b8;--faint:#6b7488;--accent:#6ea8fe;--accent2:#a78bfa;--good:#5ad19a;--bad:#f08a8a;--warn:#f5c97b;}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(900px 460px at 80% -12%,rgba(167,139,250,.16),transparent 60%),var(--bg);
    color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;line-height:1.6}
  .wrap{max-width:860px;margin:0 auto;padding:30px 22px 80px}
  code{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.86em;background:var(--panel2);border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:#cdd6ea}
  .eb{display:inline-flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:rgba(110,168,254,.1);border:1px solid rgba(110,168,254,.25);padding:5px 12px;border-radius:999px}
  h1{font-size:30px;line-height:1.1;margin:14px 0 8px;letter-spacing:-.02em}
  .lead{color:var(--muted);font-size:15px;max-width:680px;margin:0}
  .meta{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;color:var(--faint);font-size:12px}
  .meta span{border:1px solid var(--line);border-radius:999px;padding:4px 11px}
  h2{font-size:18px;margin:38px 0 4px;letter-spacing:-.01em}
  .kick{color:var(--accent2);font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:34px 0 0}
  .panel{background:linear-gradient(180deg,var(--panel),var(--soft));border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:10px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--muted)}
  th{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  td b{color:var(--text)}
  ul.clean{list-style:none;padding:0;margin:10px 0 0}
  ul.clean li{position:relative;padding-left:22px;margin:7px 0;color:var(--muted);font-size:13.5px}
  ul.clean li::before{content:"→";position:absolute;left:0;color:var(--accent)}
  .pill{display:inline-block;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .pill.good{color:var(--good);border-color:rgba(90,209,154,.35);background:rgba(90,209,154,.08)}
  .pill.bad{color:var(--bad);border-color:rgba(240,138,138,.35);background:rgba(240,138,138,.08)}
  .pill.warn{color:var(--warn);border-color:rgba(245,201,123,.35);background:rgba(245,201,123,.08)}
  .pill.acc{color:var(--accent);border-color:rgba(110,168,254,.35);background:rgba(110,168,254,.08)}
  .pill.pur{color:var(--accent2);border-color:rgba(167,139,250,.35);background:rgba(167,139,250,.08)}
  .callout{border-left:3px solid var(--accent);background:rgba(110,168,254,.06);padding:12px 14px;border-radius:0 9px 9px 0;color:var(--muted);font-size:13.5px;margin-top:12px}
  .dim{color:var(--faint)}
  .ba{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}
  @media(max-width:680px){.ba{grid-template-columns:1fr}}
  .col .cap{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--faint);margin-bottom:8px}
  .badge{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#0b0d12;border-radius:5px;padding:2px 8px}
  .badge.now{background:var(--warn)}.badge.after{background:var(--good)}
  .mk-screen{border:1px solid var(--line2);border-radius:11px;background:var(--panel);padding:14px;min-height:210px}
  .mk-shot{width:100%;border:1px solid var(--line2);border-radius:11px;display:block}
  .mk-eb{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid rgba(110,168,254,.3);border-radius:999px;padding:2px 9px;display:inline-block}
  .mk-eb.dim{color:var(--faint);border-color:var(--line)}
  .mk-h{font-size:16px;font-weight:800;margin:8px 0 3px}.mk-h.dim{color:var(--faint)}
  .mk-sub{color:var(--faint);font-size:11px;margin-bottom:8px}
  .mk-search{font-size:11px;color:var(--faint);border:1px solid var(--line);border-radius:7px;padding:6px 9px;background:var(--panel2)}
  .mk-tbl{width:100%;border-collapse:collapse;font-size:11px;margin-top:2px}
  .mk-tbl th{font-size:8.5px;color:var(--faint);text-transform:uppercase;padding:4px 6px;border-bottom:1px solid var(--line)}
  .mk-tbl td{padding:5px 6px;border-bottom:1px solid var(--line);color:var(--muted)}
  .mk-tbl td.red{color:var(--bad);font-weight:600}
  .mk-tbl.wide{font-size:12.5px}.mk-tbl.wide td,.mk-tbl.wide th{padding:8px 10px}
  .mk-btn{font-size:9px;border:1px solid var(--line2);border-radius:5px;padding:2px 7px;color:var(--accent)}
  .mk-note{font-size:9.5px;color:var(--accent2);margin-top:7px}
  .mk-empty{margin-top:14px;border:1px dashed var(--line2);border-radius:9px;padding:18px;text-align:center;color:var(--faint);font-size:11px}
  .mk-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent2);font-weight:700}
  .foot{margin-top:54px;border-top:1px solid var(--line);padding-top:18px;color:var(--faint);font-size:12px;text-align:center}
</style></head>
<body><div class="wrap">

  <span class="eb">● Proposed change · ${esc(rec.id || 'draft')}</span>
  <h1>${esc(rec.title)}</h1>
  <p class="lead">${esc(rec.goal || 'A new screen for your app.')} Here’s what I’ll build, test, and self-heal until it’s clean.</p>
  <div class="meta">
    <span>Author: ${esc(rec.provider)}</span>
    <span>Screen: <code>${esc(rec.screen.componentName)}</code></span>
    <span>Route: <code>${esc(rec.screen.route)}</code></span>
    <span>Visuals: ${esc(rec.visuals)}</span>
  </div>

  <p class="kick">Summary &amp; remarks</p>
  <h2>What you asked for</h2>
  <div class="panel"><ul class="clean">${itemList || '<li>Build the main screen for what you described.</li>'}</ul></div>

  <p class="kick">Capability breakdown</p>
  <h2>How each piece shows up on screen</h2>
  <div class="panel"><table><tr><th>Capability</th><th>What it does</th></tr>${
    capRows || '<tr><td><b>Main screen</b></td><td>A clean list view of your records to start from.</td></tr>'
  }</table></div>

  <p class="kick">Now vs After</p>
  <h2>Before this change, and after</h2>
  <div class="ba">
    <div class="col"><div class="cap"><span class="badge now">Now</span> current app</div>${shotOrMockup(rec, 'now', nowMockup(rec))}</div>
    <div class="col"><div class="cap"><span class="badge after">After</span> proposed</div>${shotOrMockup(rec, 'after', afterMockup(rec))}</div>
  </div>

  <p class="kick">Build · test · self-heal</p>
  <h2>How it gets made</h2>
  <div class="panel"><ul class="clean">
    <li><b>Author the screen</b> in real React + TypeScript against sample data.</li>
    <li><b>Wire it into your app’s routes</b> at <code>${esc(rec.screen.route)}</code>.</li>
    <li><b>Verify by compiling</b> your whole app — a real pass/fail gate, no tenant needed.</li>
    <li><b>Self-heal</b> — if it doesn’t compile, revert to a known-good version and re-check.</li>
  </ul></div>

  <p class="kick">Task list</p>
  <h2>The concrete files</h2>
  <div class="panel"><table><tr><th>Kind</th><th>What</th><th>Where</th></tr>${taskRows}</table></div>

  <p class="kick">Outcome log</p>
  <h2>What actually happened</h2>
  <div class="panel">${outcomeSection(rec)}</div>
${
  histRows
    ? `
  <p class="kick">Learned from past plans</p>
  <h2>Recent plans &amp; how they turned out</h2>
  <div class="panel"><table><tr><th>Plan</th><th>Title</th><th>Build</th></tr>${histRows}</table></div>`
    : ''
}
  <div class="foot">PowerCodex · ${esc(rec.id || '')} · generated ${esc(rec.createdAt.slice(0, 19).replace('T', ' '))}</div>
</div></body></html>
`;
}

function renderPlanJson(rec) {
  return JSON.stringify(rec, null, 2) + '\n';
}

// ---- disk orchestration -------------------------------------------------------

// Author a plan to disk and register it. Returns the registry entry (with id, file,
// jsonFile). Called the moment Chat produces a plan, before any build.
function authorPlan(root, { goal, plan, provider } = {}) {
  plansReg.ensurePlans(root);
  const dir = plansReg.plansDir(root);
  // Pre-compute the id the registry will assign so file names line up.
  const reg = plansReg.readRegistry(root);
  const id = `P${String(reg.plans.length + 1).padStart(3, '0')}`;
  const n = reg.plans.length + 1;

  let digest = null;
  try {
    digest = require('./digest').readDigest(root);
  } catch {
    digest = null;
  }
  const history = (reg.plans || []).slice(-4).map((p) => ({ id: p.id, title: p.title, verified: p.outcome ? p.outcome.verified : null }));

  const rec = buildRecord({ id, goal, plan, provider, digest, history });
  const htmlRel = `.powercodex/plans/plan-${n}.html`;
  const jsonRel = `.powercodex/plans/plan-${n}.json`;
  fs.writeFileSync(path.join(dir, `plan-${n}.html`), renderPlanHtml(rec));
  fs.writeFileSync(path.join(dir, `plan-${n}.json`), renderPlanJson(rec));

  return plansReg.registerPlan(root, {
    title: rec.title,
    file: htmlRel,
    jsonFile: jsonRel,
    provider: rec.provider,
    sections: 7,
    mockups: 2,
    tasks: rec.tasks.length,
    visuals: rec.visuals,
  });
}

// Fold the real build outcome back into a plan: update its JSON record, re-render its
// HTML (so the outcome log fills in), and stamp the registry. Best-effort by id.
function foldOutcome(root, id, outcome) {
  if (!id) return null;
  const entry = plansReg.listPlans(root).find((p) => p.id === id);
  if (!entry || !entry.jsonFile) return null;
  const jsonAbs = path.join(root, entry.jsonFile);
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(jsonAbs, 'utf8'));
  } catch {
    return null;
  }
  rec.outcome = outcome || rec.outcome;
  if (outcome && outcome.shots) rec.shots = Object.assign(rec.shots || {}, outcome.shots);
  if (rec.shots && (rec.shots.now || rec.shots.after)) rec.visuals = 'screenshot';
  try {
    fs.writeFileSync(jsonAbs, renderPlanJson(rec));
    fs.writeFileSync(path.join(root, entry.file), renderPlanHtml(rec));
  } catch {
    /* a re-render hiccup must never break the loop */
  }
  return plansReg.updatePlanOutcome(root, id, rec.outcome);
}

module.exports = { authorPlan, foldOutcome, buildRecord, renderPlanHtml, renderPlanJson };
