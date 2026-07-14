## Why

"Verified to work" is the second half of the product's promise, and it's currently hollow. Real testing today has two tiers: a real build gate (`codegen.verifyBuild` — an honest tsc compile check) and a real live-smoke-test that only runs against a *published* app through the managed-Edge/tenant browser (`engines.real.js`, requires publish + sign-in — Gap 3 territory). Neither runs the maker's own `e2e/*.spec.ts` Playwright suite against the local preview. `loop.js` still passes a hardcoded placeholder spec list (`projects-grid.spec.ts`, `status-chip.spec.ts`, `new-project.spec.ts`) that matches no file on disk, and the simulated tester (post `remove-demo-theater`) just reports honest passes for whatever names it's handed — an inert stub, not a real check. Worse: the scaffolded `e2e/home.spec.ts` only tests the starter's default counter demo; codegen mounts a generated screen as a new route without ever touching `e2e/`, so a maker's actual feature is never exercised by any test, real or otherwise. A build that compiles is not a build that works.

## What Changes

- **Run the project's real `e2e/*.spec.ts` suite against the local preview server**, using Playwright when available (`hasPlaywright` already resolves this) and the dev server `preview.js` already starts honestly (parses the real port from stdout, never fabricates a URL). This needs no tenant, no MDM sign-in, no publish — same "no sign-in needed to build" posture the build gate already has.
- **Generate an e2e spec for the maker's actual screen**, alongside the existing schema-driven screen/type/seed generation (`generateScreen`/`ensureDataSeam` in `codegen.js`), so "verified to work" covers the feature that was built — not just the starter's counter demo, which stays as its own separate check.
- **Replace the hardcoded placeholder spec list in `loop.js`** with real spec-file discovery from the project's `e2e/` directory.
- **Feed genuine Playwright results into `e2eTester`**: real pass/fail per spec, real failure messages, so the self-heal / fix-mode / no-progress-detector machinery (already real, untouched by this change) reacts to something true.
- **BREAKING** for anything relying on the current placeholder spec names or the simulated tester's unconditional-pass behavior when specs are supplied — those become genuine results.

## Capabilities

### New Capabilities
- `preview-e2e-verification`: the lifecycle loop runs the maker's own e2e specs against the live local preview and reports genuine results — no fabrication, no reliance on a published/tenant app.

### Modified Capabilities
<!-- None. The existing real-engine resolution (engines.js resolveEngines / makeRealEngine), the MDM live-smoke-test tier, and the build gate are unmodified — this adds a new local-preview verification tier alongside them, it does not change their requirements. -->

## Impact

- **Code**: `tools/lifecycle/lib/engines.js` (new local-preview e2e path in `makeRealEngine`'s `e2eTester`, using `preview.js` + Playwright, distinct from the existing MDM `browser.e2eTester` tier), `tools/lifecycle/lib/loop.js` (replace the hardcoded spec list with real discovery from `e2e/`), `tools/lifecycle/lib/codegen.js` (generate an e2e spec per generated screen, mirroring the existing schema-driven generation pattern).
- **Starter**: this lands in `tools/lifecycle/` (dev copy); per `sync-starter-lifecycle-engine`, it reaches `templates/starter/tools/lifecycle/` via sync rather than needing a second hand-implementation.
- **Tests**: `tools/lifecycle/lib/selftest.js` gains checks for real spec discovery, generated-spec correctness, and honest pass/fail reporting from an actual Playwright run.
- **No new dependency in the lifecycle tool itself** — Playwright is already an optional starter devDependency, resolved via the existing `hasPlaywright`/`browserBased` recommendation logic; nothing becomes newly required.
- **Depends on**: `preview.js` (already real in the dev copy) and, for it to reach generated apps, `sync-starter-lifecycle-engine` landing first (or this change's code being manually verified against the starter in the interim).
