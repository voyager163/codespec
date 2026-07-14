## Context

Verified today: `resolveEngines` in `tools/lifecycle/lib/engines.js` already has two real verification tiers — `codegen.verifyBuild` (a real tsc compile, no tenant needed) and `engines.real.js`'s `e2eTester` (a generic navigation + page-error + failed-request smoke test via a managed-Edge/CDP session against a captured `baseUrl`, which requires a published app and tenant sign-in). Neither runs the project's own `e2e/*.spec.ts` files. `loop.js` passes a hardcoded placeholder spec list (`projects-grid.spec.ts`, `status-chip.spec.ts`, `new-project.spec.ts`) matching no file on disk. The starter already ships a working, standalone Playwright setup — `playwright.config.ts` with a `webServer` block that boots its own dev server, `e2e/home.spec.ts` testing the counter demo, `npm run e2e` → `playwright test`. Verified: `codegen.wireRouter` mounts a generated screen as a new child route without touching `e2e/`, so a maker's generated feature is never exercised by any spec, real or otherwise.

`playwright-check.js` (`hasPlaywright`, `browserBased`) already resolves whether Playwright is installed and whether the project is UI-based, and is already used to decide whether to recommend installing it — this change reuses that resolution rather than duplicating it.

## Goals / Non-Goals

**Goals:**
- Run the project's real `e2e/*.spec.ts` files against a real local preview server (via `preview.js`), with genuine pass/fail, no tenant/MDM dependency.
- Generate an e2e spec for each generated screen, so verification covers the maker's actual feature.
- Replace the hardcoded spec list in `loop.js` with real discovery from `e2e/`.
- Keep the existing self-heal/fix-mode/no-progress-detector machinery untouched — it already consumes `{ failures, coverage, passed }` from whichever tester ran; this change only makes that tester's local-preview tier real.

**Non-Goals:**
- Not replacing or modifying the MDM live-smoke-test tier (`engines.real.js`) — that remains the real verification path for a *published* app and belongs to Gap 3 (Publish).
- Not modifying the build gate (`codegen.verifyBuild`) — already real, untouched.
- Not adding Playwright as a hard dependency — it stays optional, resolved the same way it already is (`hasPlaywright`), with an honest degrade when absent.
- Not building a general-purpose Playwright test generator for arbitrary UI — the generated spec is scoped to what `deriveSchema`/`generateScreen` already know (route, entity label, one field), matching the same scope discipline `schema-driven-codegen` used for the screen itself.

## Decisions

- **Local-preview e2e is a new tier inside `makeRealEngine`'s `e2eTester`, sequenced after the build gate and before/independent of the MDM smoke test.** `codeApp` build-check already runs first; this change adds a check reusing `preview.js` + a real Playwright run when `hasPlaywright(root)` is true and `e2e/` has spec files, regardless of whether a `baseUrl`/tenant browser is available. *Alternative considered:* folding local e2e into `engines.real.js` alongside the MDM tier — rejected because that engine's whole reason to exist is the CDP/managed-Edge session; local Playwright needs no browser attach at all and is simpler kept separate.
- **Discover specs from disk (`fs.readdirSync('e2e')` filtered to `*.spec.ts`), not a config file.** Matches the zero-dependency, zero-config posture of the rest of the tool. *Alternative considered:* reading `playwright.config.ts`'s `testDir` — more correct in theory, rejected as unnecessary complexity since the starter's `testDir` is always `./e2e` by convention and codegen already knows that path.
- **Run Playwright via its own CLI (`npx playwright test`, or the already-optional `@playwright/test` runner), not a hand-rolled spec executor.** The zero-dependency lifecycle tool doesn't itself depend on Playwright; it shells out only when `hasPlaywright` is true, same posture as the existing MDM engine's lazy `require('./engines.real')`. *Alternative considered:* invoking `@playwright/test`'s programmatic API directly — more control over output parsing, but couples the lifecycle tool's own code to Playwright's API surface; shelling out and parsing the JSON reporter is simpler and matches "bring your own tooling."
- **The generated e2e spec is schema-scoped, mirroring `generateScreen`'s own scope discipline**: assert the route loads and the entity's label (or first field) is visible — not a full CRUD flow. A thin, honest spec beats a fabricated comprehensive one. *Alternative considered:* generating add/edit/delete assertions matching every screen capability — deferred; the spec should grow only as confidently as the screen generator itself is willing to assert behavior, and `generateScreen` already keeps capability flags conditional on schema support.
- **`home.spec.ts` (the starter's own demo) is never touched by codegen.** Two independent spec files coexist — the starter's own sanity check and the maker's generated one — rather than one file trying to serve both purposes.

## Risks / Trade-offs

- **A real Playwright run is slower than the previous inert stub** (seconds, not milliseconds) — the loop's rotations will take longer in real mode. → Accepted; this is the cost of genuine verification, matching the build gate's own real (non-instant) compile time. No masking with a timeout that silently falls back to fabrication.
- **CI / headless environments may lack a browser binary** even with `@playwright/test` installed (`npx playwright install` is a separate step). → Degrade honestly (report why local e2e didn't run) rather than treat a missing browser binary as "Playwright not available" — different message, same non-fabricating behavior, per the honest-degrade requirement.
- **A maker's hand-edited generated screen may drift from its generated spec.** → Accepted for this change: the spec is generated once alongside the screen; keeping them in sync after manual edits is a hand-authoring problem no different from spec/code drift on any handwritten test, and out of scope here.
- **Overlap with `sync-starter-lifecycle-engine`**: this change's code lands in `tools/lifecycle/`; until that sync change runs, generated apps built from the still-hand-maintained starter copy won't have this tier. → Sequencing note only, not a blocker to drafting or implementing this change in dev; the two changes compose independently.

## Migration Plan

1. Add real spec discovery (`e2e/*.spec.ts` on disk) to `loop.js`, replacing the hardcoded placeholder list.
2. Add the local-preview e2e tier to `makeRealEngine`'s `e2eTester` in `engines.js`: start/reuse `preview.js`, run discovered specs via Playwright, parse genuine results.
3. Add schema-scoped e2e spec generation to `codegen.js`, alongside `generateScreen`/`ensureDataSeam`.
4. Extend `selftest.js`: real spec discovery, generated-spec content, and an end-to-end check that a genuine Playwright failure surfaces through to the loop's failure list.
5. Run `npm run lifecycle:selftest` until green.

Rollback: revert; no data or schema migration involved. Playwright remains optional throughout.
