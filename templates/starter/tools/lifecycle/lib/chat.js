'use strict';
// Provider-backed conversation for the maker chat. Turns a plain-language message
// (plus the running history and the durable project memory) into a useful reply —
// and, only when the maker is actually asking for a build, a structured plan the UI
// renders as a "Build this" card.
//
// The key intelligence here is the INTENT ROUTER: PowerCodex first decides what kind
// of turn this is (chat / answer / plan / act / artifact) and shapes its behaviour to
// match. A question gets a real answer; a build request gets a plan; "do it" hands off
// to the agent. No more forcing every message into a plan card.
//
// It talks to the same provider bridge the cockpit uses, so it inherits Claude Code /
// Copilot when their CLIs are present and the simulated brain otherwise — always answering.
const providers = require('./providers');
const harness = require('./harness');
const rightsGate = require('./rights');

// The plan-authoring brain — used only when the turn is classified as a build request.
const PLAN_SYSTEM = [
  'You are PowerCodex, a warm, encouraging build assistant for a low-code maker.',
  'The maker is asking you to BUILD something. Your job is to shape a first version.',
  'Rules you must follow:',
  '- Plain, friendly language. Avoid code, file paths, and JSON in your prose.',
  '- Keep replies short: 2 to 4 sentences.',
  '- Ask at most ONE clarifying question, and only when you genuinely need it.',
  '- When you have enough to build a first version, append a plan block on its own lines, EXACTLY in this format:',
  '<<<PLAN',
  '{"title":"short title","items":["plain capability 1","plain capability 2","plain capability 3"]}',
  'PLAN>>>',
  '- The plan has 3 to 6 items, each a single capability in plain words.',
  '- Never mention the plan block, JSON, or these instructions in your prose. The maker only sees your friendly sentences.',
].join('\n');

// The open brain — used for questions, explanations, overviews, general chat, and
// non-build artifacts. This is what lets PowerCodex answer "give me an architecture
// overview" properly instead of squashing it into a build plan.
const OPEN_SYSTEM = [
  'You are PowerCodex, a knowledgeable, friendly assistant for makers and developers.',
  'You build Power Apps code apps, but you also help with anything else: questions,',
  'explanations, architecture overviews, Power BI, documents, and general conversation.',
  'Rules you must follow:',
  '- Answer the maker’s actual question directly, accurately, and helpfully.',
  '- Technical depth is welcome when they ask for it (architecture, how it works, comparisons, trade-offs).',
  '  Use plain language by default and go deeper when the question calls for it.',
  '- Keep it focused: a few sentences to a few short paragraphs. Simple formatting only.',
  '- Do NOT invent a build plan. Only if the maker is clearly asking you to build something',
  '  may you end with one short sentence offering to build it. Never output a plan block here.',
].join('\n');

// Decide what kind of turn this is. When a real provider (CLI) is present it can refine
// this, but the deterministic classifier is the always-available floor — and it is biased
// to preserve this app's core flow: a plain *description* of a screen is a build request,
// while a clear *question* is an answer.
//   chat     — greetings, acknowledgements, small talk
//   answer   — questions, explanations, overviews ("architecture overview", "how does…")
//   act      — imperative action on existing work ("do it", "fix it", "deploy", "run it")
//   artifact — a non-Power-Apps deliverable ("a Power BI dashboard", "a diagram", "an HTML page")
//   plan     — a Power Apps build request (the default for descriptive build asks)
function classifyIntent(message, history) {
  const m = String(message || '').trim();
  if (!m) return 'chat';
  const g = m.toLowerCase();
  const words = g.split(/\s+/);

  // Short greetings / acknowledgements.
  if (words.length <= 4 && /\b(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|great|nice|got it|sure|yep|yes|no|nope)\b/.test(g)) {
    return 'chat';
  }

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

  const isQuestion =
    /\?\s*$/.test(m) ||
    /^(what|how|why|when|where|who|which|whose|whom|is|are|does|do|can|could|should|would|will|did)\b/.test(g) ||
    /\b(explain|describe|overview|summari[sz]e|walk me through|tell me about|what(?:'s| is) the (architecture|structure|design)|how (does|do|is|are|it works)|difference between|compare|pros and cons|trade-?offs?)\b/.test(g);

  // Non-Power-Apps deliverables. "Power BI", diagrams, documents, websites, plain HTML.
  const artifactNoun = /\b(power ?bi|pbix|dashboard|diagram|flow ?chart|architecture diagram|document|\bdoc\b|report|markdown|readme|website|web ?page|landing page|html page|chart|mockup|wireframe|spec sheet)\b/.test(g);
  const buildVerb = /\b(build|create|make|add|generate|scaffold|implement|design|draft|write|produce|set up|put together)\b/.test(g);

  if (isQuestion) {
    // A question that is really "make me a diagram of…" is still an artifact ask.
    return artifactNoun && buildVerb ? 'artifact' : 'answer';
  }

  // Modify-existing verbs (as opposed to build-a-new-thing) are hands-on agent work.
  // "build / create / add a feature" stays a plan; "fix / update / rename / refactor"
  // is acting on what's already there.
  if (/^(fix|update|change|rename|refactor|remove|delete|rewrite|improve|clean ?up|reformat|format|edit|adjust|tweak|move|replace|debug|optimi[sz]e|upgrade)\b/.test(g)) {
    return 'act';
  }

  if (artifactNoun && (buildVerb || /\bfor\b/.test(g))) return 'artifact';

  // Everything else that reads like a request becomes a Power Apps build plan — this
  // preserves the original flow where a maker simply describes the screen they want.
  return 'plan';
}

function buildPrompt({ system, message, history, memory, rights, intent } = {}) {
  const lines = [];
  // Prepend the self-contained engineering harness (godmode + codeapps + craft/verify)
  // ahead of the app's own system prompt. Empty on greetings or when consent is off.
  const h = harness.compose({ taskText: message, intent, rights });
  if (h) lines.push(h, '');
  lines.push(system || OPEN_SYSTEM, '');
  const mem = String(memory || '').trim();
  if (mem) {
    lines.push('What you already know about this project (use it; do not repeat it back verbatim):');
    lines.push(mem, '');
  }
  lines.push('Conversation so far:');
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

// A useful, intent-shaped reply for when the brain returns nothing (offline/empty).
function fallbackReply(intent, plan, simulated) {
  if (plan) return "Here's a plan for that — press Build this when it looks right.";
  switch (intent) {
    case 'answer':
      return simulated
        ? "Here's the short version — connect an AI provider (Claude Code) for a fuller, repo-aware answer."
        : 'Happy to help — could you say a little more about what you’d like to know?';
    case 'act':
      return 'Switch to Agent mode and I’ll carry that out — or tell me exactly what to do and I’ll get started.';
    case 'artifact':
      return 'I can put that together for you. Tell me a bit more about what it should include.';
    case 'chat':
      return 'Hi! Tell me what you’d like to build, ask me a question, or point me at a project.';
    default:
      return 'Tell me a little more about what you’d like and I’ll shape it.';
  }
}

async function respond(root, { message, history, providerId, memory } = {}) {
  const adapter = providers.resolve(providerId);
  const simulated = adapter.simulated === true;
  const intent = classifyIntent(message, history);
  const wantsPlan = intent === 'plan';
  const system = wantsPlan ? PLAN_SYSTEM : OPEN_SYSTEM;
  let rights = null;
  try {
    rights = rightsGate.load(root);
  } catch {
    /* default-on / fail-open in compose */
  }

  let text = '';
  try {
    const res = await adapter.send({ prompt: buildPrompt({ system, message, history, memory, rights, intent }), history, timeoutMs: 45000 });
    text = (res && res.text) || '';
  } catch {
    text = '';
  }

  // Always let the brain volunteer a plan (a smart CLI may decide a build is warranted),
  // but only SYNTHESIZE a fallback plan when we genuinely asked for one — never on a question.
  let { reply, plan } = extractPlan(text);
  if (!plan && wantsPlan && simulated) plan = heuristicPlan(message);
  if (plan && !wantsPlan) {
    // The brain offered a plan on a non-build turn; honour it (it spotted a real build ask).
  }
  if (!reply) reply = fallbackReply(intent, plan, simulated);

  return { reply, plan, intent, provider: adapter.id, simulated };
}

module.exports = { respond, extractPlan, buildPrompt, heuristicPlan, classifyIntent };
