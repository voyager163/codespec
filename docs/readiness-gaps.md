# PowerCodex — Readiness Gaps & Build Plan

_Last updated: 2026-07-15_

A prioritized, honest inventory of what is real, what is simulated, and what must be
built for PowerCodex to be a **fully autonomous app-builder** rather than a polished
demo. Items are ordered by impact. Each carries a status and the concrete files involved.

Status legend: ✅ done · 🟡 in progress · ⬜ not started

> **Live validation still required.** Everything below is built and tested offline
> (139 selftest checks + 29 integration tests). The tenant/registry/creds-dependent paths
> can only be *proven* on your machine — see [live-validation-checklist.md](./live-validation-checklist.md).

---

## Production-readiness build — Tiers 1–7 (2026-07-15)

| Tier | What shipped | Where | Status |
|------|--------------|-------|--------|
| 1 | **Real element-level e2e** (enumerate every input/button/select/link, representative data, exercise, classify real failures) + **heal loop** (fix → rebuild → re-test, no-progress detection) + a verified **fix** action. Wired into the loop's e2e stage for on-device apps and a 🧪 Test button. | [e2e.js](../tools/lifecycle/lib/e2e.js), [engines.real.js](../tools/lifecycle/lib/engines.real.js), [server.js](../tools/lifecycle/lib/server.js), [chat.html](../tools/lifecycle/assets/chat.html) | ✅ built + tested (Playwright run is live-only) |
| 3 | **Preview with mock data** — a `@/data` seam scaffolded into new apps + a schema-driven mock generator, so data screens render with no DB. | [mockdata.js](../tools/lifecycle/lib/mockdata.js), [scaffold.js](../tools/lifecycle/lib/scaffold.js), [preview.js](../tools/lifecycle/lib/preview.js) | ✅ seam + generator (codegen binding screens is the follow-on) |
| 4 | **Governance gate (Rule 2)** — block publishing off a protected branch; gate on CodeQL/Dependabot check-runs; feature-branch + commit + push git ops. | [governance.js](../tools/lifecycle/lib/governance.js), [publish.js](../tools/lifecycle/lib/publish.js) | ✅ logic + git ops tested (PR/check polling is the live seam) |
| 5 | **Distribution hardening** — honest "no AI connected → templated" banner, signing/notarize config + afterSign hook, auto-update seam, version 0.3.0. | [chat.html](../tools/lifecycle/assets/chat.html), [desktop/main.js](../../desktop/main.js), [desktop/package.json](../../desktop/package.json) | ✅ wired (needs signing creds + feed to activate) |
| 6 | **Reliability** — hard timeouts (`withTimeout`/`deadline`), `pac` hard-kill on hang, preview crash surfacing, 29 dependency-free integration tests. | [timeout.js](../tools/lifecycle/lib/timeout.js), [pac-init.js](../tools/lifecycle/lib/pac-init.js), [preview.js](../tools/lifecycle/lib/preview.js), [__tests__/](../tools/lifecycle/__tests__/) | ✅ done + tested |
| 7 | **Template parity** — the six new modules + updated server/scaffold/engines/chat mirrored into the generated-project starter. | [templates/starter/tools/lifecycle](../templates/starter/tools/lifecycle) | ✅ synced (template selftest green) |

Remaining tenant-dependent work (Tier 0 validation, Tier 2 data autonomy, live Tier 4/5)
lives in [live-validation-checklist.md](./live-validation-checklist.md).

---

## P0 — Core capability: actually build the app

| # | Gap | Where | Status |
|---|-----|-------|--------|
| 1 | Build executor created nothing → **now authors real React/TS screens** (code engine) and **really creates a Dataverse table** (DOM slice), verifying before claiming success. | [codegen.js](../tools/lifecycle/lib/codegen.js), [engines.real.js](../tools/lifecycle/lib/engines.real.js), [maker-recipes.js](../tools/lifecycle/lib/maker-recipes.js) | ✅ |
| 2 | Loop was a scripted narrative → **tasks now come from the approved plan**, self-heal is real, build is real. | [loop.js](../tools/lifecycle/lib/loop.js) | ✅ |
| 3 | **Code-generation engine added** — deterministic-first, AI-enhanced, router-wired. | [codegen.js](../tools/lifecycle/lib/codegen.js), [planner.js](../tools/lifecycle/lib/planner.js) | ✅ |
| 4 | **Plan → tasks wired** through chat → intake → planner → loop. | [chat.html](../tools/lifecycle/assets/chat.html), [control.js](../tools/lifecycle/lib/control.js), [loop.js](../tools/lifecycle/lib/loop.js) | ✅ |
| 5 | **Real build verification** runs the project's own `npm run build` / `tsc` as the test gate. | [codegen.js `verifyBuild`](../tools/lifecycle/lib/codegen.js) | ✅ |
| 5a | **Live localhost preview** — a real Vite dev server for the active project, shown in the Canvas, no Dataverse/auth needed. Button in the UI. | [preview.js](../tools/lifecycle/lib/preview.js), [server.js](../tools/lifecycle/lib/server.js), [chat.html](../tools/lifecycle/assets/chat.html) | ✅ wired |
| 5b | **In-app Publish to Power Platform** — a consent-gated action wiring the real `pac` flow (build gate → `pac auth` → `pac code init` → `pac code push` → capture live URL). Button + modal in the UI. | [publish.js](../tools/lifecycle/lib/publish.js), [server.js](../tools/lifecycle/lib/server.js), [chat.html](../tools/lifecycle/assets/chat.html) | ✅ wired / ⏳ unproven on a live tenant |

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

### Resolved 2026-07-16
- ✅ **Compile proof (real install + build).** A freshly scaffolded project runs `npm install` (480 pkgs) and `npm run build` (`tsc -b && vite build`) fully green on a networked machine — confirmed this session, no longer sandbox-blocked.
- ✅ **Template mirror.** `templates/starter/tools/lifecycle` ships `preview.js`, `publish.js`, `mockdata.js`, `timeout.js`, `e2e.js`, `governance.js` — generated projects get the same Preview/Publish (Tier 7 sync verified).
- ✅ **Generated-project security.** A fresh install flagged 4 moderate vulns (transitive `uuid <11.1.1` via `@microsoft/power-apps` → `msal-node`). Fixed with an npm `overrides: { uuid: ^11.1.1 }` pin in the starter `package.json`; re-verified **0 vulnerabilities** + build still green.

### Still open (needs a live environment to finish)
- **Portal DOM selectors** for `dataverse.table.create` are best-effort until validated against a live tenant + MFA.
- **Publish (`pac code init`/`pac code push`)** is now wired end-to-end into the UI ([publish.js](../tools/lifecycle/lib/publish.js)) and captures the app URL, but has **not been run against a real tenant** (no `pac`/tenant in the build sandbox). First live run must confirm the auth → init → push sequence and the URL-capture regex against real `pac` output.
- **Preview → publish continuity:** the localhost preview is real; the same app should be the one published. Verify the preview's built output matches what `pac code push` ships once run live.
- Remaining Dataverse recipes (column/connection/flow) DOM automation.

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
