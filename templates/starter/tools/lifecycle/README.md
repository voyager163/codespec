# PowerCodex Lifecycle

The autonomous app-lifecycle loop from the [master plan](../../docs/plans/powercodex-master-plan.html), as a small, zero-dependency Node tool. It implements the spine the plan says to build first:

```
Intake → Plan → Approve → Build → Run → Test → Observe → (loop)
```

around two inputs — a **goal** and an approved **MVP** — and streams everything to two interchangeable surfaces: an always-on **graphical Studio dashboard** and a **real terminal cockpit (TUI)**. Same engine underneath — pick your comfort level.

## Two surfaces, one engine

```bash
npm run cockpit                    # the real terminal cockpit (TUI)
npm run cockpit -- --provider github-copilot   # talk to a specific AI
npm run lifecycle:serve -- --open  # the graphical Studio dashboard in a browser
```

The **Cockpit** is a real terminal interface: type a request to talk to your AI, or `/` for slash commands (Tab completes, ↑/↓ recalls history, Ctrl-C interrupts a generation). Commands: `/provider` (switch AI), `/plan open·list`, `/start`, `/status`, `/rights`, `/studio`, `/help`. The **Studio** is the same data as a clickable dashboard with a Plans panel — friendlier for anyone who'd rather not live in a terminal.

> **This is the canonical copy.** `templates/starter/tools/lifecycle/` (scaffolded into every generated app) and `desktop/vendor/lifecycle/` are **generated** from this tree — do **not** hand-edit them. Edit here, then run `npm run sync:starter` (and the desktop app's own sync). The self-test's drift guard fails if the starter copy falls out of sync.

### Bring your own AI

A provider bridge sits between the cockpit and the model, so you can switch brains with `/provider` and the lifecycle/consent gate wrap all of them equally:

```bash
npm run lifecycle -- provider list   # claude-code · github-copilot · simulated
```

Each provider is an adapter (`lib/providers/*.js`) exposing one streaming interface; auth is delegated to each vendor's own CLI. If a CLI isn't installed, the registry falls back to a built-in **simulated** brain so the cockpit is always usable.

### Generated plans, viewable on demand

When the agent finishes an HTML plan it's recorded in `.powercodex/plans/index.json`. `/plan open` (cockpit) or the **Generated plans** panel (Studio) serves and opens it in your browser — no hunting for files.

### Drop it into any project

```bash
npm run lifecycle -- import            # scaffold consent gate, plan registry, providers, a cockpit script
npm run lifecycle -- import --analyze  # …and read the existing code into .powercodex/digest.json
```

`import` detects the stack (Power Platform → tenant engines; otherwise local-run), creates per-project `.powercodex/` state, and wires a `cockpit` npm script — so the same loop runs the rest of that project.

### Brownfield: derive stories & MVP from a pre-existing app

For an app that already exists, `import --analyze` makes PowerCodex **read your code** instead of guessing from a goal sentence. A deterministic, read-only walk (zero-dependency, no AST) records your routes, components, data calls, and npm scripts — each citing the source file it came from — into `.powercodex/digest.json`. It never writes into your source tree.

```bash
npm run lifecycle -- import --analyze   # 1. read the code → digest
npm run lifecycle -- stories            # 2. derive user stories (each cites its source file)
npm run lifecycle -- mvp                # 3. MVP grounded in your real surfaces (goal-only fallback when no digest)
```

Then review → refine → **freeze**: in the Studio **Plan** step you edit any story, click **Refine from my edits** (the AI improves from your changes rather than regenerating), then **Approve & freeze**. A frozen artifact (`status: "frozen"` in `.powercodex/freeze.json`) is the benchmark the loop builds against — it is read but **never rewritten** until you **Unlock for major change**. Two extra compliance meters show **stories↔code** (are the stories grounded in the digest) and **MVP↔stories** (does the MVP serve the reviewed stories).

## Live monitoring (the dashboard)

```bash
npm run lifecycle:serve            # http://localhost:4321 — leave it open
npm run lifecycle:serve -- --demo  # also drives a paced loop so you can watch it move
```

A zero-dependency Node server serves the dashboard and a `/api/state` endpoint; the page polls every 1.2s and re-renders in place (no flicker, no browser `file://` limits). It shows the whole system at once:

- **Intake & rights** — the goal, the MVP, the goal↔MVP compliance meter, and the `Approved_rights/` flags (build / push / auto-respec / auto-fix)
- **Loop strip** — the 7 stages with the current one live, plus an overall progress bar
- **Agent cards** — Intake, Planner, Build Executor, Runner, E2E Tester, Observer, each with a live status badge, progress, and current task
- **Live activity feed** — the streaming event log, newest first
- **Test & MVP coverage** — coverage ring + last red/green
- **Specs authored from observation** — defect / gap / improvement cards
- **Learning_Experience** — lessons read from the `Learning_Experience/` log

Run the loop in another terminal (`npm run lifecycle -- loop --rotations 3`) and the open dashboard follows along live.

## What's real here vs. simulated

| Piece | Status |
| --- | --- |
| `Approved_rights/` consent gate | **real** — read before build/push, blocks when a flag is false |
| Append-only status bus (`.powercodex/live/status.json`) | **real** |
| Live dashboard server (`serve` → `http://localhost:4321` + `/api/state`) | **real** |
| Static dashboard snapshot (`.powercodex/live/index.html`) | **real**, regenerated on every event |
| Loop orchestrator + guardrails (rights gate, no-progress detector) | **real** |
| E2E tester (Engine 2) + managed-Edge profile verify | **real-capable** — drives a managed Edge over CDP via the vendored Playwright-for-MDM engine; runs a real smoke test (page/console/network errors). Simulates when Playwright is absent. |
| Build executor (Engine 1) | **entry is real** — navigates into Power Platform (the Dataverse/Power Automate maker surfaces via [`lib/maker-recipes.js`](lib/maker-recipes.js)) and verifies they load. The field-by-field asset authoring (create the table/column/flow) is **not automated yet** — reported honestly as `created:false`, never faked. |
| Cockpit TUI (`cockpit`) + slash commands + streaming | **real** |
| Provider bridge (`provider list`, `/provider`) — claude-code · github-copilot | **real** — uses each vendor's CLI; falls back to a simulated brain when absent |
| Plan registry + viewer (`/plan open`, `/api/plans`) | **real** |
| Portable `import` into any project | **real** |
| Brownfield ingestion (`import --analyze` → `.powercodex/digest.json`) | **real** — read-only structural walk of your code |
| Code-grounded user stories (`stories`) + grounded MVP, with provenance | **real** |
| Review → refine → **freeze / unlock** (`.powercodex/freeze.json`) | **real** — the loop honors the frozen benchmark |

### Going real (the e2e engine)

Engine 2 and profile verification are wired to the **vendored Playwright-for-MDM engine** ([`engine/mdm-attach.mjs`](engine/mdm-attach.mjs)) — it attaches to a managed Edge over CDP and runs a real smoke test. To turn it on for a project:

```bash
npm i -D playwright                                   # optional dependency — only when you want real
npm run lifecycle -- import --analyze                 # so the loop knows the project is browser-based
npm run lifecycle -- profiles                         # list your signed-in Edge profiles…
npm run lifecycle -- profiles use you@tenant.com      # …and persist the one --real always attaches to
npm run lifecycle -- loop --real --app-url https://<your-app> --env <environmentId>
```

`profiles use` writes `browserProfile` into `Approved_rights/`, so every real run (build entry + e2e runner) attaches to the profile you signed in with — no re-picking. See [docs/quickstart-real-run.md](../../docs/quickstart-real-run.md) for the full first-run walkthrough.

`resolveEngines()` ([`lib/engines.js`](lib/engines.js)) picks the engine bundle at run time. Real runs need three things: `--real`, a **browser-based** project (Power Platform tenant, or web routes/components/dev-server — read from the digest), and Playwright installed. If any is missing it degrades **gracefully to simulation** — and, when the project is browser-based but Playwright is absent, it **recommends `npm i -D playwright`** (in the import output, the dashboard banner, and `/api/state`). A non-browser project (a library/CLI) just simulates quietly, with no nag. The npm package itself stays **zero-dependency**: Playwright is opt-in.

Engine 1 (the build executor) now **really enters Power Platform**: in real mode it attaches and navigates to the maker surface for each task ([`lib/maker-recipes.js`](lib/maker-recipes.js) maps task → URL), verifying it loaded. The field-by-field authoring (actually create the table/column/flow) is the remaining "front-end" automation — each recipe carries a `todo` for it — and is built against a live tenant as a deliberate next step. Pass `--env <environmentId>` to land directly in your environment's Tables/Flows list.

## Usage

```bash
# from a project root
npm run lifecycle:serve -- --open         # start the live dashboard and open the browser
npm run lifecycle -- loop --rotations 2   # run the loop; the open dashboard follows live
npm run lifecycle -- mvp --goal "..."     # propose an HTML MVP from a goal
npm run lifecycle -- reflect "lesson" --severity major --what "..." --how "..."
npm run lifecycle -- emit claude "did X" --level good   # post progress to the board
npm run lifecycle -- init                 # create .powercodex/live + Approved_rights + snapshot
npm run lifecycle:selftest                # run the product against itself and assert it works
```

Add `--real` to `loop` to drive the real MDM browser engine (requires a browser-based project, `npm i -D playwright`, granted `Approved_rights/` flags, and `--app-url` for the tester; it degrades to simulation with a recommendation otherwise). The dashboard also exposes these as buttons: Start/Pause/Approve/Reset, **Propose MVP**, **Reflect**, plus editable goal/MVP intake with a **real goal↔MVP compliance** meter (flags drift + missing terms), an **Insights** panel (rework rate, self-heals, lessons, mistakes-per-rotation), and a **notifications** banner for pending approvals.

## Workspace — learn across many projects

Put PowerCodex and several app projects as **sibling folders** in one workspace and they share a single learning brain: lessons logged while building one project are available when building the next.

```bash
# at the workspace root (parent of your project folders)
npm run lifecycle -- workspace init --name my-portfolio
npm run lifecycle -- workspace register ./projects-hub
npm run lifecycle -- workspace register ./field-ops-app
npm run lifecycle -- workspace list        # projects + shared lesson count
```

`workspace init` drops a `.powercodex-workspace.json` marker and a shared `Learning_Experience/` at the workspace root. From then on, any project under it resolves `reflect` writes and Insights/lesson reads to that shared brain (a project outside a workspace just uses its own local `Learning_Experience/`, unchanged). The dashboard shows a workspace badge with the shared lesson count.

> Recommended layout: sibling folders, each its own git repo, opened as a multi-root workspace — **not** one git repo nested inside another.

## Self-test

`npm run lifecycle:selftest` runs the full loop in a throwaway workspace and asserts the product produced what the plan promises — all 7 stages, build assets, the push-vs-dev rule, honest pass reporting (no fabricated self-heal or observation), the rendered dashboard, well-formed derived state, the **live server + control endpoints** (`/api/state`, `/api/action` intake/rights/propose-mvp/reflect, `/api/emit`), **real compliance scoring**, the **MVP proposer**, the **reflection** lesson writer, **computed insights**, **notifications**, **cross-project shared learning**, the rights gate blocking an un-approved build, and the **v2 cockpit** pillars — the provider bridge (streaming + interrupt), the plan registry + viewer (served over HTTP), cockpit command routing + chat streaming, and the portable `import` — and the **brownfield** pillars: reading a pre-existing app into a digest (with provenance), generating code-grounded stories + a grounded MVP, the goal-only fallback, refine-preserves-edits, and the freeze/unlock contract (a frozen benchmark the loop never rewrites), and the **real-engine resolution** — the vendored MDM engine is present, `resolveEngines` returns the right bundle, a browser-based project without Playwright is recommended it (and falls back), and a non-browser project simulates without a nag — and the **Engine 1 maker recipes** that map build tasks to real Power Platform surfaces (env-scoped URLs, the Power Automate target, and the honest "DOM creation pending" flag), and the **Edge profile picker** (discover from Local State, resolve a selection by index/email/directory, persist it to the consent gate). **97/97 checks.**
