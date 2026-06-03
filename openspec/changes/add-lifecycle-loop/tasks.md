## 1. Lifecycle engine

- [x] 1.1 Add the append-only status bus (`lib/bus.js`) with `emit`/`readEvents`/`reset`.
- [x] 1.2 Add the `Approved_rights/` consent gate (`lib/rights.js`) with default flags and `allowed()`.
- [x] 1.3 Add build-executor and e2e-tester engine adapters (`lib/engines.js`) with a simulation fallback.
- [x] 1.4 Add the loop orchestrator (`lib/loop.js`): Intake → Plan → Approve → Build → Run → Test → Observe, self-heal, and guardrails (rights gate, no-progress detector, pause hook).
- [x] 1.5 Add the derived-state reader (`lib/state.js`) reducing events + rights + lessons into one snapshot.

## 2. Live dashboard + control

- [x] 2.1 Add the static dashboard renderer (`lib/dashboard.js`) written on every event.
- [x] 2.2 Add the live server (`lib/server.js`) exposing `/api/state`, `/api/action`, `/api/emit`.
- [x] 2.3 Add the controller (`lib/control.js`): intake, rights toggle, start/pause/resume/approve/reset.
- [x] 2.4 Add the interactive client (`assets/dashboard.html`): intake form, control bar, clickable rights, loop strip, agent cards, feed, coverage, observations, lessons.
- [x] 2.5 Add the CLI (`bin/powercodex-lifecycle.js`) with `serve`, `loop`, `emit`, `init`, `dashboard`, `selftest`.

## 3. Ship into the starter

- [x] 3.1 Copy the tool into `templates/starter/tools/lifecycle/` with a CommonJS marker `package.json`.
- [x] 3.2 Add `lifecycle`, `lifecycle:serve`, `lifecycle:selftest` scripts to `templates/starter/package.json`.
- [x] 3.3 Ignore `.powercodex/` and `Approved_rights/` in the starter `.gitignore` and `.prettierignore`.
- [x] 3.4 Document the live dashboard in the root `README.md`.

## 4. Verification

- [x] 4.1 Add a `selftest` that asserts all 7 stages emit, build/test run, self-heal fires, the server answers, control actions apply, and the rights gate blocks. (20/20)
- [x] 4.2 Run `selftest` from both the repo and the starter copy.
- [x] 4.3 Run `npm run verify` and extend it to assert the lifecycle tool + automation scaffold ship in generated projects.
- [x] 4.4 Run `openspec validate add-lifecycle-loop --strict` and resolve any issues.

## 5. Refinements (local, no tenant)

- [x] 5.1 Real goal↔MVP compliance scoring (`lib/compliance.js`) wired into loop intake + state + dashboard meter.
- [x] 5.2 MVP proposer (`lib/mvp.js`) — generate an HTML MVP from a goal, via CLI and dashboard button.
- [x] 5.3 Reflection step (`lib/reflect.js` + `opsx-reflect.prompt.md`) writing `Learning_Experience` lessons.
- [x] 5.4 Computed Insights (`lib/insights.js`) + notifications surfaced in the dashboard.
- [x] 5.5 Auto-open dashboard (`serve --open`).
- [x] 5.6 Wire `opsx-new` / `opsx-continue` / `opsx-ff` to the HTML-artifact convention; add the `config.yaml` design-eng rule.
- [x] 5.7 Expand the self-test to cover all the above (31/31).

## 6. Follow-ups (need a tenant — separate change)

- [ ] 6.1 Replace simulated engines with real Playwright-for-MDM adapters (the `automation/` scaffold).
- [ ] 6.2 Real observer that diffs the live app vs the approved MVP and renders `preview.html`.
