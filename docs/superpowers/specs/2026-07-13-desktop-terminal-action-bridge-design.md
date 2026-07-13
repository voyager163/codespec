# Desktop terminal-action bridge

**Status:** approved (design), not yet planned/implemented
**Date:** 2026-07-13
**Author:** Manfred Siew (design session with Claude Code)

## Problem

The PowerCodex desktop app (`desktop/`) wraps the lifecycle chat UI (`tools/lifecycle/assets/chat.html`) in an Electron shell. The chat UI already bridges one terminal action end-to-end — "⚡ Build this" — through `Controller.action()` in `tools/lifecycle/lib/control.js`. Three more terminal actions a Code Apps maker regularly needs are **not** bridged:

- **Push** — `pac code push` exists as a working wrapper (`pushCodeApp()` in `tools/lifecycle/lib/pac-init.js`) and as a CLI subcommand (`code-push`), but `Controller.action()` has no case for it, so the chat UI can't call it.
- **Add datasource** — `pac code add-data-source` is only referenced as guidance text for the AI agent (`CODEAPPS['dataverse-specialist']` / `CODEAPPS['connector-integrator']` in `tools/lifecycle/lib/harness.js`). No wrapper function exists anywhere.
- **Create new project** — the full scaffold (starter template, OpenSpec, all 11 OPSX prompts/skills, npm install, git init) is `bin/create-powercodex.js`, a separate top-level CLI (`powercodex my-app`). The desktop app only has "📂 Open project" (pick an existing folder) — nothing scaffolds a new one from inside the app.

The user should not need to leave the app or touch a terminal for these three actions. Clicking a button (or asking in chat) should be enough.

## Goal

Bridge all three actions into the chat UI using the same mechanism the app already uses for "Build this": a `Controller.action()` case that both a toolbar button and the chat agent call identically, streaming progress into the existing activity feed.

## Non-goals (explicitly skipped for v1)

- **No connector browser for non-Dataverse sources.** Free-text connector id only, until there's a real `pac connection list` wrapper to build a picker from.
- **No solution-aware push (`--solutionName`).** `alm-engineer` guidance mentions solutions as the unit of movement, but wiring Push to a specific solution is a distinct feature. v1 pushes to the default target the same way `pushCodeApp()` does today.
- **No rollback UI for Add-datasource.** Dataverse schema changes aren't cleanly reversible via the CLI anyway; the `allowPush` consent gate is the safety net, not an undo button.

## Design

### Core pattern

Every new action is one more `case` in `Controller.action()` (`tools/lifecycle/lib/control.js:44`) — the same switch that already handles `intake` / `approve` / `propose-mvp` / etc. This gives the button and the chat agent a single code path for free:

- The button calls `api('push', {...})` (the same `api()` helper `chat.html` already uses for every other action).
- The chat agent, when it recognizes intent in a typed message, calls the identical action.

No duplicated logic between "clicked" and "typed" — one implementation, two entry points.

### 1. Push (`case 'push'`)

- Wraps the existing `pushCodeApp()` from `tools/lifecycle/lib/pac-init.js`.
- Runs `npm run build` first if the workspace has a `build` script, then `pac code push`.
- Streams `pac` stdout/stderr into the activity feed via `emit()`, the same pattern `applySchema` already uses for Dataverse table creation.
- **Gate:** reuses the existing `allowPush` rights flag (the rights panel's "Publish to my environment" toggle). The button is disabled/tooltipped when `allowPush` is off; the chat path returns the same "Push is off — turn on Publish to my environment first" message the gate already produces elsewhere.
- **UI:** new "🚀 Push" toolbar button next to "⚡ Build this".
- **Chat intent:** recognizes phrases like "push", "deploy", "publish".

### 2. Add datasource (`case 'add-datasource'`)

- New module `tools/lifecycle/lib/datasource.js`, same spawn/emit shape as `pac-init.js`, wrapping `pac code add-data-source -a <api> -t <table>`.
- Unlike Push, this needs a parameter — no zero-input path:
  - **Dataverse:** button opens a small panel listing tables already created via the Rule 1 browser flow, read from `.powercodex/dataverse.json` (`dataverse-schema.js`'s existing state file).
  - **Other connectors:** free-text connector id field (see Non-goals — no picker yet).
- **Chat intent:** e.g. "add a datasource for the Orders table" — the agent extracts the table name and calls the same action. If it can't confidently identify a table/connector, it asks a clarifying question in chat rather than guessing.
- Guidance surfaced to the agent reuses the existing `CODEAPPS['dataverse-specialist']` / `CODEAPPS['connector-integrator']` text in `harness.js` — no new guidance text is authored.
- **Gate:** reuses `allowPush` (schema/data-source wiring is a live-environment change too).

### 3. Create new project (`case 'create-project'`)

- Spawns `node bin/create-powercodex.js <name>` as a child process into a folder the user picks via the existing native picker (`pcDesktop.pickFolder()`).
- Streams the CLI's real step names ("Copy starter template", "Initialize OpenSpec", "Finalize OPSX assets", etc. — from `create-powercodex.js`'s own `runStep()` calls) into the activity feed.
- On success, the app re-opens the new folder as the active workspace automatically (reusing the existing "open project" flow) — usable immediately, no extra step.
- **No gate** — purely local scaffolding, touches no live environment.
- **Chat intent:** e.g. "start a new project called Orders Tracker" — same action; if no name is given, asks for one (reusing `create-powercodex.js`'s existing `validateProjectName` error messages for consistency, rather than re-implementing validation).

## Cross-cutting notes

- All three actions follow the existing `emit()`-per-step convention, so the activity feed is the single "what happened" surface — no new progress UI to build.
- All three are exposed at the same `Controller.action()` switch, keeping button and chat-agent entry points identical.
- Skill guidance (the `CODEAPPS` object in `harness.js`) is already loaded into the agent's context for relevant tasks; these actions reuse that wiring rather than duplicating guidance text.
