# 03 · Task Breakdown

Each task is sized for **one focused session by one executor model**. Model routing: `Sonnet` = well-specified mechanical/wiring work; `Opus` = design-sensitive or cross-cutting work. Every task: feature branch → PR → security gate (Rule 2), selftest extended in the same PR when the engine changes, QA row from [04-qa-checklist.md](04-qa-checklist.md) demonstrated before the PR is opened. Before starting any task, run the pre-task questions in [05-reflective-prompt-pack.md](05-reflective-prompt-pack.md); after finishing, the post-task questions.

## Phase 0 — Land what exists

| ID | Task | Model | Depends on |
| --- | --- | --- | --- |
| 0.1 | Fix duplicate `"mac"` key in `desktop/package.json`; delete stale `desktop/build-out/` asar (already gitignored); commit the staged deletion. | Sonnet | — |
| 0.2 | Commit the pac wiring (`loop.js`, `pac-init.js`, `selftest.js` uncommitted diff) after running `npm run lifecycle:selftest` locally; update stale comments `rights.js:15` (`npx power-apps push` → `pac code push`) and `engines.real.js:8` (Engine 1 *does* have real navigation now). | Sonnet | 0.1 |
| 0.3 | Remove dead `nextId()` with ESM-broken `require` in `src/mcp/tools/learning.mjs` (handler has its own inline logic); run MCP tests. | Sonnet | — |
| 0.4 | CI: add jobs for `npm run verify` and `npm run lifecycle:selftest` to `.github/workflows/ci.yml`; replace the verifier's hardcoded 12/11 counts with directory-derived counts. | Sonnet | 0.2 |

## Phase 1 — Live preview

| ID | Task | Model | Depends on |
| --- | --- | --- | --- |
| 1.1 | Create `tools/lifecycle/lib/preview.js` (`start`/`stop`/`status` per the execution spec: free-port vite spawn, stdout port parse, bounded readiness wait, `npm install` bootstrap, honest nudges, process cleanup on exit). Selftest: degrade contract with an injected spawn boundary (mirror the `_pac` pattern). | Opus | 0.2 |
| 1.2 | Server endpoints `POST /api/preview/start|stop`, `GET /api/preview/status` in `server.js`; kill preview on project switch and shutdown; extend the CSRF-guarded mutating set. | Sonnet | 1.1 |
| 1.3 | Canvas → **Preview \| Code** toggle in `chat.html`: Preview tab iframes the dev-server URL (loading/empty/error states per spec §4 Resilience); Code tab keeps the existing file browser; "Open in browser" + width toggle. | Opus (UI judgment) | 1.2 |
| 1.4 | Loop integration: in real on-device mode, after a green build, call `preview.start` and emit the real URL (replacing the narrative `npm run dev` string at `loop.js:216-222`); preview URL becomes default e2e `appUrl`. | Sonnet | 1.1 |
| 1.5 | Scaffold unification: desktop/CLI "Create a new app" uses `templates/starter/` (or a slimmed copy) instead of `scaffold.js`'s generic template; verify harness files, e2e dir, and scripts arrive; keep `scaffold.js` as fallback when templates are unavailable offline. | Opus | — |
| 1.6 | `npm run sync` + rebuild desktop; manual smoke: create project → build → preview renders in Canvas. | Sonnet | 1.1–1.5 |

## Phase 2 — Data seam

| ID | Task | Model | Depends on |
| --- | --- | --- | --- |
| 2.1 | Add `src/data/` adapter pattern (types/local/dataverse/index + `seed.json`) to `templates/starter/`; `LocalDataSource` is a persisted writable store (D13): seeds from `seed.json` on first run, full CRUD out of localStorage per entity, plus a "Reset sample data" hook the Preview tab can call; unit tests for seed + CRUD + reset; `VITE_POWERCODEX_LIVE` switch. Dataverse source compiles without a live tenant (typed stubs until logical names are injected). | Opus | 1.5 |
| 2.2 | Codegen: derive entity types + domain-shaped `seed.json` from the approved plan/goal (planner already extracts capabilities); generated screens import from `src/data` instead of inline `SAMPLE` arrays. Harness preamble gains the two bias rules (data-seam + spec-per-screen), phrased behaviorally (L002). | Opus | 2.1 |
| 2.3 | Dataverse injection: when `dataverse.json` logical names exist, generate the typed Dataverse source (service-class pattern from the Code Apps SDK docs); selftest with a fixture `dataverse.json`. | Opus | 2.1 |

## Phase 3 — Real publish

| ID | Task | Model | Depends on |
| --- | --- | --- | --- |
| 3.1 | Server endpoint `POST /api/publish` orchestrating preflight → register → (Dataverse Rule 1 flow if live data) → `VITE_POWERCODEX_LIVE=1` build → `pushCodeApp` → app-URL capture; every step emitted to the bus; honest failure at each step. | Opus | 0.2, 2.3 |
| 3.2 | Publish button + progress card + "Your app is live" card in `chat.html`; preflight failures render as guided fixes (install pac / sign in / pick environment), reusing the setup-gate modal pattern. | Sonnet | 3.1 |
| 3.3 | Gate publish on the last e2e result being green; red → plain-language block + auto-fix offer. | Sonnet | 3.1, 4.2 |
| 3.4 | Live validation on a real test environment: publish a generated app end-to-end; validate Dataverse maker-recipe selectors against the live tenant (closes the `maker-recipes.js` TODOs); record outcomes in `Learning_Experience/`. | Opus + human (Manfred: tenant, MFA) | 3.1–3.3 |

## Phase 4 — Honest testing loop

| ID | Task | Model | Depends on |
| --- | --- | --- | --- |
| 4.1 | Declare Playwright in `desktop/package.json` and confirm the packaged app can drive it (asar-unpacked if needed); remove the "only if the project has it" constraint for the smoke test. | Sonnet | 1.6 |
| 4.2 | Spec generation: from plan user stories, emit Playwright specs into the project's `e2e/` (visit every screen, exercise every element, happy + error path per form — Rule 3 encoded); run them against the preview URL as the loop's test step. | Opus | 1.4, 2.2 |
| 4.3 | Real fix loop: on red, provider-driven fix (with troubleshooting history in the prompt) → rebuild → re-run, bounded by `maxHealRetries`; `heal()` revert becomes the labeled last resort; delete `injectDefect` from real mode. | Opus | 4.2 |

## Phase 5 — Production hardening

| ID | Task | Model | Depends on |
| --- | --- | --- | --- |
| 5.1 | Chat persistence: append thread turns to `.powercodex/chat.json`, replay on boot (same pattern as the bus); cap + rotate. | Sonnet | — |
| 5.2 | Onboarding: add Power Platform VS Code extension check + auto-install to `setup.js` readiness and the setup gate UI (spec §4 order). | Sonnet | — |
| 5.3 | Packaging: single `mac` block; route `dist:mac` through the build wrapper (or document why not); app icon; decide signing (ad-hoc + documented Gatekeeper bypass vs certs — decision D8). | Sonnet | 0.1 |
| 5.4 | Fresh-machine smoke: clean Windows VM + clean macOS: install → onboard → build → preview → (mock) publish preflight. Record a QA transcript in the handoff folder. | Sonnet + human | 5.1–5.3, 1.6 |

## Standing rules for executors

- **Never** widen a task's scope silently; if the task is wrong or underspecified, stop and say so (see prompt pack §A3).
- Simulated mode must keep working after every change — it is the demo/test surface, not legacy.
- Anything you can't verify (no tenant, no pac, no MFA) is **blocked-honest**: implement to the boundary, test with an injected fake (the `_pac` pattern), and hand the live validation to a human-in-the-loop task (3.4, 5.4).
