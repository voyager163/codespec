# 01 · Design Brief (Part 1: Product Brief)

## What this tool is

PowerCodex Desktop is an agentic vibe-coding application for organizations where Power Platform is the only sanctioned app platform. A citizen developer describes an app in plain language; an agent harness (Claude Code driven through the lifecycle engine) plans, builds, and tests a **PowerApps Code App**; the user watches the real app run in a live preview with local data, then publishes it to their environment with one click.

**Who it's for:** the Busy Citizen Developer ([specs/project.md](../project.md) §2) — no code literacy, no tolerance for tooling ceremony, wants idea → working app → tested app with the AI as first-line troubleshooter.

**Reference UX:** Lovable's layout, adapted:

```
┌────────────────────────────────────────────────────────────────┐
│ Project name ▾        [Preview ◉ | Code ○]      [Share][Publish]│
├──────────────────────┬─────────────────────────────────────────┤
│ Chat thread          │                                         │
│  · user prompt       │   LIVE PREVIEW                          │
│  · action card       │   (iframe → http://127.0.0.1:<port>)    │
│    "Removed X"       │   the actual generated app, running     │
│    [Details][Preview]│   on vite with LOCAL MOCK DATA          │
│  · plain-language    │                                         │
│    status updates    │   — or —                                │
│                      │                                         │
│ [suggestion chips]   │   CODE VIEW (read-only file browser)    │
│ ┌──────────────────┐ │                                         │
│ │ Ask PowerCodex…  │ │                                         │
│ └──────────────────┘ │                                         │
└──────────────────────┴─────────────────────────────────────────┘
```

The existing three-pane chat (`tools/lifecycle/assets/chat.html`) already has the left chat + right Canvas iframe skeleton. The change is what fills the Canvas: today it shows plan *documents*; production shows the *running app*.

## Definition of done (V1 production)

1. Prompt → generated Code App running in the preview iframe on localhost, using local mock data, within one session, with no manual steps.
2. Every change the agent makes hot-reloads the preview (vite HMR gives this for free once a dev server exists).
3. **Publish** button: registers the project as a Code App if needed (`pac code init`), then `pac code push`, then shows the live Power Apps URL. All failures in plain language, all real.
4. Onboarding readiness check covers all four spec items (Claude Code auth, VS Code, Power Platform VS Code extension, pac auth) with guided fixes.
5. No demo theater anywhere: no injected defects, no simulated-success strings in real mode, no permission toggles that do nothing.
6. The Rule 3 e2e loop (Playwright against the built app) runs automatically before "done" is reported to the user.
7. Packaged installers (Windows portable + NSIS, macOS DMG) that pass a fresh-machine smoke test.

## Current state — what's already production-grade

- **Lifecycle engine spine** (`tools/lifecycle/`, ~7.8k LOC, zero-dep): intake→plan→approve→build→run→test→observe loop with rights gating, no-progress detection, wall-clock abort, fix-mode escalation ([loop.js](../../tools/lifecycle/lib/loop.js)).
- **Agent harness P1** shipped and selftested (122/122): deterministic mode/skill routing, guardrails, consent gate ([harness.js](../../tools/lifecycle/lib/harness.js)).
- **Provider bridge**: Claude Code via `claude -p` with local-file auth detection and honest simulated fallback ([providers/claude-code.js](../../tools/lifecycle/lib/providers/claude-code.js)).
- **Real build gate**: `npm run build` / `tsc --noEmit` with honest `ran:false` when it can't run ([codegen.js:362](../../tools/lifecycle/lib/codegen.js#L362)).
- **pac integration** (incl. uncommitted work): `registerCodeApp` + `pushCodeApp` with a tested degrade contract — nudge when pac absent, never fabricate `power.config.json` ([pac-init.js](../../tools/lifecycle/lib/pac-init.js), selftest Gap #2 block).
- **MCP server** with path confinement, structured errors, `log_learning`, lifecycle session tools ([src/mcp/](../../src/mcp/)).
- **Security posture**: no credential storage, localhost-only server with CSRF origin guard, path-traversal guards on every file endpoint, gitignored auth state.
- **Scaffolder + verifier**: `create-powercodex` CLI is complete; `scripts/verify-generated-project.js` asserts generated structure.

## Gap analysis — what blocks production (evidence-backed)

> **Re-baseline (2026-07-13 PM, verified against committed code):** commits `a8e5d5b` (real preview.js engine + desktop scaffold unification), `4192d85` (preview HTTP endpoints + wired into build loop), and `7085f19` (Preview | Code canvas toggle) landed after this brief was written. Delta: **G1 CLOSED, G2 PARTIAL, G5 CLOSED.** G3/G4 (bespoke codegen + data seam) are now the top blockers, followed by the one-click publish surface (G2 remainder) and onboarding pac checks (G10). Statuses are marked per-row below; original gap text is kept for history.

### Tier 1 — the product promise is unimplemented

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | ✅ **CLOSED (re-baseline 2026-07-13 PM).** ~~No live preview.~~ `preview.js` now really spawns `npm run dev` (installing deps first if needed), parses vite's bound port, polls readiness, and returns a live URL; the canvas Preview tab renders the running app in an iframe with device-width toggles and honest degrade (nudge, never a fabricated URL). | [preview.js](../../tools/lifecycle/lib/preview.js) (real `child_process.spawn`); `/api/preview/start` in [server.js](../../tools/lifecycle/lib/server.js); Preview \| Code toggle in [chat.html:344-365](../../tools/lifecycle/assets/chat.html#L344); wired into loop stage 4 ([loop.js:224-228](../../tools/lifecycle/lib/loop.js#L224)). Commits `a8e5d5b`, `4192d85`, `7085f19`. |
| G2 | 🟡 **PARTIAL (re-baseline 2026-07-13 PM).** The plumbing is now *committed*: `registerCodeApp` (`pac code init`) and `pushCodeApp` (`pac code push`) are wired into loop stages 3–4 with plain-language failure surfacing. **Still open:** no Publish button or Share surface — publish only fires when the buried `allowPush` toggle AND the `dataverse` flag (defaults **off** in real mode) are both on; no app URL is surfaced in real mode (`baseUrl` stays empty unless user-supplied); simulate mode still shows a fabricated `apps.powerapps.com` link; pac auth is never checked at onboarding (see G10). The approved-but-unimplemented terminal-action bridge design (`docs/superpowers/`) covers the missing button/intent wiring. | Wired + committed: [loop.js:174-183](../../tools/lifecycle/lib/loop.js#L174), [loop.js:196-205](../../tools/lifecycle/lib/loop.js#L196). Remainder: `dataverse = !realMode` gate at [loop.js:188](../../tools/lifecycle/lib/loop.js#L188); empty real-mode `baseUrl` at [loop.js:209](../../tools/lifecycle/lib/loop.js#L209); no publish/share controls in chat.html toolbar. |
| G3 | **Generated apps are placeholder-grade.** Every app is the same hardcoded 5-row SAMPLE table (id/title/owner/due/status); capability flags only toggle filter/sort/highlight. The provider-upgrade path exists but falls back to the same generic table. | [codegen.js:87-93](../../tools/lifecycle/lib/codegen.js#L87). |
| G4 | **No data seam in generated code.** Codegen never emits a data-access layer — no local-mock ↔ Dataverse adapter, no `@microsoft/power-apps` service usage. "Preview with local data, publish with Dataverse" has no mechanism. | codegen emits inline arrays only; digest.js can *detect* SDK patterns but codegen never *emits* them. |
| G5 | ✅ **CLOSED (re-baseline 2026-07-13 PM).** ~~Scaffold mismatch.~~ Desktop project creation now prefers `scaffoldFromStarter` (the published starter template) and falls back to the generic Vite scaffold only when the starter is unavailable. | [server.js:122](../../tools/lifecycle/lib/server.js#L122) (`scaffoldFromStarter(...) || scaffold(...)`); [scaffold.js:221](../../tools/lifecycle/lib/scaffold.js#L221). Commit `a8e5d5b`. |

### Tier 2 — honesty and trust violations

| # | Gap | Evidence |
| --- | --- | --- |
| G6 | **Demo theater in real mode.** Rotation 1 always injects a fake defect so "self-heal" fires; self-heal is a revert-to-generic-table, not a fix. A real user watching their custom screen get silently replaced by a generic table after a "fix" is a trust breach. | injectDefect `r===1` branch in [loop.js](../../tools/lifecycle/lib/loop.js); [engines.js:164-180](../../tools/lifecycle/lib/engines.js#L164). |
| G7 | **Rule 3 e2e loop not integrated.** Real e2e is a single CDP smoke test needing an externally supplied `--app-url`; without it, `no-app-url` failure. No Playwright suite is generated or run against the built app from the desktop. | [engines.real.js:115](../../tools/lifecycle/lib/engines.real.js#L115); spec names in loop.js are labels, not files. |
| G8 | **Playwright effectively never runs in the packaged app** — imported by the engine but declared nowhere; only works if the *opened project* happens to have it installed. | [engine/mdm-attach.mjs:20](../../tools/lifecycle/engine/mdm-attach.mjs#L20); both package.json files lack it. |
| G9 | **Chat history lost on reload** (in-memory only; state restore covers goal/builtOnce, not the thread). | chat.html `app.history`. |

### Tier 3 — spec conformance and hygiene

| # | Gap | Evidence |
| --- | --- | --- |
| G10 | Onboarding misses the **Power Platform VS Code extension** check required by the spec; no reference to it anywhere in readiness. | [specs/project.md](../project.md) §4 Onboarding vs [setup.js](../../tools/lifecycle/lib/setup.js). |
| G11 | **Packaging defects**: duplicate `"mac"` key in desktop/package.json (uncommitted); no code signing (mac `identity:null`, no Windows cert); no auto-update; stale committed `build-out/…/app.asar`; mac build bypasses the hardened build wrapper. | desktop/package.json diff; desktop/build-out/. |
| G12 | **CI doesn't exercise the product**: only MCP unit tests run; `npm run verify` (generated-project verifier) and `lifecycle:selftest` (127 checks) never run in CI. Verifier has brittle hardcoded counts (exactly 12 prompts / 11 skills). | [.github/workflows/ci.yml](../../.github/workflows/ci.yml); [verify-generated-project.js:36,51](../../scripts/verify-generated-project.js#L36). |
| G13 | Dead-but-broken `require()` in ESM at [src/mcp/tools/learning.mjs:22](../../src/mcp/tools/learning.mjs#L22); stale `npx power-apps push` comment at [rights.js:15](../../tools/lifecycle/lib/rights.js#L15); stale "no real implementation" header at [engines.real.js:8](../../tools/lifecycle/lib/engines.real.js#L8); unwired cockpit slash commands. | As cited. |
| G14 | **Dataverse UI automation fragile**: selectors unvalidated against a live tenant; requires a manually launched CDP Edge session no UI sets up; only table.create/column.add automated. | [maker-recipes.js:34,53,60,67](../../tools/lifecycle/lib/maker-recipes.js#L34); [dataverse-schema.js:107](../../tools/lifecycle/lib/dataverse-schema.js#L107). |

## What we deliberately do NOT build in V1

- Multi-tenant admin, RBAC, fleet management (spec non-goal).
- A custom in-app code editor (VS Code hand-off already exists).
- Auto-update infrastructure (ship manual installers first; add electron-updater when there's a user base to update).
- Linux packaging.
- Real Power Automate flow authoring (maker-recipes marks it honest-false; keep it that way until table/column authoring is validated live).
