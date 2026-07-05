## 1. Harness module

- [x] 1.1 Add `tools/lifecycle/lib/harness.js` — a pure, dependency-free module with content constants (process spine, mode router + 5 modes, guardrails, 6 codeapps essences, UI/verify/change essences, fidelity note).
- [x] 1.2 Add deterministic detectors + `route(taskText, intent) -> { mode, codeapps, ui, verify, change }`.
- [x] 1.3 Add `compose({ taskText, intent, rights })` (pure, try/catch → '', gated + skip-greeting), `shouldInject`, `enabled` (default-on, fail-open), and `statusLine`.

## 2. Consent gate

- [x] 2.1 Add `allowHarness: true` to `rights.js` DEFAULTS (default on; `load()` backfills existing approval.json).

## 3. Injection at agent-facing entry points

- [x] 3.1 `chat.js`: `buildPrompt` prepends the harness; `respond` loads rights + passes intent.
- [x] 3.2 `agent.js`: `buildAgentPrompt` prepends the harness (intent `act`); `run` loads rights, passes it, and emits `statusLine` to the bus.
- [x] 3.3 `cockpit.js`: `handle` classifies intent, loads rights, prepends the harness to the user's line.
- [x] 3.4 Deliberately leave `codegen.js aiAuthor` and `stories.js` untouched (strict output contracts).

## 4. Verification (repo selftest style)

- [x] 4.1 Add 21 harness checks to `selftest.js`: route classification, compose gating (on/off/skip-greeting/fail-open), ponytail+guardrail presence, codeapps append/omit, no-throw, status line, and per-site prepend (chat/agent) + default-on flag.
- [x] 4.2 `npm run lifecycle:selftest` green — **122/122**.
- [x] 4.3 `node scripts/verify-generated-project.js` green; `npm test` (MCP) green — **28/28**.

## 5. Ship into the starter

- [x] 5.1 Mirror `harness.js` + chat/agent/cockpit wiring + the `allowHarness` flag into `templates/starter/tools/lifecycle/`.
- [x] 5.2 Starter selftest green — **101/101** (harness loads + cockpit wired).

## 6. Docs

- [x] 6.1 Tighten the change's `design.md` / `spec.md` to the three-site injection decision.
- [ ] 6.2 Update the lifecycle `README.md` "What's real" table to list the harness (follow-up).

## 7. Follow-ups (separate changes)

- [ ] 7.1 P2 — canonical → convert → install of provider-native files (CLAUDE.md / `.claude`) into the connected agent's dir, behind the consent gate + per-source licence check.
- [ ] 7.2 P3 — desktop discovery/one-click UI + auto-update surfacing the harness modules.
- [ ] 7.3 Optional: add harness smoke checks to the starter selftest (kept lean for now; fully covered in the source selftest).
- [ ] 7.4 Optional: inject the harness on the MCP `chat`/`agent` tool paths if they bypass `chat.respond` / `agent.run`.
