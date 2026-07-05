'use strict';
// The general Agent runner — what makes "Agent mode" actually do something. Chat mode
// converses and proposes; Agent mode EXECUTES against the active workspace and streams
// its progress onto the live bus (so the UI shows real activity, not a canned strip).
//
// It routes by intent:
//   • build    → hands back to the server to run the real Power Apps lifecycle loop
//                (plan → code-gen → build-verify → self-heal), unchanged.
//   • artifact → authors a deliverable now (Power BI dashboard, architecture, document…).
//   • act/answer → drives the resolved AI provider INSIDE the workspace (cwd = project),
//                so a capable CLI (Claude Code) can read and edit real files; the
//                simulated brain degrades honestly when no CLI is present.
//
// Nothing here is required to succeed for the app to stay usable: every branch has an
// honest fallback, and the Power Apps build path is untouched.
const providers = require('./providers');
const { classifyIntent } = require('./chat');
const artifacts = require('./artifacts');
const memory = require('./memory');
const harness = require('./harness');
const rightsGate = require('./rights');

function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

const AGENT_SYSTEM = [
  'You are PowerCodex in AGENT mode — a hands-on engineering agent working inside the maker’s project folder.',
  'You can read and edit the real files in this workspace to carry out the request.',
  'Guidance:',
  '- Do the smallest correct thing that satisfies the request; prefer real edits over describing them.',
  '- Match the surrounding code’s style and conventions.',
  '- When you finish, reply with a short, plain-language summary of what you changed (a few sentences).',
  '- If you produce a standalone HTML deliverable, wrap it in a ```html fenced block so it can be previewed.',
].join('\n');

function buildAgentPrompt({ message, history, memory: mem, rights } = {}) {
  const lines = [];
  // Agent mode is always a substantive turn — prepend the engineering harness (unless
  // the consent flag is off). Intent 'act' since the agent executes against the repo.
  const h = harness.compose({ taskText: message, intent: 'act', rights });
  if (h) lines.push(h, '');
  lines.push(AGENT_SYSTEM, '');
  const m = oneLine(mem);
  if (m) {
    lines.push('What you already know about this project:');
    lines.push(m, '');
  }
  if (history && history.length) {
    lines.push('Recent conversation:');
    for (const h of history.slice(-8)) lines.push((h.role === 'me' ? 'Maker: ' : 'Assistant: ') + oneLine(h.text));
    lines.push('');
  }
  lines.push('Task: ' + oneLine(message));
  return lines.join('\n');
}

// Run the agent. `emit` (optional) streams structured activity onto the bus; the server
// passes one bound to the active root. Returns a result the server/client act on.
async function run(root, { message, history, provider, emit, memory: mem } = {}) {
  const adapter = providers.resolve(provider);
  const simulated = adapter.simulated === true;
  const intent = classifyIntent(message, history);
  const say = (level, msg) => {
    try {
      if (emit) emit({ rotation: 0, stage: 3, agent: 'agent', level, message: msg });
    } catch {
      /* the bus must never break the agent */
    }
  };

  say('info', `Agent · starting · ${oneLine(message).slice(0, 80)}`);

  // 1) A build request → let the server drive the real lifecycle loop.
  if (intent === 'plan') {
    say('good', 'Agent · recognised a build request — handing to the build engine');
    return { kind: 'build', intent, provider: adapter.id, simulated };
  }

  // 2) An artifact request → produce it now. Deterministic renderers mean this works
  //    offline; a provider could enrich the data later (WS-future).
  if (intent === 'artifact') {
    const kind = artifacts.kindFromMessage(message);
    let entry = null;
    let err = null;
    try {
      entry = artifacts.save(root, { kind, goal: message });
    } catch (e) {
      err = e.message;
    }
    if (entry) {
      say('good', `Agent · created ${kind} → ${entry.file}`);
      try {
        memory.record(root, { artifact: entry });
      } catch {
        /* best-effort */
      }
    } else {
      say('bad', `Agent · could not create artifact (${err})`);
    }
    return {
      kind: 'artifact',
      intent,
      reply: entry ? `Done — I built a ${kind.replace(/-/g, ' ')} and opened it in the canvas. Tell me what to change.` : `I couldn’t create that artifact: ${err}`,
      artifact: entry,
      provider: adapter.id,
      simulated,
    };
  }

  // 3) act / answer → drive the provider inside the workspace.
  let rights = null;
  try {
    rights = rightsGate.load(root);
  } catch {
    /* default-on / fail-open in compose */
  }
  // Observability: post the harness routing decision to the bus (best-effort).
  try {
    if (harness.compose({ taskText: message, intent: 'act', rights })) {
      say('info', harness.statusLine(harness.route(message, 'act')));
    }
  } catch {
    /* the bus must never break the agent */
  }
  let text = '';
  try {
    const res = await adapter.send({
      prompt: buildAgentPrompt({ message, history, memory: mem, rights }),
      history,
      cwd: root,
      timeoutMs: 120000,
      onTool: (t) => say('info', `Agent · ${t.name}${t.target ? ' · ' + oneLine(t.target).slice(0, 60) : ''}`),
    });
    text = (res && res.text) || '';
  } catch {
    text = '';
  }

  // If the agent authored a standalone HTML deliverable, capture it for the canvas.
  let entry = null;
  const html = text.match(/```html\s*([\s\S]*?)```/i);
  if (html && html[1].trim()) {
    try {
      entry = artifacts.save(root, { kind: 'page', title: oneLine(message).slice(0, 60) || 'Page', html: html[1].trim() });
      if (entry) {
        say('good', `Agent · saved a page → ${entry.file}`);
        try {
          memory.record(root, { artifact: entry });
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* capturing is a nice-to-have */
    }
  }

  const reply =
    text.replace(/```html[\s\S]*?```/i, '').trim() ||
    (simulated
      ? 'I can carry that out here. Connect Claude Code (the CLI) and Agent mode will read and edit your project directly; until then I’m running the simulated brain.'
      : 'Done.');
  say(simulated ? 'warn' : 'good', simulated ? 'Agent · simulated (no AI CLI found)' : 'Agent · done');

  return { kind: intent === 'act' ? 'act' : 'answer', intent, reply, artifact: entry, provider: adapter.id, simulated };
}

module.exports = { run, buildAgentPrompt, AGENT_SYSTEM };
