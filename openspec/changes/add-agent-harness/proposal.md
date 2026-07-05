## Why

PowerCodex lets an end user connect their own coding agent (Claude Code, GitHub Copilot) through the provider bridge and build against a real workspace. But each connected agent behaves like a generic assistant. The disciplined engineering behaviour PowerCodex embodies — godmode's mode router (build / fix / audit / ux-map / sec-ops), the "leanest thing that still preserves validation, error handling, security, and accessibility" ethic, and routing Power Platform work to the right codeapps specialist — is only available when someone manually invokes those skills. Desktop end users do not have those skills installed and should not have to invoke them.

This change ships that discipline **into every connected agent automatically**, applying the agency-agents distribution philosophy (expertise delivered into people's tools) to a harness instead of a persona. It is slice **P1** of a three-part program; P2 (canonical → convert → install of provider-native files) and P3 (desktop discovery UI) are separate follow-on changes.

## What Changes

- Add a self-contained **harness** module (`tools/lifecycle/lib/harness.js`, zero-dependency) that composes a compact, provider-agnostic system preamble from two blocks: a **godmode mode router** and a **codeapps skill router**. Both are distilled to behavioural rules that reference no external skills, so a connected agent needs nothing pre-installed.
- Inject the composed harness at every provider send-site (`chat.js`, `agent.js`, `cockpit.js`, `codegen.js`, `stories.js`) — prepended as a clearly-labelled block, on substantive turns only (greetings/chit-chat are skipped for token thrift).
- Add light deterministic detectors: `detectMode(taskText)` maps the existing intent taxonomy onto godmode modes, and a Power-Platform detector picks the single matching codeapps skill whose condensed guidance is appended. The model may self-route from the injected menu; detectors only bias.
- Tell the agent to load the full `.powerplatform/<skill>/SKILL.md` when it is readable in the workspace (graceful full fidelity), otherwise apply the condensed guidance — the seam into P2.
- Gate the harness behind a new `Approved_rights/harness` flag (default **on**); when off, composition returns an empty string and nothing is injected.
- Emit a one-line routing status (`Harness · <mode> · codeapps:<skill>`) onto the append-only status bus for observability.
- Extend `selftest` to assert composition, gating, skip-on-greeting, mode/skill detection, and per-site injection.

## Capabilities

### New Capabilities

- `agent-harness`: PowerCodex injects a self-contained engineering-discipline harness into every connected agent so end users get godmode + codeapps behaviour without invoking a skill.

### Modified Capabilities

- None. The lifecycle loop mechanics are untouched; only prompt assembly is enriched, and every branch degrades to today's behaviour when the harness is off or composition fails.

## Impact

- Adds `tools/lifecycle/lib/harness.js`; it is copied into `desktop/vendor/lifecycle/` automatically by `scripts/sync-lifecycle.js` at build time.
- Updates `chat.js`, `agent.js`, `cockpit.js`, `codegen.js`, `stories.js` to prepend the harness at their provider-send points.
- Updates `lib/rights.js` default flags to include `harness`.
- Updates `lib/selftest.js` with harness assertions.
- Ships into `templates/starter/tools/lifecycle/` so generated projects inherit it (matching the `add-lifecycle-loop` precedent).
- Does **not** write or overwrite any `CLAUDE.md` or file in the user's workspace — that is P2 and a godmode guardrail. P1 is prompt-injection only.
