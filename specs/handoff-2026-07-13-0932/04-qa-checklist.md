# 04 · QA Checklist

Rule: a task is done when its rows here are **demonstrated with evidence** (command output, screenshot, or selftest check id) — never asserted. Blocked-honest rows (need a live tenant/human) are marked ⛔ and belong to tasks 3.4 / 5.4.

## Phase 0 — Land what exists

- [x] `node -e "JSON.parse(require('fs').readFileSync('desktop/package.json'))"` passes and contains exactly one `"mac"` block. Evidence: commit `73cf9f2`.
- [x] `git ls-files desktop/build-out` returns nothing. Evidence: asar deletion in commit `73cf9f2`.
- [x] `npm run lifecycle:selftest` → all checks pass, including the four Gap #2 `registerCodeApp` checks. Evidence: 126/126 at time of Phase 0 (commit `6f6b80d`), 160/160 current.
- [x] `npm test` (MCP) green; no `require(` remains in `src/mcp/tools/learning.mjs`. Evidence: commit `ce1ba6e`, 28/28.
- [x] `grep -rn "npx power-apps push" tools/lifecycle/lib/` returns nothing. Evidence: commit `6f6b80d`.
- [x] CI run on the PR shows `verify` + `lifecycle:selftest` jobs green on ubuntu and windows. Evidence: PR #14, jobs added in commit `204818a`; all checks (Analyze, CodeQL, GitGuardian) green as of commit `3a5d739`.

## Phase 1 — Live preview

- [x] Selftest: `preview.start` with an injected spawn boundary returns `{url}` on success; missing dev script → honest `{ok:false}` + plain-language nudge; **no fabricated URL on any failure path**. Evidence: `npm run lifecycle:selftest` → 160/160 (preview.js checks, `selftest.js`). **Also verified for real** (not just injected fakes): scaffolded a real project (`bin/create-powercodex.js`), `npm install`, called `preview.start()` directly — real vite spawned, real port parsed from stdout, real HTTP 200, response body confirmed `<title>Power Apps</title>` + `id="root"` + `/@vite/client` (genuine app shell + HMR client, not an error page). `preview.stop()` confirmed to actually kill the process (post-stop fetch fails). Degrade path re-verified against a project with no `package.json`/no `dev` script: honest `{ok:false, message}`, never threw, never fabricated a URL.
- [ ] Manual: create project in desktop → build → Canvas Preview tab shows the running app at a real `127.0.0.1:<port>` (screenshot). ⛔ Blocked-honest: no Electron runtime or browser available from this seat to drive the actual desktop UI — the underlying mechanism (preview.js + the two HTTP routes) is proven above and via the CSRF/route check below; only the literal click-through in the packaged app remains unverified. Human task: launch the desktop app, create a project, click Preview.
- [ ] Manual: edit a generated screen via agent chat → preview reflects the change without manual reload (HMR). ⛔ Blocked-honest: same as above — requires the desktop UI + an actual agent-driven edit loop.
- [x] Manual: project switch and app quit kill the dev-server process. Evidence: `preview.stop()` verified for real (see above) — process confirmed dead via a failed fetch after stop, not just an in-memory flag. `openProject()`'s stop-before-reassign and `desktop/main.js`'s `stopAll()` on quit are code-path-verified (selftest + reading) but the literal Electron `app.on('quit')` event was not triggered from this seat — ⛔ that slice remains for the desktop manual pass.
- [ ] Empty state: no build yet → Preview tab shows the guided "nothing built yet" state, not a broken iframe (spec §4 Resilience). ⛔ Blocked-honest: requires visual/browser confirmation.
- [x] `curl -X POST -H "Origin: https://evil.example" http://127.0.0.1:<port>/api/preview/start` → 403 (CSRF guard extended). Evidence: ran `server.js`'s real `serve()` standalone, real `curl` — forged-origin POST → `403`; legit no-Origin POST to `/api/preview/status` → `200 {"running":false}`; POST `/api/preview/start` against a project with no `package.json` → `200 {"ok":false,"message":"I couldn't read this project's package.json..."}` (honest degrade proven through the real HTTP route, not just a direct module call).
- [x] Desktop-scaffolded project contains the starter's harness files, `e2e/`, and test scripts. Evidence: `npm run lifecycle:selftest` (task 1.5's 8 checks) + `npm run verify` (generated-project shape check), both green.

## Phase 2 — Data seam

- [x] Starter unit tests green for `LocalDataSource` (seeds from seed.json on first run; full CRUD against the persisted localStorage store; typed rows) (D13). Evidence: `vitest run src/data/local.test.ts` → **6/6 pass** in a real scaffolded project (seed-on-first-read, create+persist across a fresh read, update+persist, update-missing→null, remove, reset-restores-seed), against the starter's Map-backed `localStorage` mock.
- [~] Interactive preview: create, edit, and delete a row in the running preview app, reload the iframe → all three changes survive; "Reset sample data" restores the seed rows. **Mechanism verified**: the generated screen does real `data.create/update/remove/reset`, and the local source's persistence is proven by the unit tests above (a fresh `list()` = a reload). ⛔ Blocked-honest: the literal in-browser click-through + screenshot still needs a human at the desktop app (same seat limitation as the Phase 1 preview rows).
- [x] `npm run build` green (Dataverse source compiles with stub types before logical names exist). Evidence: `tsc -b && vite build` → **built OK** with the generated interactive screen importing `@/data`; `tsc -b` type-checks `dataverse.ts` regardless of the `VITE_POWERCODEX_LIVE` value (the env flag only selects the source at runtime), so both branches are covered. Re-verified with the **fallback seam** too (generic project, starter seam removed → `ensureDataSeam` writes it) → built OK.
- [~] Generated app for a domain prompt renders **domain-shaped** seed data. **Partial (honest):** seed *values* and UI labels are domain-flavored (entity noun derived from the goal — e.g. "Add task", "Task 1…5", "No tasks yet"), but the *field set* stays the generic `id/title/owner/due/status` in the deterministic path. True per-domain **field names** come from the AI-author path (the seam-aware prompt is wired; `validateTsx` now permits `@/data`), so a real CLI authors a bespoke schema while the deterministic fallback stays domain-flavored-but-generic. Full per-domain schemas in the deterministic path are a follow-up.
- [x] `grep -rn "SAMPLE" <generated-project>/src/pages/` returns nothing; screens import from `src/data`. Evidence: `grep -c "const SAMPLE"` on both codegen copies → 0; generated `tasks.tsx` imports `{ data, type Item, type NewItem } from "@/data"`; selftest check "generated screen imports the data seam (@/data), not an inline SAMPLE array" passes (164/164).
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
