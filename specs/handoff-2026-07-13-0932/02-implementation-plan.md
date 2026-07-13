# 02 · Implementation Plan (Part 2: Execution Spec)

This is the exact workflow, data flow, preview/publish behavior, and harness contract. Phases are ordered by user-visible value; each phase leaves the product shippable.

## The target workflow (end to end)

```
Onboard ─► Describe/Import ─► Build ─► LIVE PREVIEW (localhost, mock data) ─► e2e loop ─► Publish (pac) ─► Live URL
   │             │                │            ▲        │                        │
   readiness     clarify if vague  agent edits ─┘        auto-fix → re-test      branch→PR→security gate (Rule 2)
   (4 checks)                      (HMR refresh)         escalate in plain lang
```

## Data flow (the seam that makes preview/publish honest)

Generated apps get a **data adapter layer** — the single most important new code pattern:

```
src/data/
  types.ts          # entity types the agent derives from the user's idea
  local.ts          # LocalDataSource: reads src/data/seed.json (mock data, per-entity)
  dataverse.ts      # DataverseDataSource: @microsoft/power-apps generated service classes
  index.ts          # export const data: DataSource =
                    #   import.meta.env.VITE_POWERCODEX_LIVE === '1' ? dataverse : local
```

- **Preview** (always): vite dev server, `VITE_POWERCODEX_LIVE` unset → local seed data. Never touches Dataverse. The agent generates `seed.json` rows that match the user's domain (not the generic id/title/owner/due/status table).
- **Publish**: build runs with `VITE_POWERCODEX_LIVE=1` → Dataverse source. Table creation follows repo Rule 1 (browser UI + logical names registered via the dataverse-specialist skill); logical names land in `dataverse.json` and are injected into `dataverse.ts`.
- Screens import only from `src/data` — they are identical in both modes. This is behaviorally what Lovable does with Supabase, translated to Dataverse.

## Preview behavior (G1, G5)

New module `tools/lifecycle/lib/preview.js` — the only new engine file:

- `start(root, {emit})`: if a server is already running for `root`, return it. Else spawn `npm run dev -- --port 0 --strictPort false` (vite picks a free port), parse the port from stdout, wait for HTTP 200 (bounded ~30s), return `{url, pid}`. Degrade honestly: no `node_modules` → run `npm install` first with a plain-language progress message; dev script missing → nudge, never fake a URL.
- `stop(root)`, `status(root)`. Process tied to the server lifetime; killed on app quit and project switch.
- Server endpoints: `POST /api/preview/start|stop`, `GET /api/preview/status`.
- UI: Canvas gets a **Preview | Code** toggle (Lovable pattern). Preview tab = iframe to the dev-server URL + device-width toggle + "Open in browser". Code tab = existing `/api/file` browser. The dev-server URL also becomes the **default `appUrl` for the e2e smoke test** — closing G7's `no-app-url` hole for local testing.
- Desktop scaffold switches from the generic `scaffold.js` template to the published starter (`templates/starter/`) so every desktop project has the harness, tests, and data-adapter layout from birth (G5). One scaffold, two entry points.

## Publish behavior (G2)

- Commit the uncommitted `registerCodeApp`/`pushCodeApp` loop wiring (it is correct and selftested), fix the duplicate `"mac"` key, then `npm run sync` so the desktop vendors the current engine.
- **Publish button** in the top bar (replaces the buried `allowPush` toggle as the user-facing act; the toggle remains the standing consent in `approval.json`):
  1. Preflight: pac installed → pac authed → environment selected. Each failure = plain-language guided fix (reuse `ensureAuth`, `preflight`).
  2. `registerCodeApp` if `power.config.json` absent.
  3. Dataverse step if the app uses live data: Rule 1 flow (browser UI creation + logical-name registration) before push.
  4. Build with `VITE_POWERCODEX_LIVE=1`, then `pushCodeApp`; parse the app URL from pac output; store via `setAppUrl`; show "Your app is live" card with the link.
  5. Stream every step to the chat thread as status events (the bus already supports this).
- Publish is **gated on a green e2e run** against the local preview (Rule 3). A failed suite blocks publish with a plain-language explanation and an auto-fix offer.

## Real testing loop (G6, G7, G8)

- Vendor Playwright with the desktop app (declare in `desktop/package.json`; the engine already lazy-imports it). The zero-dep claim stays true for the *library*; the *product* ships batteries.
- Generate a per-app Playwright suite from the plan's user stories (the starter's `e2e/` dir is the template): every screen visited, every interactive element exercised, happy + one error path per form — Rule 3's checklist, encoded.
- Run against the live preview URL. On failure: real fix loop (provider-driven edit → rebuild → re-run), not revert-to-generic. `heal()`'s revert becomes the *last* resort, labeled honestly ("I couldn't fix your screen, so I restored the last working version").
- **Delete the injected defect** (`injectDefect`, rotation-1 theater) from real mode entirely; keep it only under `simulate`.

## Harness requirements (what the agent must be given)

- The harness preamble (`harness.js compose()`) gains two new bias rules: (a) generated screens must import data only from `src/data`; (b) every generated screen ships with a Playwright spec. Keep them behavioral (L002).
- Fix-mode defaults stay: first self-heal automatic, then escalate to the user in plain language with the troubleshooting history (spec §4 System Behaviors).
- PRD sync: on every applied change, append a revision to the project's Project PRD artifact (the plans/artifacts store already exists; this is a fold-in, not new infra).
- Onboarding adds the **Power Platform VS Code extension** check (`code --list-extensions | grep microsoft-IsvExpTools.powerplatform-vscode`, auto-install via `code --install-extension`) to match spec §4 (G10).

## Phases

**Phase 0 — Land what exists (small, immediate).** Commit the pac wiring + selftests; fix duplicate `mac` key; delete stale `build-out` asar; fix `rights.js:15` and `engines.real.js:8` stale comments; remove dead `require` in `learning.mjs`; add `verify` + `lifecycle:selftest` to CI. *Exit: CI green with both suites.*

**Phase 1 — Live preview.** `preview.js` + server endpoints + Preview/Code toggle + starter-template scaffold unification. *Exit: prompt → app visibly running on localhost with mock data; agent edit → HMR refresh.*

**Phase 2 — Data seam.** Data-adapter pattern into starter + codegen; domain-shaped seed data from the plan; screens consume the adapter. *Exit: generated app renders user-domain data locally; switching the env flag compiles against the Dataverse source.*

**Phase 3 — Real publish.** Publish button + preflight + register + push + live URL card; Dataverse Rule 1 flow for live-data apps; e2e-green gate. *Exit: one click from preview to a real Power Apps URL on a test environment.*

**Phase 4 — Honest testing loop.** Playwright vendored; suite generated from stories; real fix loop; theater removed. *Exit: Rule 3 loop runs unattended and blocks publish on red.*

**Phase 5 — Production hardening.** Chat persistence (`.powercodex/chat.json`, same replay pattern as the bus); onboarding extension check; packaging (signing decision, mac wrapper parity, icon); fresh-machine install smoke test on Windows + macOS. *Exit: installer → onboarding → build → preview → publish on a clean machine.*

Dependencies: 0 → 1 → 2 → 3; 4 needs 1 (preview URL) and parallels 3; 5 is parallel after 1. Task-level detail in [03-task-breakdown.md](03-task-breakdown.md); verification gates in [04-qa-checklist.md](04-qa-checklist.md).

## Process rules for every phase

- Feature branch → PR → Dependabot/CodeQL clean → merge (repo Rule 2). Never commit to `main`.
- Every task ends with its QA-checklist row demonstrated, not asserted (evidence: command output, screenshot, or selftest check id).
- Every engine change extends `selftest.js` in the same PR (the codebase's own convention — see the Gap #2 block).
- Mistakes caught mid-task are logged to `Learning_Experience/` before continuing (repo Rule 4).
