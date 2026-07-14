## Why

`templates/starter/tools/lifecycle/` — the lifecycle engine scaffolded into every generated app — is a hand-maintained fork of `tools/lifecycle/` (the dev copy) that has fallen behind it. Three whole files are missing from the starter (`preview.js` — the real vite dev-server live preview; `pac-init.js` — `pac code init`/`pac code push` Code App registration; `dataverse-schema.js`), 8 more files differ in content, and `bin/powercodex-lifecycle.js` is missing entire CLI subcommands (`dataverse`, `code-init`, `code-push`) and the `--fix-mode`/`--max-heal-retries` flags. This is not cosmetic drift: every generated app is born without live preview and without Code App registration — the two features closest to the product's "compliant Code App with live preview" promise. The same dual-maintenance already caused the demo-theater fix (a prior change) to need doing twice, once in each copy, and it was only caught by review. Left as-is, Gap 3 (real Publish) and Gap 4 (real e2e-against-preview) would each need re-implementing per copy, doubling their cost and risking the same silent lag.

## What Changes

- **Make `templates/starter/tools/lifecycle/` a generated copy of `tools/lifecycle/`**, mirroring the existing `desktop/scripts/sync-lifecycle.js` pattern (which already vendors `tools/lifecycle/` → `desktop/vendor/lifecycle/`). A sync script copies the dev tree into the starter tree, excluding only a short, explicit list of genuinely dev-only content (e.g. the "Create a new app" scaffold-from-`templates/starter` selftest block, which cannot run from inside an already-scaffolded app since `templates/starter` doesn't exist there).
- **Run the sync now** so the starter immediately gains `preview.js`, `pac-init.js`, `dataverse-schema.js`, the missing CLI subcommands, and the `--fix-mode` self-heal — closing the feature gap in one pass rather than porting each file by hand.
- **Add a drift guard**: a check (wired into the dev selftest, matching the existing "vendored starter stays in lockstep" check already present in the starter's own selftest) that fails if the starter tree differs from a fresh sync of the dev tree, so this class of bug cannot silently recur.
- **BREAKING for anyone who hand-edited `templates/starter/tools/lifecycle/` directly** — any such edits are overwritten by the next sync and must be made in `tools/lifecycle/` instead. This includes hand-edits already made to the starter copy during the recent demo-theater removal (theater removal, the `pac code push` string fix, and the desktop-scaffold-block removal from its selftest); the sync from dev supersedes them since dev already carries the equivalent fixes.

## Capabilities

### New Capabilities
- `starter-lifecycle-parity`: `templates/starter/tools/lifecycle/` is generated from `tools/lifecycle/` (not hand-maintained), so every generated app always ships the current dev feature set, and drift is caught automatically rather than discovered by accident.

### Modified Capabilities
<!-- None. Starter provenance is a build-time concern for the vendored lifecycle tree, not a change to the initializer's project-copy behavior (powercodex-initializer's "Starter Template Copy" requirement governs copying templates/starter into a new project, which is unaffected). -->

## Impact

- **Code**: new `scripts/sync-starter-lifecycle.js` (mirroring `desktop/scripts/sync-lifecycle.js`'s pattern) that copies `tools/lifecycle/` → `templates/starter/tools/lifecycle/` wholesale (skipping only runtime/generated dirs — no content exclusion list); `templates/starter/tools/lifecycle/**` becomes generated output (still git-tracked, since the starter must work when cloned/downloaded standalone).
- **Tests**: `tools/lifecycle/lib/selftest.js` gains a drift-guard check; the starter's own selftest (already testing the copy it ships) is regenerated from dev's and gains dev's full assertion set.
- **Docs**: note in `tools/lifecycle/README.md` (or a new `CONTRIBUTING` note) that `templates/starter/tools/lifecycle/` is generated — do not hand-edit.
- **No dependency changes** — both trees remain zero-dependency.
- **Unblocks**: Gap 3 (real Publish) and Gap 4 (real e2e-against-preview) can now land once in `tools/lifecycle/` and reach every generated app via sync, instead of needing per-copy implementation.
