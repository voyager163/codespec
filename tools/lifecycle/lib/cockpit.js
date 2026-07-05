'use strict';
const readline = require('node:readline');
const providers = require('./providers');
const plans = require('./plans');
const { load: loadRights, ensureRights, save: saveRights, approvalFile } = require('./rights');
const { deriveState } = require('./state');
const { reset } = require('./bus');
const harness = require('./harness');
const { classifyIntent } = require('./chat');

// ── ANSI (best-effort; disabled when not a TTY or NO_COLOR) ──────────────────
function paint(enabled) {
  const c = (code) => (s) => (enabled ? `[${code}m${s}[0m` : String(s));
  return {
    dim: c('2;37'), accent: c('38;5;75'), ai: c('38;5;141'), ok: c('38;5;78'),
    warn: c('38;5;221'), bad: c('38;5;210'), cyan: c('38;5;80'), bold: c('1'),
  };
}

// ── Slash commands ───────────────────────────────────────────────────────────
// Each command's run() returns { lines:[...], exit?, sideEffect? }. Pure-ish:
// it reads/writes project files but needs no TTY, so it is unit-testable.
const COMMANDS = [
  { cmd: 'help', args: '', desc: 'list every command' },
  { cmd: 'provider', args: '[id]', desc: 'switch AI — claude-code · github-copilot · simulated' },
  { cmd: 'model', args: '', desc: 'show the active provider + model' },
  { cmd: 'plan', args: '[open|list|latest]', desc: 'view generated HTML plans' },
  { cmd: 'start', args: '[rotations]', desc: 'run the lifecycle loop' },
  { cmd: 'status', args: '', desc: 'goal / MVP / rights / rotation snapshot' },
  { cmd: 'rights', args: '[flag] [on|off]', desc: 'inspect or toggle the consent gate' },
  { cmd: 'studio', args: '', desc: 'open the graphical Studio dashboard in a browser' },
  { cmd: 'reset', args: '', desc: 'clear the run state (status bus)' },
  { cmd: 'history', args: '', desc: 'show recent prompts' },
  { cmd: 'clear', args: '', desc: 'clear the screen' },
  { cmd: 'quit', args: '', desc: 'leave the cockpit' },
];

const RIGHTS_FLAGS = ['allowBuild', 'allowPush', 'allowAutoRespec', 'allowAutoApplyDefects'];
const RIGHTS_ALIAS = { build: 'allowBuild', push: 'allowPush', 'auto-respec': 'allowAutoRespec', autorespec: 'allowAutoRespec', 'auto-fix': 'allowAutoApplyDefects', autofix: 'allowAutoApplyDefects' };

// Commands matching a partial "/inp" — drives Tab autocomplete + the palette hint.
function matchCommands(input) {
  if (!input.startsWith('/')) return [];
  const q = input.slice(1).toLowerCase();
  return COMMANDS.filter((c) => c.cmd.startsWith(q));
}

// ── A cockpit session: the brain behind both the TUI and the self-test ───────
function createSession(root, opts = {}) {
  let provider = providers.resolve(opts.provider);
  const history = [];
  const transcript = [];

  function snapshot() {
    let st = {};
    try {
      st = deriveState(root);
    } catch {
      st = {};
    }
    return st;
  }

  async function runCommand(line) {
    const [raw, ...rest] = line.slice(1).split(/\s+/);
    const name = (raw || '').toLowerCase();
    const cmd = COMMANDS.find((c) => c.cmd === name);
    if (!cmd) return { kind: 'command', name, lines: [`unknown command: /${name} — try /help`] };

    switch (name) {
      case 'help':
        return { kind: 'command', name, lines: ['Commands:', ...COMMANDS.map((c) => `  /${c.cmd}${c.args ? ' ' + c.args : ''}  —  ${c.desc}`)] };

      case 'provider': {
        const want = rest[0];
        if (!want) {
          const lines = ['Providers (▸ active):', ...providers.list().map((p) => `  ${p.id === provider.id ? '▸' : ' '} ${p.id} · ${p.model}${p.available ? '' : ' (not installed)'}${p.simulated ? ' · fallback' : ''}`)];
          return { kind: 'command', name, lines };
        }
        const next = providers.resolve(want);
        const switched = next.id === want || (next.id === provider.id);
        provider = next;
        return {
          kind: 'command', name, sideEffect: 'provider',
          lines: next.id === want
            ? [`✓ now on ${next.id} · ${next.model}` + (next.simulated ? ' (fallback — install the CLI to use the real brain)' : '')]
            : [`'${want}' is not available; staying on ${next.id} · ${next.model}`],
        };
      }

      case 'model':
        return { kind: 'command', name, lines: [`active provider: ${provider.id} · model ${provider.model}${provider.simulated ? ' · simulated fallback' : ''}`] };

      case 'plan': {
        const sub = (rest[0] || 'list').toLowerCase();
        if (sub === 'list') {
          const list = plans.listPlans(root);
          if (!list.length) return { kind: 'command', name, lines: ['No plans yet. They appear here when the agent finishes one.'] };
          return { kind: 'command', name, lines: ['Plans:', ...list.map((p) => `  ${p.id} · ${p.title} · ${p.provider} · ${p.file}`)] };
        }
        const ref = sub === 'open' || sub === 'latest' ? rest[1] || 'latest' : sub;
        const resolved = plans.resolvePlan(root, ref, opts.port || 4321);
        if (!resolved) return { kind: 'command', name, lines: ['No matching plan. Try /plan list.'] };
        return { kind: 'command', name, sideEffect: 'open-plan', url: resolved.url, absPath: resolved.absPath, lines: [`opening ${resolved.entry.title} → ${resolved.url}`] };
      }

      case 'start': {
        const rotations = Number.parseInt(rest[0], 10) || 2;
        const { runLoop } = require('./loop');
        const summary = await runLoop(root, { fresh: true, simulate: true, rotations, render: true });
        return { kind: 'command', name, lines: [`loop finished · ${summary.rotations} rotation(s) · ${summary.selfHeals} self-heal(s) · ${summary.stopped ? 'stopped at a gate' : 'green & matches MVP'}`] };
      }

      case 'status': {
        const s = snapshot();
        const i = s.intake || {};
        const r = i.rights || {};
        return {
          kind: 'command', name,
          lines: [
            `goal      ${i.goal || '(awaiting)'}`,
            `MVP       ${i.mvp || '(awaiting)'}`,
            `compliance ${i.compliance != null ? i.compliance + '%' : '—'}`,
            `rights    ${RIGHTS_FLAGS.map((f) => `${f.replace('allow', '').replace('AutoApplyDefects', 'auto-fix').replace('AutoRespec', 'auto-respec')}=${!!r[f]}`).join(' · ')}`,
            `rotation  ${s.rotation || '—'} · provider ${provider.id}`,
          ],
        };
      }

      case 'rights': {
        ensureRights(root);
        const data = loadRights(root) || {};
        const flagArg = rest[0];
        if (!flagArg) return { kind: 'command', name, lines: ['Approved_rights:', ...RIGHTS_FLAGS.map((f) => `  ${f} = ${!!data[f]}`)] };
        const flag = RIGHTS_ALIAS[flagArg.toLowerCase()] || flagArg;
        if (!RIGHTS_FLAGS.includes(flag)) return { kind: 'command', name, lines: [`unknown right: ${flagArg} — one of ${RIGHTS_FLAGS.join(', ')}`] };
        const val = rest[1] == null ? !data[flag] : /^(on|true|yes|1)$/i.test(rest[1]);
        data[flag] = val;
        saveRights(root, data);
        return { kind: 'command', name, sideEffect: 'rights', lines: [`✓ ${flag} = ${val} · written to Approved_rights/approval.json`] };
      }

      case 'studio':
        return { kind: 'command', name, sideEffect: 'studio', lines: ['launching the graphical Studio dashboard…'] };

      case 'reset':
        reset(root);
        return { kind: 'command', name, sideEffect: 'reset', lines: ['run state cleared (status bus reset).'] };

      case 'history':
        return { kind: 'command', name, lines: history.length ? history.slice(-12).map((h, i) => `  ${history.length - Math.min(12, history.length) + i + 1}. ${h}`) : ['(no history yet)'] };

      case 'clear':
        return { kind: 'command', name, sideEffect: 'clear', lines: [] };

      case 'quit':
        return { kind: 'command', name, exit: true, lines: ['bye — the loop and dashboard keep their state on disk.'] };

      default:
        return { kind: 'command', name, lines: [`/${name} is not wired yet.`] };
    }
  }

  // Process one line of input. `io.onToken` streams provider output; `io.signal`
  // lets the caller interrupt a generation. No TTY required.
  async function handle(input, io = {}) {
    const line = String(input == null ? '' : input).trim();
    if (!line) return { kind: 'noop', lines: [] };
    history.push(line);
    if (line.startsWith('/')) return runCommand(line);

    transcript.push({ role: 'user', text: line });
    let tool = null;
    // Prepend the engineering harness to the user's line (empty on greetings / when off).
    let rights = null;
    try {
      rights = loadRights(root);
    } catch {
      /* default-on / fail-open in compose */
    }
    const h = harness.compose({ taskText: line, intent: classifyIntent(line, transcript), rights });
    const res = await provider.send({
      prompt: h ? `${h}\n\n${line}` : line,
      history: transcript,
      onToken: io.onToken,
      onTool: (t) => {
        tool = t;
        if (io.onTool) io.onTool(t);
      },
      signal: io.signal,
    });
    transcript.push({ role: 'assistant', text: res.text });
    return { kind: 'chat', provider: provider.id, text: res.text, tool, aborted: !!res.aborted };
  }

  return {
    handle,
    get provider() {
      return provider;
    },
    get history() {
      return history;
    },
    snapshot,
  };
}

// ── The interactive terminal (TUI) ───────────────────────────────────────────
function run(root, opts = {}) {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const k = paint(useColor);
  const session = createSession(root, opts);
  const out = (s = '') => process.stdout.write(s + '\n');

  function banner() {
    const s = session.snapshot();
    const i = (s && s.intake) || {};
    const r = i.rights || {};
    out();
    out(k.bold('  PowerCodex Cockpit') + k.dim('  ·  a real terminal for the whole lifecycle'));
    out(k.dim('  ────────────────────────────────────────────────────────────'));
    out(`  project ${k.accent(require('node:path').basename(root))}   provider ${k.ai(session.provider.id)}   rights ${k.ok(`build:${!!r.allowBuild} push:${!!r.allowPush} auto-fix:${!!r.allowAutoApplyDefects}`)}`);
    if (i.goal) out(`  goal ${k.dim('"' + i.goal + '"')}${i.compliance != null ? '   MVP ' + k.ok(i.compliance + '%') : ''}`);
    out(k.dim('  type a request, or ') + k.accent('/') + k.dim(' for commands · Tab completes · Ctrl-C interrupts · /quit to exit'));
    out();
  }

  const completer = (line) => {
    const hits = matchCommands(line).map((c) => '/' + c.cmd);
    return [hits.length ? hits : [], line];
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: k.ok('▸ ') + '', completer, historySize: 200 });

  let buffer = '';            // multiline accumulator (lines ending with \ continue)
  let controller = null;
  const queue = [];           // serialize input so a turn always finishes before the next
  let processing = false;
  let eof = false;
  let leaving = false;

  banner();
  rl.prompt();

  // Process exactly one submitted line (a chat turn or a slash command).
  async function processLine(input) {
    controller = new AbortController();
    try {
      const isChat = !input.startsWith('/');
      if (isChat) process.stdout.write(k.ai('codex ▸ '));
      const result = await session.handle(input, {
        onToken: (t) => process.stdout.write(k.ai(t)),
        onTool: (tool) => process.stdout.write('\n' + k.ok('  ✓ ' + tool.name) + ' ' + k.dim(tool.target + (tool.meta ? ' · ' + tool.meta : ''))),
        signal: controller.signal,
      });
      if (isChat) {
        if (result.aborted) process.stdout.write(k.warn('  ⟂ interrupted'));
        process.stdout.write('\n');
      } else {
        applyEffects(result);
        for (const l of result.lines) out(k.dim(l));
        if (result.exit) leaving = true;
      }
    } catch (err) {
      out(k.bad('  error: ' + err.message));
    } finally {
      controller = null;
    }
  }

  // Drain the queue one turn at a time; only after it's empty do we re-prompt or
  // (on EOF / quit) leave — so streaming is never cut off mid-reply.
  async function pump() {
    if (processing) return;
    processing = true;
    while (queue.length && !leaving) {
      await processLine(queue.shift());
    }
    processing = false;
    if (leaving || eof) {
      out(k.dim('\n  cockpit closed.'));
      process.exit(0);
    }
    rl.prompt();
  }

  rl.on('line', (raw) => {
    // Multiline: a trailing single backslash means "newline, keep typing".
    if (raw.endsWith('\\')) {
      buffer += raw.slice(0, -1) + '\n';
      process.stdout.write(k.dim('… '));
      return;
    }
    const input = (buffer + raw).trim();
    buffer = '';
    if (!input) {
      if (!processing) rl.prompt();
      return;
    }
    queue.push(input);
    pump();
  });

  rl.on('SIGINT', () => {
    if (controller) {
      controller.abort();
      process.stdout.write(k.warn('\n  ⟂ interrupting — type a new direction\n'));
      return;
    }
    out(k.dim('  (Ctrl-C) — type /quit to exit'));
    rl.prompt();
  });

  // EOF (piped input ends, or Ctrl-D): finish any in-flight/queued turns first.
  rl.on('close', () => {
    eof = true;
    pump();
  });

  function applyEffects(result) {
    if (result.sideEffect === 'clear') {
      console.clear();
      banner();
    } else if (result.sideEffect === 'open-plan') {
      serveAndOpenPlan(root, result, opts);
    } else if (result.sideEffect === 'studio') {
      launchStudio(root, opts);
    }
  }
}

// Open a generated plan: spin up the dashboard server (which also serves /plans/*)
// if needed, then open the browser at the plan URL.
function serveAndOpenPlan(root, result, opts) {
  ensureServer(root, opts);
  openBrowser(result.url);
}

function launchStudio(root, opts) {
  const url = ensureServer(root, opts);
  openBrowser(url);
}

let _server = null;
function ensureServer(root, opts = {}) {
  const port = opts.port || 4321;
  if (!_server) {
    const { serve } = require('./server');
    _server = serve(root, { port });
  }
  return `http://localhost:${port}`;
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* best-effort */
  }
}

module.exports = { run, createSession, matchCommands, COMMANDS };
