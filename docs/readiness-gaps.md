# PowerCodex — Readiness Gaps & Build Plan

_Last updated: 2026-06-08_

A prioritized, honest inventory of what is real, what is simulated, and what must be
built for PowerCodex to be a **fully autonomous app-builder** rather than a polished
demo. Items are ordered by impact. Each carries a status and the concrete files involved.

Status legend: ✅ done · 🟡 in progress · ⬜ not started

---

## P0 — Core capability: actually build the app

| # | Gap | Where | Status |
|---|-----|-------|--------|
| 1 | Build executor created nothing → **now authors real React/TS screens** (code engine) and **really creates a Dataverse table** (DOM slice), verifying before claiming success. | [codegen.js](../tools/lifecycle/lib/codegen.js), [engines.real.js](../tools/lifecycle/lib/engines.real.js), [maker-recipes.js](../tools/lifecycle/lib/maker-recipes.js) | ✅ |
| 2 | Loop was a scripted narrative → **tasks now come from the approved plan**, self-heal is real, build is real. | [loop.js](../tools/lifecycle/lib/loop.js) | ✅ |
| 3 | **Code-generation engine added** — deterministic-first, AI-enhanced, router-wired. | [codegen.js](../tools/lifecycle/lib/codegen.js), [planner.js](../tools/lifecycle/lib/planner.js) | ✅ |
| 4 | **Plan → tasks wired** through chat → intake → planner → loop. | [chat.html](../tools/lifecycle/assets/chat.html), [control.js](../tools/lifecycle/lib/control.js), [loop.js](../tools/lifecycle/lib/loop.js) | ✅ |
| 5 | **Real build verification** runs the project's own `npm run build` / `tsc` as the test gate. Live publish (`pac`/`power-apps push`) still gated behind the Publish switch. | [codegen.js `verifyBuild`](../tools/lifecycle/lib/codegen.js) | ✅ build / 🟡 publish |

## P1 — Correctness bugs (small, surgical)

| # | Bug | Where | Status |
|---|-----|-------|--------|
| 6 | **`refineStories` discards the LLM output** → now consumes it, preserving ids/sources/edits. | [stories.js](../tools/lifecycle/lib/stories.js) | ✅ |
| 7 | **`approve` action is decorative** → now a real gate the loop blocks on. | [control.js](../tools/lifecycle/lib/control.js), [loop.js](../tools/lifecycle/lib/loop.js) | ✅ |
| 8 | **`onTool` never wired** → forwarded through the CLI adapters with a tool-line detector. | [providers/_cli.js](../tools/lifecycle/lib/providers/_cli.js) | ✅ |

## P2 — Robustness / honesty of the real path

| # | Gap | Where | Status |
|---|-----|-------|--------|
| 9 | Real mode now **auto-engages for any code app** (no Playwright needed); desktop runs real by default; CLI `serve --real`. | [engines.js](../tools/lifecycle/lib/engines.js), [main.js](../../desktop/main.js) | ✅ |
| 10 | Self-heal is **real**: reverts a failed AI screen to the known-good generated version, then re-verifies. | [engines.js `heal`](../tools/lifecycle/lib/engines.js) | ✅ |
| 11 | App URL: build gate needs none; live-app smoke uses captured URL when present. Real `pac` push + URL capture still to wire. | [loop.js](../tools/lifecycle/lib/loop.js) | 🟡 |
| 12 | Build-output clutter (`release/`, `release2..4/`, `out-installer/`) from packaging retries. | desktop/ | ⬜ |

### Still open (needs a live environment to finish)
- **Compile proof on the maker's machine.** The generated TSX is verified to parse + transpile under TypeScript strict; the end-to-end `npm install && npm run build` could not run in this sandbox (registry blocked). Run once on a networked machine to confirm green.
- **Portal DOM selectors** for `dataverse.table.create` are best-effort until validated against a live tenant + MFA.
- **`pac code push`** (real publish) + app-URL capture; remaining recipes (column/connection/flow) DOM automation.

## P3 — Nice-to-have

- Power Platform environment import (today only local-folder import). [import.js](../tools/lifecycle/lib/import.js)
- AST-based digest instead of regex. [digest.js](../tools/lifecycle/lib/digest.js)
- Signed installer (currently unsigned local build). [build-installer.bat](../../desktop/build-installer.bat)

---

## The two paths to "actually builds"

PowerCodex targets **Power Apps Code Apps** — a Vite + React + TypeScript app deployed
with the `pac` CLI. There are two ways to "build":

1. **Code generation (reliable, testable, autonomous).** Author/modify the project's
   React/TS source from the plan, run a real `npm run build`, push with `pac`/`power-apps`,
   then smoke-test the running app. This runs entirely on the maker's machine, is
   deterministic, and degrades to a real scaffold when no AI CLI is present. **This is the
   spine of autonomy** and is what items 3–5 implement.

2. **Portal DOM automation (best-effort, tenant-only).** Drive the make.powerapps.com DOM
   to create Dataverse tables/columns/flows. Genuinely useful for data assets, but brittle
   and only verifiable against a live tenant + MFA. Implemented as the item-1 vertical slice
   for `dataverse.table.create`, behind the same consent gate, reporting `created` honestly.

Both run behind `Approved_rights/` and report success only after real verification.
