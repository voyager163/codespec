## Why

PowerCodex can scaffold and drive a lifecycle loop on an imported repo, but it cannot understand a pre-existing app: `import` reads only `package.json` metadata, and the MVP/compliance scoring are built purely from keywords in the user's goal sentence — no source file is ever opened. Makers with an existing Power Apps Code App (or a plain web app) want PowerCodex to read their actual code, derive user stories and an MVP from what is really there, let them correct it, refine from those corrections, and then freeze the result so the loop builds against a reviewed, stable benchmark instead of a hallucinated one.

## What Changes

- Add an `import --analyze` flag that walks the target repo (`src/`, routes/pages, components, connectors/data calls, npm scripts) and writes a structured, read-only **repo digest** at `.powercodex/digest.json`. Stack is auto-detected (Power Platform "tenant" vs plain "local-run") because the user may not know which they have.
- Add a new **user stories** artifact (`.powercodex/stories/stories.json` plus a readable `stories.html`) generated from the digest, where each story cites the source file(s) it was derived from so the user can verify it.
- Ground MVP generation in the digest: `mvp.js` accepts a digest and produces an MVP from real surfaces and data rather than goal keywords (goal-only path retained as fallback when no digest exists).
- Add a **review → refine → freeze** flow: the user edits stories/MVP, the AI refines *against those edits* (a diff of user changes is fed to the provider) instead of regenerating from scratch; an **Approve & Freeze** action sets `status: "frozen"` on the artifact so the lifecycle loop reads but never rewrites it; an **Unlock for major change** action is the only way to reopen it.
- Extend compliance scoring beyond goal↔MVP to also score **stories↔code** (are stories grounded in the digest) and **MVP↔stories** (does the MVP serve the reviewed stories).
- Extend `selftest.js` to assert ingestion, freeze, and refine behaviours.
- Out of scope: real Playwright-for-MDM build/test engines (tracked separately in `docs/plans/mdm-automation-workflow-plan.html`). Ingestion and freeze are validated in simulation.

## Capabilities

### New Capabilities
- `brownfield-ingestion`: read-only analysis of a pre-existing repo into a structured digest (`import --analyze` → `.powercodex/digest.json`), with stack auto-detection.
- `code-grounded-intake`: generation of user stories and an MVP from the repo digest, each story citing its source files, plus compliance scoring across goal↔MVP, stories↔code, and MVP↔stories.
- `spec-freeze-lifecycle`: review → AI-refine-from-edits → Approve & Freeze / Unlock flow, with the lifecycle loop honouring `status: "frozen"`.

### Modified Capabilities
<!-- No requirement-level changes to existing specs; brownfield ingestion is additive. The lifecycle loop's behaviour is extended only through the new spec-freeze-lifecycle capability. -->

## Impact

- New code: `tools/lifecycle/lib/digest.js`, `tools/lifecycle/lib/stories.js`.
- Modified code: `tools/lifecycle/lib/import.js` (`--analyze`), `tools/lifecycle/lib/mvp.js` (digest input), `tools/lifecycle/lib/compliance.js` (new scoring dimensions), `tools/lifecycle/lib/loop.js` (honour frozen state), `tools/lifecycle/lib/server.js` (review/refine/freeze/unlock actions + stories endpoint), `tools/lifecycle/assets/dashboard.html` (stories panel, edit, freeze/unlock controls), `tools/lifecycle/lib/selftest.js` (new assertions).
- New per-project state files: `.powercodex/digest.json`, `.powercodex/stories/stories.json`, `.powercodex/stories/stories.html`, and a `status` field on stories/MVP artifacts.
- Template parity: equivalent changes mirrored under `templates/starter/tools/lifecycle/` so generated projects ship the capability.
- No new runtime dependencies (zero-dependency tool preserved). No breaking changes; goal-only intake remains the fallback when a digest is absent.
