#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { runLoop } = require('../lib/loop');
const { render } = require('../lib/dashboard');
const { ensureRights, load: loadRights, setProfile } = require('../lib/rights');
const edgeProfiles = require('../lib/edge-profiles');
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

const dataverseSchema = require('../lib/dataverse-schema');
const pacInit = require('../lib/pac-init');

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
  profiles [use <sel>]      list signed-in Edge profiles; pick the one --real runs always attach to
  serve [options]           start the live dashboard server and monitor progress live
  loop [options]            run the lifecycle loop (Intake→Plan→…→Observe)
  emit <agent> <message>    append one event to the live board (any process can call this)
  mvp [--goal "<text>"]     propose an HTML MVP from the goal (.powercodex/mvp/preview.html)
  reflect "<title>" [opts]  log a Learning_Experience lesson (--severity, --what, --how)
  workspace <cmd>           init | register <path> | list — share one learning brain across projects
  init                      create .powercodex/live/ + Approved_rights/ + a dashboard
  dashboard                 re-render the static dashboard snapshot from the status bus
  selftest                  run the product against itself and assert it works
  dataverse <sub>           manage Dataverse tables and columns via the maker portal
  code-init                 pac code init — scaffold a Power Apps Code App (quick start)
  code-push                 pac code push — push the built app to Power Apps

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
  --real                    drive the real MDM browser engine (needs: a browser-based
                            project + Playwright installed · npm i -D playwright).
                            Falls back to simulation with a recommendation otherwise.
  --app-url <url>           the live app URL the real e2e engine should smoke-test
  --env <environmentId>     Power Platform environment for Engine 1 to enter (maker surfaces)
  --fix-mode <mode>         what to do when tests stay red after self-heal:
                              manual (default) — stop and escalate to you
                              diff             — apply the fix, show a diff event, wait for your approval
                              auto             — keep fixing and re-running until green (up to --max-heal-retries)
  --max-heal-retries <n>    max auto-fix attempts per rotation (default 3, used with --fix-mode auto)

dataverse options:
  init   [--name <TableName>]         create .powercodex/dataverse-schema.json template
  apply  [--env <envId>] [--dry-run]  open managed Edge, create tables + columns, write logical names
  status                              show schema intent vs what has been applied

code-init options:
  --app-name <name>         app display name (default MyPowerApp)
  --env-url  <url>          Power Platform environment URL (triggers pac auth if needed)
  --out-dir  <path>         where to create the app scaffold (default: ./src)

code-push options:
  --app-dir  <path>         directory containing the built app (default: ./src)

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
        // --real makes the served chat actually build (code-gen + build verify), like the
        // desktop app. Without it the dashboard/chat run the safe simulated loop.
        simulate: flag('real') !== true,
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
    case 'profiles': {
      // List your signed-in Edge profiles, and persist which one the real engines
      // (build entry + e2e runner) should always attach to.
      const positional = rest.filter((a) => !a.startsWith('--'));
      const sub = positional[0];
      const profiles = edgeProfiles.discoverProfiles();
      if (!profiles.length) {
        console.log('No Edge profiles found. Looked in:', edgeProfiles.defaultLocalStatePath());
        console.log('Open Microsoft Edge once and sign in to your tenant, then re-run.');
        break;
      }
      const current = loadRights(root);
      if (sub === 'use') {
        const picked = edgeProfiles.resolveSelection(profiles, positional[1]);
        if (!picked) {
          console.log(`Could not match "${positional[1] || ''}". Use a number, profile directory, name, or email from:`);
          profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.directory} — ${edgeProfiles.label(p)}`));
          process.exitCode = 1;
          break;
        }
        setProfile(root, { name: picked.directory, path: `./.profiles/${picked.directory}`, label: edgeProfiles.label(picked) });
        console.log(`✓ Real engines will always use Edge profile "${picked.directory}" — ${edgeProfiles.label(picked)}`);
        console.log('  Saved to Approved_rights/approval.json (browserProfile). Close normal Edge windows before a --real run.');
        break;
      }
      console.log('Signed-in Edge profiles:');
      profiles.forEach((p, i) => {
        const mark = current && current.browserProfile === p.directory ? ' ★ (selected)' : '';
        console.log(`  ${i + 1}. ${p.directory} — ${edgeProfiles.label(p)}${mark}`);
      });
      console.log('\nPick the one signed in to your tenant:  powercodex-lifecycle profiles use <number|email|directory>');
      break;
    }
    case 'dashboard': {
      console.log('Rendered', render(root));
      break;
    }
    case 'loop': {
      const rotations = Number.parseInt(flag('rotations'), 10) || 1;
      const fixModeArg = typeof flag('fix-mode') === 'string' ? flag('fix-mode') : 'manual';
      const summary = await runLoop(root, {
        fresh: flag('fresh') === true,
        rotations,
        simulate: flag('real') !== true,
        appUrl: typeof flag('app-url') === 'string' ? flag('app-url') : undefined,
        env: typeof flag('env') === 'string' ? flag('env') : undefined,
        fixMode: fixModeArg,
        maxHealRetries: Number.parseInt(flag('max-heal-retries'), 10) || 3,
      });
      console.log('\nSummary:', JSON.stringify(summary));
      console.log('Dashboard:', path.join(liveDir(root), 'index.html'));
      break;
    }

    case 'dataverse': {
      const sub = rest[0] || 'status';
      if (sub === 'init') {
        // Create the schema template file.
        const tableName = typeof flag('name') === 'string' ? flag('name') : undefined;
        const result = dataverseSchema.initSchema(root, {
          displayName: tableName || 'MyTable',
          pluralName: tableName ? tableName + 's' : 'MyTables',
        });
        if (result.created) {
          console.log('✓ Schema template created:', result.path);
          console.log('  Edit it to describe your tables and columns, then run:');
          console.log('  powercodex-lifecycle dataverse apply');
        } else {
          console.log('Schema file already exists:', result.path);
          console.log('  Edit it and run: powercodex-lifecycle dataverse apply');
        }
      } else if (sub === 'apply') {
        // Read schema and drive the browser to create tables + columns.
        const dryRun = flag('dry-run') === true;
        const envId = typeof flag('env') === 'string' ? flag('env') : undefined;
        console.log(dryRun ? 'Dry run — no browser will open.' : 'Opening managed Edge to apply schema…');
        const result = await dataverseSchema.applySchema(root, {
          environmentId: envId,
          dryRun,
          emit: async ({ level, message }) => {
            const icon = { good: '✓', warn: '⚠', bad: '✗', info: '·' }[level] || '·';
            console.log(`  ${icon} ${message}`);
          },
        });
        console.log(`\nDone. ${result.tables.length} table(s) processed · ${result.errors.length} error(s).`);
        if (result.errors.length) {
          for (const e of result.errors) console.log(`  ✗ ${e.table}${e.column ? `.${e.column}` : ''}: ${e.reason}`);
        }
        console.log('State written to .powercodex/dataverse.json');
      } else if (sub === 'status') {
        const schema = dataverseSchema.readSchema(root);
        const state = dataverseSchema.readState(root);
        if (!schema) {
          console.log('No schema file found. Run: powercodex-lifecycle dataverse init');
        } else {
          console.log(`Schema: ${(schema.tables || []).length} table(s) defined`);
          console.log(`State:  ${(state.tables || []).length} table(s) applied${state.appliedAt ? ` · last applied ${state.appliedAt}` : ''}`);
          for (const t of state.tables || []) {
            console.log(`  ${t.logicalName ? '✓' : '·'} ${t.displayName} → ${t.logicalName || '(logical name not yet captured)'}`);
            for (const c of t.columns || []) {
              console.log(`      ${c.logicalName ? '✓' : '·'} ${c.displayName} (${c.type}) → ${c.logicalName || '(not captured)'}`);
            }
          }
        }
      } else {
        console.log('Usage: powercodex-lifecycle dataverse <init|apply|status>');
        console.log('  init   [--name <TableName>]         create .powercodex/dataverse-schema.json template');
        console.log('  apply  [--env <envId>] [--dry-run]  open Edge, create tables/columns, write logical names');
        console.log('  status                               show schema intent vs applied state');
      }
      break;
    }

    case 'code-init': {
      // Wrap pac code init for the Power Apps Code App quick start.
      const appName = typeof flag('app-name') === 'string' ? flag('app-name') : rest[1] || 'MyPowerApp';
      const envUrl = typeof flag('env-url') === 'string' ? flag('env-url') : undefined;
      const outDir = typeof flag('out-dir') === 'string' ? flag('out-dir') : undefined;
      console.log(`Initialising Power Apps Code App "${appName}"…`);
      if (envUrl) console.log(`  Environment: ${envUrl}`);
      const result = await pacInit.initCodeApp(root, {
        appName,
        environmentUrl: envUrl,
        outputDir: outDir,
        emit: async ({ level, message }) => {
          const icon = { good: '✓', warn: '⚠', bad: '✗', info: '·' }[level] || '·';
          console.log(`  ${icon} ${message}`);
        },
      });
      if (result.initialised) {
        console.log(`\n✓ Code App ready at: ${result.appDir}`);
        console.log('  Next steps:');
        console.log('  1. npm install           (inside the generated app folder)');
        console.log('  2. npm run build         (build the app)');
        console.log('  3. powercodex-lifecycle code-push  (pac code push)');
      } else {
        console.error('\n✗ Initialisation failed:', result.error);
        process.exitCode = 1;
      }
      break;
    }

    case 'code-push': {
      // Push the built Code App to Power Apps using pac code push.
      const pushDir = typeof flag('app-dir') === 'string' ? flag('app-dir') : undefined;
      console.log('Pushing Code App to Power Apps…');
      const pr = await pacInit.pushCodeApp(root, {
        appDir: pushDir,
        emit: async ({ level, message }) => {
          const icon = { good: '✓', warn: '⚠', bad: '✗', info: '·' }[level] || '·';
          console.log(`  ${icon} ${message}`);
        },
      });
      if (pr.pushed) {
        console.log('\n✓ Push succeeded.');
      } else {
        console.error('\n✗ Push failed:', pr.error);
        process.exitCode = 1;
      }
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
