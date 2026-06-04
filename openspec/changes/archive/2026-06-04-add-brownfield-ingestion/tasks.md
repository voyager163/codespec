## 1. Repo digest (Change A)

- [x] 1.1 Create `tools/lifecycle/lib/digest.js` with a `buildDigest(targetRoot, opts)` that walks `src/` and config files, excluding `node_modules`, build output, and dotfolders
- [x] 1.2 Detect routes/pages, components, connector/data calls, and npm scripts via lightweight regex; record the source file path for every surface
- [x] 1.3 Reuse/extend `detectStack()` so the digest records `mode` ("tenant" vs "local-run")
- [x] 1.4 Bound the walk (file count/size caps), skip unparseable files gracefully, and record `coverage`/`truncated`
- [x] 1.5 Add the `--analyze` flag to `import.js` so it writes `.powercodex/digest.json` without touching the user's source tree
- [x] 1.6 Confirm default `import` (no `--analyze`) behaviour is unchanged

## 2. Code-grounded stories & MVP (Change B)

- [x] 2.1 Create `tools/lifecycle/lib/stories.js` that reads a digest and produces `stories.json` (each story with `id`, intent fields, `sources[]`, `status`)
- [x] 2.2 Render a readable `.powercodex/stories/stories.html` view from `stories.json`
- [x] 2.3 Extend `mvp.js` `proposeMvp(root, { goal, digest })` to ground the MVP in digest surfaces; preserve goal-only fallback when no digest
- [x] 2.4 Add `scoreStoriesGrounding(stories, digest)` and `scoreMvpAgainstStories(mvp, stories)` to `compliance.js`, each with an explainable reason
- [x] 2.5 Guarantee no code-grounded stories are fabricated when no digest exists

## 3. Review → refine → freeze (Change C)

- [x] 3.1 Add a `status` field (`draft`/`frozen`) to stories and MVP artifacts
- [x] 3.2 Implement refine-from-edits: compute a diff of prior vs user-edited version and feed it to the provider; deterministic merge under the simulated provider
- [x] 3.3 Teach `loop.js` to read frozen artifacts but never regenerate or overwrite them
- [x] 3.4 Add server actions in `server.js` for edit, refine, Approve & Freeze, and Unlock for major change, plus a stories endpoint
- [x] 3.5 Ensure the loop has no path to flip `frozen` → `draft`; only the explicit unlock action can
- [x] 3.6 Emit freeze/unlock events to the status bus

## 4. Dashboard surface

- [x] 4.1 Add a stories panel to `assets/dashboard.html` showing each story with its cited source files
- [x] 4.2 Add edit, refine, Approve & Freeze, and Unlock controls; reflect frozen state visually
- [x] 4.3 Show the new compliance dimensions (stories↔code, MVP↔stories)

## 5. Self-test & verification

- [x] 5.1 Extend `selftest.js` to build a digest from a throwaway repo and assert surfaces with provenance
- [x] 5.2 Assert stories + grounded MVP are generated and that goal-only fallback still works
- [x] 5.3 Assert refine preserves user edits and that a frozen artifact is not rewritten by the loop; assert unlock reopens it
- [x] 5.4 Confirm total self-test checks pass (existing 53 + new assertions)

## 6. Template parity & docs

- [x] 6.1 Mirror all `tools/lifecycle/` changes under `templates/starter/tools/lifecycle/`
- [x] 6.2 Diff the two lifecycle trees to confirm parity
- [x] 6.3 Update `tools/lifecycle/README.md` (and starter copy) to document `import --analyze`, stories, and the freeze flow
- [x] 6.4 Run `npm run verify` and the lifecycle self-test; confirm green
