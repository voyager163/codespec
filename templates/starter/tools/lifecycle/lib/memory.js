'use strict';
// Durable project memory — what makes PowerCodex get smarter as a conversation (and a
// project) progresses. Plain JSON in the workspace so it stays fully inspectable and
// editable; the assistant reads a compact summary of it on every turn, so context
// survives far past the chat's 12-turn window.
//
//   .powercodex/memory.json
//   {
//     goal:        "the project's north star (latest stated)",
//     decisions:   ["short decisions / facts established"],
//     preferences: ["how the maker likes things done"],
//     artifacts:   [{ id, kind, title, at }],   // what's been produced
//     questions:   ["open questions still worth resolving"],
//     updatedAt
//   }
//
// Everything here is best-effort: a memory hiccup must never break a chat reply or a
// build. Reads return a safe empty shape; writes swallow errors.
const fs = require('node:fs');
const path = require('node:path');

function memDir(root) {
  return path.join(root, '.powercodex');
}
function memFile(root) {
  return path.join(memDir(root), 'memory.json');
}

function empty() {
  return { goal: null, decisions: [], preferences: [], artifacts: [], questions: [], updatedAt: null };
}

function read(root) {
  try {
    const raw = fs.readFileSync(memFile(root), 'utf8');
    const o = JSON.parse(raw);
    return Object.assign(empty(), o, {
      decisions: Array.isArray(o.decisions) ? o.decisions : [],
      preferences: Array.isArray(o.preferences) ? o.preferences : [],
      artifacts: Array.isArray(o.artifacts) ? o.artifacts : [],
      questions: Array.isArray(o.questions) ? o.questions : [],
    });
  } catch {
    return empty();
  }
}

function write(root, mem) {
  try {
    fs.mkdirSync(memDir(root), { recursive: true });
    const out = Object.assign(empty(), mem, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(memFile(root), JSON.stringify(out, null, 2) + '\n');
    return out;
  } catch {
    return mem;
  }
}

// Keep a list short, de-duplicated, and most-recent-last.
function pushCapped(list, value, cap) {
  const v = String(value || '').replace(/\s+/g, ' ').trim();
  if (!v) return list;
  const next = (list || []).filter((x) => x.toLowerCase() !== v.toLowerCase());
  next.push(v);
  return next.slice(-cap);
}

// Merge a patch into memory and persist. Arrays append (capped); scalars overwrite.
function record(root, patch = {}) {
  const mem = read(root);
  if (patch.goal) mem.goal = String(patch.goal).replace(/\s+/g, ' ').trim().slice(0, 240);
  for (const d of [].concat(patch.decision || patch.decisions || [])) mem.decisions = pushCapped(mem.decisions, d, 12);
  for (const p of [].concat(patch.preference || patch.preferences || [])) mem.preferences = pushCapped(mem.preferences, p, 10);
  for (const q of [].concat(patch.question || patch.questions || [])) mem.questions = pushCapped(mem.questions, q, 8);
  if (patch.artifact) {
    const a = patch.artifact;
    mem.artifacts = (mem.artifacts || []).filter((x) => x.id !== a.id);
    mem.artifacts.push({ id: a.id || null, kind: a.kind || 'document', title: a.title || '', at: new Date().toISOString() });
    mem.artifacts = mem.artifacts.slice(-20);
  }
  return write(root, mem);
}

// Learn from a chat turn. Cheap heuristics so it works with no AI present: capture the
// first substantive build/answer goal, and any explicitly stated preference.
function noteTurn(root, { message, intent } = {}) {
  const m = String(message || '').replace(/\s+/g, ' ').trim();
  if (!m) return read(root);
  const patch = {};
  const mem = read(root);
  if ((intent === 'plan' || intent === 'artifact') && !mem.goal) patch.goal = m.slice(0, 240);
  // "I prefer / always / please use / I like / don't …" → a preference worth keeping.
  if (/\b(i prefer|i like|please (always|use|keep)|always|never|don'?t|do not|make sure)\b/i.test(m)) {
    patch.preference = m.slice(0, 160);
  }
  if (Object.keys(patch).length) return record(root, patch);
  return mem;
}

// Fold a build outcome into memory as a durable decision the next turn can lean on.
function noteOutcome(root, outcome) {
  if (!outcome) return read(root);
  const built = (outcome.built || []).map((b) => b.name).filter(Boolean);
  const verdict = outcome.verified ? 'passed its build check' : outcome.ran === false ? 'was not verified' : 'failed its build check';
  if (built.length) return record(root, { decision: `Built ${built.join(', ')} — ${verdict}.` });
  return read(root);
}

// A compact, prompt-ready summary. Empty string when there is nothing worth saying, so
// callers can cheaply skip the block.
function summarize(root) {
  const m = read(root);
  const out = [];
  if (m.goal) out.push(`Project goal: ${m.goal}`);
  if (m.preferences.length) out.push(`Maker preferences: ${m.preferences.slice(-5).join('; ')}`);
  if (m.decisions.length) out.push(`Established so far: ${m.decisions.slice(-6).join('; ')}`);
  if (m.artifacts.length) out.push(`Already produced: ${m.artifacts.slice(-6).map((a) => `${a.title || a.kind} (${a.kind})`).join('; ')}`);
  if (m.questions.length) out.push(`Open questions: ${m.questions.slice(-4).join('; ')}`);
  return out.join('\n');
}

module.exports = { read, write, record, noteTurn, noteOutcome, summarize, memFile, empty };
