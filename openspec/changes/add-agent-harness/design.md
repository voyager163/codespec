# Design — Agent Harness (P1)

## Context

The provider bridge (`lib/providers/index.js`) sends a single `prompt` string to a
connected CLI (`claude -p`, Copilot) scoped to the workspace `cwd`. Behaviour is
already shaped by three inline system strings — `PLAN_SYSTEM` / `OPEN_SYSTEM`
(`chat.js`) and `AGENT_SYSTEM` (`agent.js`) — plus prompt assembly in `cockpit.js`,
`codegen.js`, and `stories.js`. There is a deterministic intent router
(`classifyIntent`: chat / answer / act / plan / artifact).

We want every connected agent to apply PowerCodex's engineering discipline
(godmode modes + codeapps routing) **without the end user invoking a skill**, and
without requiring anything to be installed on their side. The chosen approach is
**A + a touch of C**: one centralized preamble module, injected on substantive
turns, with light deterministic detectors that append only the relevant slice.

## Goals / Non-goals

**Goals**
- Self-contained: the harness works with zero skills installed on the user's machine.
- Provider-agnostic: identical behaviour for claude-code, github-copilot, simulated.
- One source of truth: a single module all send-sites consume.
- Lean per turn: skip non-substantive turns; append only the matching codeapps slice.
- Honest + reversible: gated by consent, can never break the agent, observable.

**Non-goals (explicit P1 boundary)**
- No workspace-file install (write `CLAUDE.md` / `.claude/`) — that is **P2**.
- No desktop discovery / one-click UI — that is **P3**.
- No new providers; no change to the build-loop mechanics.
- Never overwrite the user's `CLAUDE.md` (godmode guardrail).

## Architecture

```
                         Approved_rights/harness (flag, default on)
                                        │ gate
tools/lifecycle/lib/harness.js ── compose() ──► chat.js · agent.js · cockpit.js
   (single source of truth)                     codegen.js · stories.js
        │                                        (each prepends the labelled block)
        └── synced by scripts/sync-lifecycle.js ──► desktop/vendor/lifecycle/
```

`harness.js` is zero-dependency and pure (no I/O beyond reading the rights flag it
is handed). It never throws into the prompt path.

## Module surface (`lib/harness.js`)

```
route(taskText, intent) -> { mode, skill }             // pure classification: mode + codeapps skill|null
compose({ taskText, intent, rights }) -> string        // '' when gated off / skipped / on error
shouldInject(intent) -> boolean                        // false for chat/greeting turns
detectMode(taskText, intent) -> 'build'|'fix'|'audit'|'ux-map'|'sec-ops'|'plain'
detectCodeapps(taskText) -> boolean                    // Power-Platform intent present?
pickCodeappsSkill(taskText) -> skillId|null            // architect|app-scaffolder|dataverse-specialist|
                                                       // connector-integrator|env-vars-specialist|alm-engineer
```

- `compose` is **pure**: it is handed the resolved `rights` flag (the caller reads it
  via `rights.js`) and performs no I/O. It internally uses `route()` to decide which
  slices to include. It is wrapped in try/catch; any failure returns `''` (mirrors the
  "the bus must never break the agent" rule).
- `route()` is the shared, pure classifier used by both `compose` (to select slices)
  and each send-site (to emit the status line — see Observability). Same input →
  same `{ mode, skill }`, so what is injected and what is reported never diverge.
- Mode/skill essences are stored as **inline data constants** (not prose) so they
  are one source of truth and directly unit-testable.

## Harness content (self-contained)

**Block 1 — Godmode mode router.** "Before acting, silently pick ONE mode; the
narrower wins; none fit = a plain task." Each mode distilled to rules that name no
external skill:
- **build** — cut to an honest MVP; the leanest version that still preserves
  validation, error handling, security, accessibility; put code where the repo
  already puts it; one runnable check per non-trivial unit; lint + test green.
- **fix** — isolate blast radius, check callers; write a failing (Red) test that
  reproduces the bug; fix at the root (one guard in the shared function); Red → Green
  before claiming fixed.
- **audit** — read-only, no edits; report debt to the repo's docs location.
- **ux-map** — shortest click-path + friction list → docs.
- **sec-ops** — branch first; review + OWASP Top-10 over input/auth paths; note real
  vs demo-grade auth.
- Plus the **ponytail core** ("the laziest thing that works and still preserves
  validation, error handling, security, and accessibility is the finished thing")
  and godmode's guardrails (no cloning-as-setup, no file-hiding, never overwrite the
  user's `CLAUDE.md`, no prompt-logging telemetry).

**Block 2 — Codeapps router.** Emitted only when `detectCodeapps` fires. The routing
table with handoff rules, and the single selected skill's 1–2 line condensed essence:

| Trigger | Skill |
|---|---|
| architecture / "how does this fit" / load-failure debugging | `architect` |
| scaffold new app / convert Vite app / broken `power.config.json` | `app-scaffolder` |
| Dataverse tables / CRUD / query / lookup / file upload | `dataverse-specialist` |
| non-Dataverse connector (O365/SQL/SharePoint) | `connector-integrator` |
| portability across Dev/Test/Prod (`@envvar:`) | `env-vars-specialist` |
| solutions / pipelines / Dev→Test→Prod deploy | `alm-engineer` |

Handoffs: scaffold before adding data sources; Dataverse vs connector split. The
block ends with: *"If `.powerplatform/<skill>/SKILL.md` is readable in this
workspace, load it for full fidelity; otherwise apply the guidance above."*

## Composition & injection

`compose` returns `''` when `rights.harness` is false, when `shouldInject(intent)`
is false, or on any internal error. Otherwise it returns:

```
<<<POWERCODEX HARNESS
[mode-router block]
[codeapps block — only if detectCodeapps]
POWERCODEX HARNESS>>>
```

Each send-site keeps its existing system string and **prepends** the block:
- `chat.js buildPrompt` — for plan / answer / act (skip chat).
- `agent.js buildAgentPrompt` — always (agent mode is substantive).
- `cockpit.js`, `codegen.js`, `stories.js` — at their provider-send points.

The labelled delimiter keeps the injection visible and trivially removable.

## Consent, toggle & observability

- New `harness` flag in `Approved_rights/` (default **true**), read via `rights.js`
  and passed into `compose`. Off → `compose` returns `''`.
- On a substantive turn, the **send-site** (not `compose`) calls `route()` and emits
  one status line to the bus: `Harness · <mode> · codeapps:<skill|—>` — keeping
  `compose` pure while making routing observable, not magic. The emit is best-effort
  and wrapped so the bus can never break the turn.

## Error handling

`compose` never throws; detectors are best-effort. A detector miss falls back to the
always-on mode-router core. If the rights file is unreadable, treat the harness as on
(fail-open to the disciplined default) but never crash.

## Testing (repo `selftest` style)

Extend `npm run lifecycle:selftest` with deterministic, offline checks:
- `compose` non-empty on a build task; empty on a greeting; empty when
  `rights.harness === false`.
- `detectMode` maps representative tasks → correct mode; `pickCodeappsSkill` splits
  Dataverse vs connector vs scaffolder correctly.
- Composed block contains the ponytail core, and the picked skill's essence when a
  Power-Platform task is given.
- Each send-site builder actually prepends the block (assert on the returned prompt).

## Decisions / trade-offs

- **Preamble, not file-write (P1).** Prompt injection is provider-agnostic, needs no
  consent to touch the user's tree, and cannot corrupt their `CLAUDE.md`. Full-fidelity
  file install is deferred to P2 behind the consent gate.
- **Model self-routes; detectors bias.** Avoids brittle regex being the sole arbiter;
  the injected menu lets a capable CLI pick the mode, while the deterministic detector
  keeps the codeapps slice small and gives the simulated brain a sane default.
- **Default on.** The product goal is discipline *without* invoking a skill; a
  visible flag + status line keep it honest and reversible.
