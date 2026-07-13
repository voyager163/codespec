# 04 · QA Checklist

Rule: a task is done when its rows here are **demonstrated with evidence** (command output, screenshot, or selftest check id) — never asserted. Blocked-honest rows (need a live tenant/human) are marked ⛔ and belong to tasks 3.4 / 5.4.

## Phase 0 — Land what exists

- [ ] `node -e "JSON.parse(require('fs').readFileSync('desktop/package.json'))"` passes and contains exactly one `"mac"` block.
- [ ] `git ls-files desktop/build-out` returns nothing.
- [ ] `npm run lifecycle:selftest` → all checks pass, including the four Gap #2 `registerCodeApp` checks.
- [ ] `npm test` (MCP) green; no `require(` remains in `src/mcp/tools/learning.mjs`.
- [ ] `grep -rn "npx power-apps push" tools/lifecycle/lib/` returns nothing.
- [ ] CI run on the PR shows `verify` + `lifecycle:selftest` jobs green on ubuntu and windows.

## Phase 1 — Live preview

- [ ] Selftest: `preview.start` with an injected spawn boundary returns `{url}` on success; missing dev script → `started:false` + plain-language nudge; **no fabricated URL on any failure path**.
- [ ] Manual: create project in desktop → build → Canvas Preview tab shows the running app at a real `127.0.0.1:<port>` (screenshot).
- [ ] Manual: edit a generated screen via agent chat → preview reflects the change without manual reload (HMR).
- [ ] Manual: project switch and app quit kill the dev-server process (`ps` before/after).
- [ ] Empty state: no build yet → Preview tab shows the guided "nothing built yet" state, not a broken iframe (spec §4 Resilience).
- [ ] `curl -X POST -H "Origin: https://evil.example" http://127.0.0.1:<port>/api/preview/start` → 403 (CSRF guard extended).
- [ ] Desktop-scaffolded project contains the starter's harness files, `e2e/`, and test scripts (`diff` against `templates/starter` manifest).

## Phase 2 — Data seam

- [ ] Starter unit tests green for `LocalDataSource` (reads seed.json, typed rows).
- [ ] `npm run build` green with `VITE_POWERCODEX_LIVE` unset **and** `=1` (Dataverse source compiles with stub types before logical names exist).
- [ ] Generated app for a domain prompt (e.g. "track gym class attendance") renders **domain-shaped** seed data — field names match the domain, not id/title/owner/due/status (screenshot).
- [ ] `grep -rn "SAMPLE" <generated-project>/src/pages/` returns nothing; screens import from `src/data`.
- [ ] Selftest: fixture `dataverse.json` → generated Dataverse source contains the captured logical names.

## Phase 3 — Real publish

- [ ] Preflight ladder demonstrated: pac absent → guided install; unauthed → guided sign-in; no environment → picker. Each shows plain language, no stack traces (screenshots).
- [ ] Publish on a non-registered project runs `pac code init` first (`power.config.json` appears) then `pac code push`.
- [ ] ⛔ Live: published app opens at a real `apps.powerapps.com` URL and renders with Dataverse data (task 3.4, human-verified).
- [ ] ⛔ Live: Dataverse table creation via browser UI captures logical names; app registers them (Rule 1, task 3.4).
- [ ] Publish with red e2e is blocked with a plain-language explanation + auto-fix offer (forced-red test).
- [ ] Simulated mode still narrates the full publish story without touching pac (`--demo` run transcript).

## Phase 4 — Honest testing loop

- [ ] Packaged desktop app (not dev mode) runs the Playwright smoke against the preview URL (log excerpt from inside the installed app).
- [ ] Generated `e2e/` suite for a two-screen app: every screen visited, every button clicked, every input filled, form happy + error path (spec file listing + green run).
- [ ] Forced failure (broken screen committed) → fix loop runs provider-fix → rebuild → re-run and converges within `maxHealRetries`; transcript shows the troubleshooting history in the fix prompt.
- [ ] Revert path is labeled: when the fix loop exhausts retries, the user sees "restored the last working version" — not "fixed".
- [ ] `grep -n "injectDefect" tools/lifecycle/lib/loop.js` shows it referenced only under simulate.

## Phase 5 — Production hardening

- [ ] Reload the desktop app mid-conversation → full chat thread restored from `.powercodex/chat.json`.
- [ ] Readiness reports all four spec items; missing Power Platform VS Code extension → auto-install demonstrated (`code --list-extensions` before/after).
- [ ] Fresh Windows VM: installer → onboarding → build → preview, no dev tooling preinstalled beyond spec prerequisites (QA transcript).
- [ ] Fresh macOS: DMG opens (Gatekeeper path documented if unsigned) → same flow (QA transcript).
- [ ] ⛔ Full Rule 3 suite against a **published production** app URL, green, before any completion claim to the user (task 5.4 + 3.4 combined).

## Regression invariants (checked every phase)

- [ ] `npm run lifecycle:selftest` and `npm test` green.
- [ ] Simulated/demo mode works end-to-end with **zero** prerequisites installed.
- [ ] No secrets in the repo (`gitleaks` or CodeQL clean on the PR); server still binds 127.0.0.1 only.
- [ ] Every user-facing failure message readable by a non-technical person (spot-check 3 random failure paths per phase).
