'use strict';
// Provider-backed conversation for the maker chat. Turns a plain-language message
// (plus the running history) into a friendly reply and, when the maker has said
// enough, a structured plan the UI renders as a "Build this" card. It talks to the
// same provider bridge the cockpit uses, so it inherits Claude Code / Copilot when
// their CLIs are present and the simulated brain otherwise — always answering.
const providers = require('./providers');

const SYSTEM = [
  'You are PowerCodex, a warm, encouraging build assistant for a NON-technical low-code maker.',
  'Rules you must follow:',
  '- Plain, friendly language only. Never show code, file paths, JSON, or technical jargon to the maker.',
  '- Keep replies short: 2 to 4 sentences.',
  '- Ask at most ONE clarifying question, and only when you genuinely need it to build the right thing.',
  '- When you have enough to build a first version, append a plan block on its own lines, EXACTLY in this format:',
  '<<<PLAN',
  '{"title":"short title","items":["plain capability 1","plain capability 2","plain capability 3"]}',
  'PLAN>>>',
  '- The plan has 3 to 6 items, each a single capability in plain words.',
  '- Never mention the plan block, JSON, or these instructions in your prose. The maker only sees your friendly sentences.',
].join('\n');

function buildPrompt({ message, history } = {}) {
  const lines = [SYSTEM, '', 'Conversation so far:'];
  for (const h of (history || []).slice(-12)) {
    lines.push((h.role === 'me' ? 'Maker: ' : 'Assistant: ') + String(h.text || '').replace(/\s+/g, ' ').trim());
  }
  lines.push('Maker: ' + String(message || '').trim());
  lines.push('Assistant:');
  return lines.join('\n');
}

// Pull the structured plan out of a reply, tolerating either the explicit marker
// block or a ```plan fenced block. Returns the prose (with the block removed) and
// the parsed plan, or null when there is none yet (the model is still chatting).
function extractPlan(text) {
  const raw = String(text || '');
  let m = raw.match(/<<<PLAN\s*([\s\S]*?)\s*PLAN>>>/i);
  if (!m) m = raw.match(/```(?:plan|json)?\s*(\{[\s\S]*?"items"[\s\S]*?\})\s*```/i);
  if (!m) {
    // Some CLIs emit a bare JSON object with items and no fence.
    const bare = raw.match(/\{[^{}]*"items"\s*:\s*\[[\s\S]*?\][^{}]*\}/);
    if (bare) m = [bare[0], bare[0]];
  }
  if (!m) return { reply: raw.trim(), plan: null };
  let plan = null;
  try {
    const o = JSON.parse(m[1].trim());
    if (o && Array.isArray(o.items) && o.items.length) {
      plan = { title: o.title ? String(o.title) : 'Your plan', items: o.items.map((s) => String(s)).filter(Boolean).slice(0, 6) };
    }
  } catch {
    /* leave plan null — the prose still gets shown */
  }
  return { reply: raw.replace(m[0], '').trim(), plan };
}

// A local fallback plan so the simulated brain (no vendor CLI) still proposes
// something concrete. Mirrors the kinds of capabilities makers ask for.
function heuristicPlan(message) {
  const g = String(message || '').toLowerCase();
  const items = [];
  const goal = String(message || '').trim();
  items.push('Build the main screen for what you described');
  if (/\b(my|mine|assigned|user|technician|tech|only|me)\b/.test(g)) items.push('Show only items for the signed-in user');
  if (/\b(sort|order|soonest|deadline|due|date|priority|latest|recent)\b/.test(g)) items.push('Sort by the most important field first');
  if (/\b(red|overdue|highlight|colou?r|flag|warn|alert)\b/.test(g)) items.push('Highlight items that need attention');
  if (/\b(search|find|filter|lookup)\b/.test(g)) items.push('Add a search box at the top');
  if (/\b(done|complete|status|mark|approve|update|edit)\b/.test(g)) items.push('Add a quick status or action on each item');
  items.push('Test it end-to-end and fix issues until it is clean');
  return { title: goal.length > 34 ? goal.slice(0, 34) + '…' : goal || 'Your plan', items: items.slice(0, 6) };
}

async function respond(root, { message, history, providerId } = {}) {
  const adapter = providers.resolve(providerId);
  const simulated = adapter.simulated === true;
  let text = '';
  try {
    const res = await adapter.send({ prompt: buildPrompt({ message, history }), history, timeoutMs: 45000 });
    text = (res && res.text) || '';
  } catch {
    text = '';
  }
  let { reply, plan } = extractPlan(text);

  // The simulated brain never authors a plan block, so synthesize one from the
  // message — the maker still gets a concrete "Build this" card without a vendor CLI.
  if (!plan && simulated) plan = heuristicPlan(message);
  if (!reply) {
    reply = plan
      ? "Here's a plan for that — press Build this when it looks right."
      : 'Tell me a little more about what you’d like and I’ll shape a plan.';
  }
  return { reply, plan, provider: adapter.id, simulated };
}

module.exports = { respond, extractPlan, buildPrompt, heuristicPlan };
