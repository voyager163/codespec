## Context

The PowerCodex lifecycle tool (`tools/lifecycle/`) is a zero-dependency Node module. Today it understands a project only through metadata: `import.js` reads `package.json` to detect a runner and Power Platform markers, and `mvp.js`/`compliance.js` derive the MVP and "compliance" from keyword tokens of the user's goal string. No source file is opened, there is no user-stories concept, and no artifact can be locked against the loop. This change adds code-aware ingestion, code-grounded stories/MVP, and a freeze flow — all while preserving the zero-dependency, simulation-first design and keeping the goal-only path as a fallback.

Constraints: no new runtime dependencies; everything must run in the existing simulation self-test; changes must be mirrored under `templates/starter/tools/lifecycle/` so generated projects inherit them; the analyzer must never write into the user's source tree (read-only) and must auto-detect stack because the user reported they are unsure (Power Platform vs plain web app).

## Goals / Non-Goals

**Goals:**
- Produce a deterministic, read-only repo digest from a pre-existing app.
- Generate user stories and an MVP grounded in that digest, each story traceable to source files.
- Let the user edit, have the AI refine *from the edits*, then freeze the result so the loop builds against a stable benchmark.
- Extend compliance to score stories↔code and MVP↔stories.
- Keep everything testable in the existing simulation self-test.

**Non-Goals:**
- Real Playwright-for-MDM build/test engines (separate plan).
- Semantic/LLM-only code understanding as the source of truth — the digest is a deterministic structural walk; the provider may enrich, but grounding is file-cited and verifiable.
- Multi-language deep parsing — scope is the JS/TS Code Apps / web stack the starter targets.

## Decisions

- **Deterministic structural walk, not a parser/AST or LLM scrape.** `digest.js` walks `src/` and known config files using `node:fs` + lightweight regex (imports, route registrations, component exports, connector/data calls, npm scripts). Rationale: zero-dependency, fast, explainable, reproducible in self-test. Alternative considered: TypeScript compiler API / AST — rejected (heavy dependency, overkill for a digest). Alternative: ask the provider to read files directly — rejected as the *grounding* source (non-deterministic, unverifiable), though the provider may later enrich story prose.
- **Digest is read-only and additive.** `--analyze` only writes `.powercodex/digest.json`; default `import` behaviour is unchanged. Rationale: safe to run on any existing repo; backward compatible.
- **Stories are a first-class artifact with provenance.** `.powercodex/stories/stories.json` holds structured stories (`id`, `title`, `asA`/`iWant`/`soThat`, `sources: []`, `status`); `stories.html` is a generated readable view. Rationale: each story cites the files it came from so the user can trust/verify it.
- **MVP accepts a digest, falls back to goal.** `proposeMvp(root, { goal, digest })` — when a digest is present it draws surfaces/features from real routes & components; otherwise it uses today's keyword path. Rationale: backward compatible, no regression for greenfield.
- **Freeze is an explicit status the loop honours.** Stories/MVP carry `status: "draft" | "frozen"`. `loop.js` reads frozen artifacts but never regenerates them; `Unlock for major change` flips back to `draft`. Rationale: enforces the user's "saved and never touched again until needed" requirement as state, not convention.
- **Refine-from-edits via diff.** On refine, the server computes a diff between the AI's last version and the user's edited version and passes it to the provider so it improves rather than replaces. With the simulated provider, refine is a deterministic merge that preserves user edits. Rationale: keeps self-test offline while modelling the real behaviour.
- **Compliance gains two dimensions** in `compliance.js`: `scoreStoriesGrounding(stories, digest)` (fraction of stories whose `sources` exist in the digest) and `scoreMvpAgainstStories(mvp, stories)` (keyword coverage of story intents). Rationale: reuses the existing explainable keyword approach.

## Risks / Trade-offs

- **Heuristic digest misses or mislabels features** → stories cite their source files and are presented as drafts the user must review before freezing; the user's edits are authoritative.
- **Regex walk is stack-specific (JS/TS)** → `digest.json` records `mode` and `coverage`; unknown stacks degrade to a thin digest and the goal-only MVP fallback still works.
- **Frozen state could block legitimate iteration** → explicit, one-click `Unlock for major change`, surfaced in the dashboard, with the unlock recorded on the status bus.
- **Template drift between `tools/lifecycle/` and `templates/starter/tools/lifecycle/`** → tasks include a parity step and the self-test runs against the tool copy; a verify step diffs the two trees.
- **Larger repos slow the walk** → digest walk skips `node_modules`, build output, and dotfolders, and caps file count/size with a recorded `truncated` flag.
