# PowerCodex — Live Validation Checklist

_Last updated: 2026-07-15_

Everything in Tiers 1–7 is built and tested **offline** (139 selftest checks + 29
integration tests, all green). But several paths can only be *proven* on a real machine
with a real Power Platform tenant, real `pac`, real Playwright/Chromium, and network
access to the npm registry and GitHub. None of that exists in the CI/build sandbox, so
this checklist is the remaining work only **you** can run. Do these in order — each one
de-risks the ones below it.

## Tier 0 — prove the wired paths against reality (do first)

- [ ] **Real dependency install + build.** In a generated project: `npm install` then
      `npm run build`. Confirm it goes green. (Verified offline only as TS-parse/transpile;
      the full install+build has never run — registry was blocked.)
- [ ] **Live preview.** Click **▶ Preview**. Confirm the Vite dev server starts, the URL
      is captured, and the app renders in the Canvas. Try a data screen and confirm the
      mock rows show (`VITE_POWERCODEX_MOCK=1`).
- [ ] **Real element test.** `npm i -D playwright`, then click **🧪 Test**. Confirm it
      enumerates real elements, exercises them, and reports genuine pass/fail. Introduce a
      deliberate bug and confirm it's caught; click **🔧 Fix these** and confirm the fix +
      build-verify loop.
- [ ] **Publish end-to-end.** With `pac` installed and authed, click **🚀 Publish**.
      Confirm `pac auth → pac code init → pac code push` runs and a live URL is captured.
      **Check the URL-capture regex** in `publish.js` `extractAppUrl` against your real
      `pac code push` output — adjust if the format differs.
- [ ] **Dataverse table creation.** Validate the portal DOM selectors in
      `engine/mdm-attach.mjs` (`createDataverseTable`, `addDataverseColumn`) against live
      `make.powerapps.com` + MFA. They are best-effort and have never run on a tenant.

## Tier 2 — data autonomy (needs the above green)

- [ ] Wire the loop to generate Dataverse tasks for code apps (today the code-app loop
      only emits `code.screen` tasks; table provisioning is a separate CLI/MCP action).
- [ ] Prefer API/`pac`-based provisioning over browser-DOM where the tenant allows it.
- [ ] Automate connection + flow creation (today navigate-only).
- [ ] Have codegen emit screens that bind to the `@/data` seam so preview data flows end
      to end (the seam + mock generator are done; the screen-binding is the follow-on).

## Tier 4 — governance against a real PR

- [ ] Set `GITHUB_TOKEN` (or `GH_TOKEN`). Push a branch, open a PR, and confirm
      `governance.gatePublish` reads real check-runs and blocks until CodeQL/Dependabot
      are green. (Decision logic + git ops are tested; live check-run polling is the seam.)

## Tier 5 — distribution

- [ ] Build a **signed** installer: set `CSC_LINK`/`CSC_KEY_PASSWORD` (Windows/macOS
      identity) and, for macOS notarization, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/
      `APPLE_TEAM_ID` + `npm i -D @electron/notarize`. Confirm Gatekeeper accepts it.
- [ ] Stand up an update feed and set `POWERCODEX_UPDATE_FEED` (+ bundle
      `electron-updater`). Confirm background update delivery.
- [ ] Add real app icons (`desktop/build/icon.ico` / `icon.icns`).

## What is already proven offline (no live run needed)

- Preview start/URL-capture/reuse/stop (real child process, fake dev server).
- The full e2e engine: element planning, representative data, failure classification,
  heal loop (green + no-progress + non-compiling-fix paths) — via a fake driver.
- Publish consent gate + URL extraction + pac-absent handling.
- Timeout guards + `pac` hard-kill on hang.
- Mock-data generation from a schema, typed by column.
- Governance: remote parsing, security-check classification, protected-branch block,
  feature-branch creation — via a temp git repo + injected status.
