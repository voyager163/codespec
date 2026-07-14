## Context

`tools/lifecycle/` (dev copy, 41 lib files) and `templates/starter/tools/lifecycle/` (starter copy, 38 lib files, scaffolded into every generated app) have been hand-maintained as two forks since the starter was first vendored. Verified drift as of this change: `preview.js`, `pac-init.js`, and `dataverse-schema.js` are entirely absent from the starter; 8 further files differ in content; `bin/powercodex-lifecycle.js` is missing the `dataverse`/`code-init`/`code-push` CLI subcommands and the `--fix-mode`/`--max-heal-retries` flags. A prior change (`remove-demo-theater`) had to fix the same theater bug twice — once per copy — and was only caught by a review gate, not by any mechanism in the repo.

`desktop/scripts/sync-lifecycle.js` already establishes the pattern this change generalizes: it copies `tools/lifecycle/` → `desktop/vendor/lifecycle/` (and `templates/starter/` → `desktop/vendor/templates/starter/`) wholesale, with a `SKIP` regex for runtime/generated dirs (`node_modules`, `.powercodex`, `.profiles`, `.git`, `dist`). Verified: `templates/starter/tools/lifecycle/lib/server.js` imports only `{ scaffold, installDeps, isScaffolded }` from `scaffold.js` — never `scaffoldFromStarter`/`starterDir` — so `scaffold.js` can sync wholesale with no functional harm; the dev copy's superset exports are simply unused by the starter. The only genuine dev-only content found is a block inside `selftest.js` (the "desktop 'Create a new app' lands the full starter" checks) that resolves `templates/starter` itself, which does not exist inside an already-scaffolded project.

**Verified during implementation:** `starterDir()` already returns `null` when no `templates/starter` is resolvable (its documented behavior). That makes the dev-only `selftest.js` block guardable *at runtime* with `if (starterDir())`, so the identical file runs correctly in both the dev tree (block runs) and the scaffolded/starter tree (block self-skips) — which means the sync needs **no content exclusion at all** and stays a pure whole-tree copy exactly like the desktop model. `cpSync`'s filter can only exclude whole files, never a block inside one, so a file-level exclude list could never have targeted this block anyway.

## Goals / Non-Goals

**Goals:**
- `templates/starter/tools/lifecycle/` becomes the output of a sync script run against `tools/lifecycle/`, not a hand-edited fork.
- Running the sync now closes the verified gap: starter gains `preview.js`, `pac-init.js`, `dataverse-schema.js`, the missing CLI subcommands, and the fix-mode self-heal.
- A drift-guard check (wired into the dev selftest) fails loudly if the starter tree is ever hand-edited out of sync with a fresh run.
- Dev-only content is handled explicitly and as narrowly as possible — ideally with zero sync-time exclusions.

**Non-Goals:**
- Not changing what `powercodex-initializer` copies into a *new project* (`templates/starter` → target folder) — that requirement is untouched; this change only concerns how `templates/starter/tools/lifecycle/` itself is produced.
- Not implementing Gap 3 (real Publish) or Gap 4 (real e2e-against-preview) — this change only ensures that once they land in `tools/lifecycle/`, they reach the starter automatically.
- Not touching `desktop/vendor/`; `desktop/scripts/sync-lifecycle.js` already handles that tier and is unaffected (it syncs from `tools/lifecycle/` and `templates/starter/`, both of which remain in place).

## Decisions

- **Sync at the file-tree level (`fs.cpSync` + exclude filter), not per-symbol.** Matches the existing `desktop/scripts/sync-lifecycle.js` pattern exactly — same tool, same mental model, easiest to review and maintain. *Alternative considered:* a build step that imports from `tools/lifecycle/` at runtime (no physical copy) — rejected because the starter must be self-contained and runnable standalone after a repo clone/download, with no reference back to the monorepo's dev tree.
- **Zero sync-time exclusions; the one dev-only block self-skips at runtime instead.** The sync is a pure whole-tree `fs.cpSync` (same as the desktop model). The single dev-only concern — the "desktop 'Create a new app'" block in `selftest.js` — is wrapped in `if (starterDir())`, which is already `null` in a scaffolded app, so the identical file is correct in both trees and stays byte-for-byte in sync (the drift guard requires that). *Alternatives considered and rejected:* (a) a named exclude array with a file-level `cpSync` filter — impossible, the filter excludes whole files, not a block inside `selftest.js`; (b) an inline marker-pair (`// sync:exclude-start/end`) the script strips — adds a parser and, worse, makes the starter's `selftest.js` diverge from dev's, which the byte-for-byte drift guard would then flag forever. A runtime guard keeps one identical file across both trees with no sync-time surgery.
- **The synced tree stays git-tracked**, not gitignored. The starter must work when downloaded/cloned standalone (npm-init-style), so `templates/starter/tools/lifecycle/**` must exist as real files in the repo — the sync is a maintenance-time regeneration step (like a lockfile), not a build-time-only artifact.
- **Drift guard: diff a fresh in-memory sync against disk, not a checksum manifest.** Re-running the same `cpSync`+exclude logic used for the real sync and comparing to the tree on disk is the simplest thing that cannot drift from the sync itself (a separate checksum file would need its own update discipline and could itself go stale). *Alternative considered:* a committed hash manifest — rejected as one more file that can be forgotten.
- **The prior hand-edits to the starter (theater removal, `pac code push` fix, desktop-block removal from its selftest) are superseded, not preserved as a merge.** `tools/lifecycle/` (dev) already carries the equivalent fixes from the same session; the sync simply overwrites the starter with dev's content, which is a superset. No manual reconciliation needed — verified by inspection that dev's `loop.js`/`engines.js`/`selftest.js` contain the same honest-loop behavior the starter hand-edits introduced.

## Risks / Trade-offs

- **A future genuinely-starter-only need can't ride a runtime guard** (e.g. a file that must exist only in dev). → Then reach for a whole-*file* `cpSync` filter entry at that point — reviewed in a PR, kept explicit. The current change needs none: the only dev-only concern is a partial-file block, which the runtime guard handles without any exclusion.
- **Files sync 1:1 even where the starter doesn't strictly need every export** (e.g. `scaffold.js` ships `scaffoldFromStarter`/`starterDir`, unused by starter runtime). → Accepted: dead exports in a generated file are harmless and far cheaper than maintaining a second exclude rule per symbol. Whole-file sync keeps the mechanism simple.
- **Running the sync overwrites in-flight hand-edits to the starter without warning.** → The drift-guard check makes this visible immediately (next selftest run fails), and the proposal documents the BREAKING nature of hand-editing the starter directly.
- **CLI subcommands newly available in the starter (`dataverse`, `code-init`, `code-push`) were previously untested there.** → Out of scope to newly verify their *behavior* in this change (that's what the dev selftest already covers, and it flows over via sync); this change is responsible for the copy mechanism and drift detection, not auditing each newly-arrived feature.

## Migration Plan

1. Guard the dev-only `selftest.js` block with `if (starterDir())` so the same file is valid in both trees, and add the drift-guard check (both edits in `tools/lifecycle/lib/selftest.js`, made *before* the first sync so they propagate).
2. Add the sync script (`scripts/sync-starter-lifecycle.js`) — a pure whole-tree `fs.cpSync` with the runtime-dir `SKIP` regex, exporting `sync()` and `drift()`, modeled on `desktop/scripts/sync-lifecycle.js`. Wire `sync:starter` into `package.json`.
3. Run it once against the current `tools/lifecycle/` to regenerate `templates/starter/tools/lifecycle/`.
4. Run `npm run lifecycle:selftest` (dev, includes the drift guard) and the starter's own selftest; both pass with zero exclusions. Re-run the sync after any later dev edit so drift stays empty.
5. Document in `tools/lifecycle/README.md` that `templates/starter/tools/lifecycle/` is generated — do not hand-edit.

Rollback: revert the sync script and the regenerated starter tree via git; no data or schema migration is involved.
