## Why

PowerCodex scaffolds a Power Apps Code App and an OpenSpec workflow, but a developer has no way to *watch* the autonomous app-lifecycle loop (plan → build → run → test → observe) or control it. The master plan (`docs/plans/powercodex-master-plan.html`) calls for a live dashboard as the first deliverable so the rest of the system can be built and monitored in the open. This change adds that loop and its live monitoring/control surface to every generated project.

## What Changes

- Add a zero-dependency **PowerCodex Lifecycle** tool under `templates/starter/tools/lifecycle/` so every scaffolded project includes it.
- Add an append-only status bus (`.powercodex/live/status.json`) that every agent emits to, and a derived-state reader that powers the dashboard.
- Add an `Approved_rights/` consent gate read before build/push, with the loop stopping when a required flag is false.
- Add a loop orchestrator covering Intake → Plan → Approve → Build → Run → Test → Observe, with guardrails (rights gate, no-progress detector) and a self-heal step on test failure.
- Add build-executor and e2e-tester **engine adapters** that emit the real event stream but run in simulation until real Playwright-for-MDM adapters are wired.
- Add a **live dashboard server** (`serve`) exposing `/api/state`, `/api/action`, and `/api/emit`, plus an interactive client that polls and renders intake/rights, the loop strip, per-agent progress, the activity feed, test/MVP coverage, observations, and `Learning_Experience` lessons.
- Add control actions from the dashboard: set goal/MVP intake, toggle `Approved_rights/` flags, start/pause/approve/reset the loop, and an `emit` command so any process can post progress to the board.
- Add a `selftest` command that runs the product against itself and asserts it works.
- Add `lifecycle`, `lifecycle:serve`, and `lifecycle:selftest` scripts to the starter `package.json`; ignore generated `.powercodex/` and `Approved_rights/`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `powercodex-initializer`: Generated projects include the PowerCodex Lifecycle tool and its live monitoring/control dashboard.

## Impact

- Adds `templates/starter/tools/lifecycle/**` (bin, lib, assets, README, CommonJS marker `package.json`).
- Updates `templates/starter/package.json` scripts, `templates/starter/.gitignore`, and `templates/starter/.prettierignore`.
- Updates the root `README.md` to document the live dashboard.
- Updates the `powercodex-initializer` spec to describe the generated lifecycle tool and dashboard.
- Engine adapters are simulated; real managed-Edge Playwright automation (Plan B) and HTML-spec authoring (Plan A) are tracked as follow-up changes.
