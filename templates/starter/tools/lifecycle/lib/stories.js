'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readDigest } = require('./digest');
const freeze = require('./freeze');

// Code-grounded user stories. Derived deterministically from the repo digest so
// every story cites the source file(s) it came from — the user can verify each one
// before freezing. With no digest we generate nothing (we refuse to fabricate
// stories for code we have not read); the MVP keeps its goal-only fallback instead.

function storiesDir(root) {
  return path.join(root, '.powercodex', 'stories');
}
function storiesJson(root) {
  return path.join(storiesDir(root), 'stories.json');
}
function storiesHtmlPath(root) {
  return path.join(storiesDir(root), 'stories.html');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

const MAX_STORIES = 16;

// Turn the digest's surfaces into stories, each citing its source. Bounded so a
// huge repo yields a reviewable list, not hundreds of rows.
function storiesFromDigest(digest) {
  const out = [];
  const push = (s) => {
    if (out.length < MAX_STORIES) out.push(s);
  };

  for (const r of digest.routes || []) {
    const where = r.path === '/' ? 'home screen' : `"${r.path}" screen`;
    push({
      title: `Open the ${where}`,
      asA: 'user',
      iWant: `to navigate to the ${where}`,
      soThat: 'I can reach that part of the app',
      sources: [r.source],
    });
  }

  for (const c of digest.components || []) {
    const kind = /list|table|grid/i.test(c.name) ? 'list' : /form|edit|create|new/i.test(c.name) ? 'form' : 'view';
    push({
      title: `Use the ${c.name} ${kind}`,
      asA: 'user',
      iWant: `to use the ${c.name} ${kind}`,
      soThat: 'I can complete the task it supports',
      sources: [c.source],
    });
  }

  // One consolidated data story, citing the files where data access was found.
  const dataSources = [...new Set((digest.data || []).map((d) => d.source))].slice(0, 6);
  if (dataSources.length) {
    push({
      title: 'View and change app data',
      asA: 'user',
      iWant: 'to read and update the records the app manages',
      soThat: 'my changes are saved and reflected across the app',
      sources: dataSources,
    });
  }

  return out.map((s, i) => Object.assign({ id: `US-${String(i + 1).padStart(3, '0')}`, status: 'draft' }, s));
}

// Build the stories document from a digest. Writes stories.json + a readable
// stories.html. Returns { path, htmlPath, doc }. If no digest exists, the doc is
// written with an empty list and grounded:false — never fabricated stories.
function buildStories(root, opts = {}) {
  const digest = opts.digest || readDigest(root);
  const stories = digest ? storiesFromDigest(digest) : [];
  const doc = {
    status: freeze.statusOf(root, 'stories'),
    goal: opts.goal || null,
    grounded: !!digest,
    source: digest ? '.powercodex/digest.json' : null,
    generatedAt: new Date().toISOString(),
    stories,
  };
  return saveStories(root, doc);
}

// Persist a stories document (used by build + by user edits). Re-renders the HTML.
function saveStories(root, doc) {
  fs.mkdirSync(storiesDir(root), { recursive: true });
  const normalized = Object.assign({ status: 'draft', grounded: false, stories: [] }, doc);
  normalized.status = freeze.statusOf(root, 'stories'); // freeze.json is the source of truth
  const jsonPath = storiesJson(root);
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`);
  const htmlPath = storiesHtmlPath(root);
  fs.writeFileSync(htmlPath, renderHtml(normalized));
  return { path: jsonPath, htmlPath, doc: normalized };
}

function readStories(root) {
  const file = storiesJson(root);
  if (!fs.existsSync(file)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.status = freeze.statusOf(root, 'stories');
    return doc;
  } catch {
    return null;
  }
}

// Refine from the user's edits rather than regenerating from scratch. We compute a
// diff of prior vs edited and (with a real provider) feed it so the AI improves the
// edited version. With the simulated provider this is a deterministic merge: the
// user's edits are authoritative and preserved verbatim. Refusing on a frozen
// artifact keeps the freeze contract intact.
async function refineStories(root, opts = {}) {
  if (freeze.isFrozen(root, 'stories')) {
    return { ok: false, error: 'stories are frozen — unlock for a major change first' };
  }
  const prior = readStories(root) || { stories: [] };
  const edited = opts.edited || prior;
  const diff = diffStories(prior.stories || [], edited.stories || []);

  let refined = edited;
  let aiApplied = false;
  if (opts.provider && typeof opts.provider.send === 'function') {
    // A real provider enriches prose; the user's edits remain the spine. We feed the
    // current stories + the diff and ask for an improved set in the SAME JSON shape,
    // then actually merge the model's output back (the previous version discarded it).
    refined = await aiRefine(opts.provider, edited, diff);
    aiApplied = refined !== edited;
  }
  const saved = saveStories(root, Object.assign({}, prior, refined, { refinedAt: new Date().toISOString() }));
  return { ok: true, diff, aiApplied, doc: saved.doc };
}

// Ask the provider to improve the edited stories, returning a doc in the same shape.
// The user's edits are authoritative: we only let the model rewrite the prose fields
// (title/asA/iWant/soThat) of stories the user kept — ids, sources, and the set of
// stories themselves are preserved verbatim, so a chatty model can never invent,
// drop, or re-source a story. Any parse/shape failure falls back to the edits as-is.
async function aiRefine(provider, edited, diff) {
  const stories = Array.isArray(edited.stories) ? edited.stories : [];
  if (!stories.length) return edited;
  const prompt = [
    'You are refining user stories. Improve ONLY the wording (title, asA, iWant, soThat).',
    'Rules: keep the exact same ids; do not add or remove stories; do not change sources.',
    'Return ONLY a JSON array, each item {"id","title","asA","iWant","soThat"} — no prose, no fences.',
    `Recent edits (for context): ${JSON.stringify(diff)}`,
    `Stories:\n${JSON.stringify(stories.map((s) => ({ id: s.id, title: s.title, asA: s.asA, iWant: s.iWant, soThat: s.soThat })))}`,
  ].join('\n');
  let text = '';
  try {
    const res = await provider.send({ prompt, timeoutMs: 45000 });
    text = (res && res.text) || '';
  } catch {
    return edited;
  }
  const arr = parseStoryArray(text);
  if (!arr) return edited;
  const byId = Object.fromEntries(arr.map((s) => [s.id, s]));
  // Merge prose back onto the user's stories; anything the model dropped keeps its edit.
  const merged = stories.map((s) => {
    const r = byId[s.id];
    if (!r) return s;
    return Object.assign({}, s, {
      title: clean(r.title) || s.title,
      asA: clean(r.asA) || s.asA,
      iWant: clean(r.iWant) || s.iWant,
      soThat: clean(r.soThat) || s.soThat,
    });
  });
  return Object.assign({}, edited, { stories: merged });
}

// Pull a JSON array of stories out of a model reply, tolerating fences or a leading
// sentence. Returns null when nothing usable is found (caller keeps the user's edits).
function parseStoryArray(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/i);
  const bare = raw.match(/\[[\s\S]*\]/);
  const slice = fenced ? fenced[1] : bare ? bare[0] : null;
  if (!slice) return null;
  try {
    const arr = JSON.parse(slice);
    if (Array.isArray(arr) && arr.every((o) => o && typeof o === 'object' && o.id)) return arr;
  } catch {
    /* not valid JSON — fall through */
  }
  return null;
}

function clean(s) {
  return s == null ? '' : String(s).replace(/\s+/g, ' ').trim();
}

// A small, explainable diff: which story ids were added, removed, or changed.
function diffStories(prior, next) {
  const byId = (arr) => Object.fromEntries(arr.map((s) => [s.id, s]));
  const a = byId(prior);
  const b = byId(next);
  const added = next.filter((s) => !a[s.id]).map((s) => s.id);
  const removed = prior.filter((s) => !b[s.id]).map((s) => s.id);
  const changed = next
    .filter((s) => a[s.id] && JSON.stringify(a[s.id]) !== JSON.stringify(s))
    .map((s) => s.id);
  return { added, removed, changed };
}

function renderHtml(doc) {
  const frozen = doc.status === 'frozen';
  const rows = (doc.stories || [])
    .map(
      (s) => `<article class="story">
  <header><span class="id">${esc(s.id)}</span><h3>${esc(s.title)}</h3></header>
  <p class="line"><b>As a</b> ${esc(s.asA)} <b>I want</b> ${esc(s.iWant)} <b>so that</b> ${esc(s.soThat)}.</p>
  <p class="src">From: ${(s.sources || []).map((f) => `<code>${esc(f)}</code>`).join(' · ') || '<em>no source</em>'}</p>
</article>`,
    )
    .join('\n');
  const empty = '<p class="empty">No code-grounded stories yet. Run <code>powercodex import --analyze</code> first so PowerCodex can read your app.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>User stories${frozen ? ' · frozen' : ''}</title><style>
:root{--bg:#0b0d12;--panel:#161a24;--line:#262c3a;--text:#e8ecf4;--muted:#99a2b8;--accent:#6ea8fe;--accent2:#a78bfa;--good:#5ad19a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(900px 480px at 80% -10%,rgba(167,139,250,.14),transparent 60%),var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;line-height:1.55}
.wrap{max-width:860px;margin:0 auto;padding:48px 24px}
.eyebrow{display:inline-block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid rgba(110,168,254,.25);background:rgba(110,168,254,.1);padding:5px 12px;border-radius:999px}
.frozen-tag{margin-left:8px;color:#bdebd2;border-color:rgba(90,209,154,.3);background:rgba(90,209,154,.08)}
h1{font-size:28px;margin:16px 0 6px;letter-spacing:-.02em}
.sub{color:var(--muted);max-width:640px}
.story{margin-top:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:14px 16px}
.story header{display:flex;align-items:center;gap:10px}
.id{font-size:11px;letter-spacing:.08em;color:var(--accent2);border:1px solid var(--line);border-radius:6px;padding:2px 7px}
.story h3{margin:0;font-size:15px}
.line{margin:8px 0 4px;color:var(--text);font-size:14px}
.line b{color:var(--muted);font-weight:600}
.src{margin:6px 0 0;color:var(--muted);font-size:12.5px}
code{background:#0f131c;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12px}
.empty{margin-top:20px;color:var(--muted)}
</style></head><body><div class="wrap">
<span class="eyebrow">User stories · from your code</span>${frozen ? '<span class="eyebrow frozen-tag">frozen</span>' : ''}
<h1>${doc.grounded ? 'Derived from your repository' : 'Stories'}</h1>
<p class="sub">${doc.grounded ? 'Each story below was generated from your real code and cites the file it came from. Edit anything that is wrong, let PowerCodex refine from your edits, then freeze it as the benchmark.' : 'No digest found yet.'}</p>
${rows || empty}
</div></body></html>`;
}

module.exports = { buildStories, saveStories, readStories, refineStories, diffStories, storiesJson, storiesHtmlPath, storiesDir };
