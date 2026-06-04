#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { runLoop } = require('../lib/loop');
const { render } = require('../lib/dashboard');
const { ensureRights } = require('../lib/rights');
const { selftest } = require('../lib/selftest');
const { serve } = require('../lib/server');
const { emit } = require('../lib/bus');
const { proposeMvp } = require('../lib/mvp');
const { reflect } = require('../lib/reflect');
const { initWorkspace, registerProject, summary: workspaceSummary } = require('../lib/workspace');
const { liveDir } = require('../lib/paths');
const { run: runCockpit } = require('../lib/cockpit');
const { importInto } = require('../lib/import');
const providers = require('../lib/providers');
const planRegistry = require('../lib/plans');

const root = process.cwd();
const [command, ...rest] = process.argv.slice(2);

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = rest[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function help() {
  console.log(`PowerCodex Lifecycle — the autonomous app loop, as files, with a live monitor.

Usage: powercodex-lifecycle <command> [options]

Commands:
  cockpit [--provider <id>] launch the real terminal cockpit (TUI) — talk to your AI, drive the loop
  import [--providers <x>]  add PowerCodex to the current project (consent gate, plan registry, script)
                            --analyze  also read the existing code into .powercodex/digest.json
  stories [--goal "<text>"] generate code-grounded user stories from the digest (.powercodex/stories/)
  provider <list>           list available AI providers (claude-code · github-copilot · simulated)
  plan <list|open|register> view or record generated HTML plans
  serve [options]           start the live dashboard server and monitor progress live
  loop [options]            run the lifecycle loop (Intake→Plan→…→Observe)
  emit <agent> <message>    append one event to the live board (any process can call this)
  mvp [--goal "<text>"]     propose an HTML MVP from the goal (.powercodex/mvp/preview.html)
  reflect "<title>" [opts]  log a Learning_Experience lesson (--severity, --what, --how)
  workspace <cmd>           init | register <path> | list — share one learning brain across projects
  init                      create .powercodex/live/ + Approved_rights/ + a dashboard
  dashboard                 re-render the static dashboard snapshot from the status bus
  selftest                  run the product against itself and assert it works

serve also accepts --open to launch the browser automatically.

emit options:
  --level <info|good|warn|bad>   event level (default info)
  --stage <0-7>                  lifecycle stage
  --rotation <n>                 rotation number

serve options:
  --port <n>                port (default 4321)
  --demo                    drive a paced simulated loop so the dashboard visibly moves
  --rotations <n>           rotations for --demo (default 3)

loop options:
  --rotations <n>           number of loop rotations (default 1)
  --fresh                   reset the status bus before running
  --real                    use real engine adapters instead of simulation

Open http://localhost:4321 (serve) — it polls /api/state and updates live.`);
}

async function main() {
  switch (command) {
    case 'cockpit': {
      runCockpit(root, {
        provider: typeof flag('provider') === 'string' ? flag('provider') : undefined,
        port: Number.parseInt(flag('port'), 10) || 4321,
      });
      break; // the TUI keeps the process alive
    }
    case 'import': {
      const result = importInto(root, {
        providers: typeof flag('providers') === 'string' ? flag('providers') : 'both',
        analyze: flag('analyze') === true,
      });
      console.log('PowerCodex · imported into', result.stack.name);
      for (const line of result.created) console.log('  ✓', line);
      if (result.digest) {
        console.log('\nNext: generate code-grounded user stories from the digest:');
        console.log('  powercodex stories      (writes .powercodex/stories/stories.json + .html)');
      }
      console.log('\nLaunch the cockpit:  npm run cockpit   (or: powercodex cockpit)');
      break;
    }
    case 'provider': {
      const sub = rest[0] || 'list';
      if (sub === 'list') {
        console.log('AI providers:');
        for (const p of providers.list()) {
          console.log(`  ${p.available ? '✓' : '·'} ${p.id} · ${p.model}${p.simulated ? ' (fallback)' : p.available ? '' : ' (not installed)'}`);
        }
      } else {
        console.log('usage: provider list');
      }
      break;
    }
    case 'plan': {
      const sub = rest[0] || 'list';
      if (sub === 'list') {
        const list = planRegistry.listPlans(root);
        if (!list.length) console.log('No plans recorded yet.');
        else for (const p of list) console.log(`  ${p.id} · ${p.title} · ${p.provider} · ${p.file}`);
      } else if (sub === 'open') {
        const resolved = planRegistry.resolvePlan(root, rest[1] || 'latest', Number.parseInt(flag('port'), 10) || 4321);
        if (!resolved) {
          console.log('No matching plan. Try: plan list');
        } else {
          console.log('Open in a browser (with the server running):', resolved.url);
          console.log('File:', resolved.absPath);
        }
      } else if (sub === 'register') {
        const entry = planRegistry.registerPlan(root, {
          title: typeof flag('title') === 'string' ? flag('title') : 'Untitled plan',
          file: typeof flag('file') === 'string' ? flag('file') : undefined,
          provider: typeof flag('provider') === 'string' ? flag('provider') : 'unknown',
          sections: flag('sections') != null ? Number(flag('sections')) : undefined,
          mockups: flag('mockups') != null ? Number(flag('mockups')) : undefined,
        });
        console.log(`Registered ${entry.id} → ${entry.file}`);
      } else {
        console.log('usage: plan <list | open [ref] | register --title <t> --file <f> [--provider <p>]>');
      }
      break;
    }
    case 'serve': {
      serve(root, {
        port: Number.parseInt(flag('port'), 10) || 4321,
        demo: flag('demo') === true,
        open: flag('open') === true,
        rotations: Number.parseInt(flag('rotations'), 10) || 3,
      });
      break; // server keeps the process alive
    }
    case 'workspace': {
      const sub = rest[0];
      if (sub === 'init') {
        const marker = initWorkspace(root, { name: typeof flag('name') === 'string' ? flag('name') : undefined });
        console.log('Workspace ready (shared brain) →', marker);
      } else if (sub === 'register') {
        if (!rest[1]) {
          console.error('usage: workspace register <project-path>');
          break;
        }
        console.log('Registered. Projects:', registerProject(root, rest[1]).join(', '));
      } else if (sub === 'list') {
        const s = workspaceSummary(root);
        if (!s) console.log('Not inside a PowerCodex workspace. Run: powercodex-lifecycle workspace init');
        else console.log(`Workspace: ${s.name}\nProjects (${s.projects.length}): ${s.projects.join(', ') || '(none registered)'}\nShared lessons: ${s.lessons}`);
      } else {
        console.log('usage: workspace <init [--name <n>] | register <path> | list>');
      }
      break;
    }
    case 'mvp': {
      const out = proposeMvp(root, { goal: typeof flag('goal') === 'string' ? flag('goal') : undefined });
      console.log('Proposed MVP →', out);
      break;
    }
    case 'stories': {
      const { buildStories } = require('../lib/stories');
      const { readDigest } = require('../lib/digest');
      if (!readDigest(root)) {
        console.log('No digest found. Run first:  powercodex import --analyze');
        break;
      }
      const result = buildStories(root, { goal: typeof flag('goal') === 'string' ? flag('goal') : undefined });
      console.log(`Generated ${result.doc.stories.length} code-grounded stories →`, result.path);
      console.log('Readable view →', result.htmlPath);
      break;
    }
    case 'reflect': {
      const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
      const lesson = reflect(root, {
        title: positional.join(' ') || 'Lesson from this session',
        severity: typeof flag('severity') === 'string' ? flag('severity') : undefined,
        what: typeof flag('what') === 'string' ? flag('what') : undefined,
        how: typeof flag('how') === 'string' ? flag('how') : undefined,
      });
      console.log(`Logged ${lesson.id} → ${lesson.file}`);
      break;
    }
    case 'init': {
      ensureRights(root);
      const out = render(root);
      console.log('Initialized .powercodex/live/ and Approved_rights/approval.json');
      console.log('Dashboard:', out, '· for live monitoring run: powercodex-lifecycle serve');
      break;
    }
    case 'dashboard': {
      console.log('Rendered', render(root));
      break;
    }
    case 'loop': {
      const rotations = Number.parseInt(flag('rotations'), 10) || 1;
      const summary = await runLoop(root, {
        fresh: flag('fresh') === true,
        rotations,
        simulate: flag('real') !== true,
      });
      console.log('\nSummary:', JSON.stringify(summary));
      console.log('Dashboard:', path.join(liveDir(root), 'index.html'));
      break;
    }
    case 'emit': {
      const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
      const agent = positional[0] || 'external';
      const message = positional.slice(1).join(' ') || '(no message)';
      const stage = flag('stage');
      emit(root, {
        agent,
        message,
        level: typeof flag('level') === 'string' ? flag('level') : 'info',
        stage: stage != null ? Number(stage) : undefined,
        rotation: flag('rotation') != null ? Number(flag('rotation')) : undefined,
      });
      render(root);
      console.log(`emitted · ${agent} · ${message}`);
      break;
    }
    case 'selftest': {
      process.exitCode = (await selftest()) ? 0 : 1;
      break;
    }
    default:
      help();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
