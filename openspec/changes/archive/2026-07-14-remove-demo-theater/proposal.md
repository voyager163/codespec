## Why

The lifecycle loop fabricates results to make itself look impressive: on rotation 1 it scripts a fake test failure (`injectDefect`) so the self-heal machinery visibly "repairs" a defect that never existed, and it emits hardcoded "observations" (`pickObservation`) cycled by rotation number as if the observer had authored specs from real signals. This is demo theater — scripted output presented as real work — and it directly contradicts the product's "never theater / never fabricate success" contract that already governs code generation and intake. On the production-readiness path this is Gap 2: the loop cannot be trusted while it manufactures its own drama.

## What Changes

- **Remove `injectDefect`** — delete the rotation-1 fake-failure trigger in the loop and the `injectDefect` parameter/branch in the simulated `e2eTester`. The tester reports only the true pass/fail of the specs it is given. **BREAKING** for anyone relying on the scripted red→green cycle in demos.
- **Remove `pickObservation`** — delete the hardcoded gap/improvement observation cards and the loop's per-rotation emission of "Authored next spec from observation." No canned observations are emitted; the observer step is silent unless a real observation source exists.
- **Keep the honest seam intact** — the simulate-mode engine bundle (clearly labeled "simulated") and the real self-heal / fix-mode / observe machinery stay. The loop still runs end to end; it just shows honest passes and real observations only, or nothing.
- Update the lifecycle self-test and any dashboard/demo copy that asserted the fabricated defect or canned observations.

## Capabilities

### New Capabilities
- `honest-loop-reporting`: the lifecycle loop reports only real test outcomes and real observations — it never fabricates a failure, a repair, or an observation to make progress appear.

### Modified Capabilities
<!-- None. The loop requirements live in the still-active add-lifecycle-loop delta, not the main spec; this change adds a standalone honesty guarantee rather than modifying an unsynced requirement. -->

## Impact

- **Code (two copies — the engine is vendored into the starter)**: `tools/lifecycle/lib/loop.js` (remove `injectDefect` computation at rotation 1 and its 5 call sites; remove `pickObservation` function and the observer emission block) and `tools/lifecycle/lib/engines.js` (drop `injectDefect` from `e2eTester` signature and the fabricated-fail branch); **the same removal in the git-tracked `templates/starter/tools/lifecycle/lib/` copy** that is scaffolded into every generated app (fewer call sites there — the starter's self-heal is a simpler variant — but the same `injectDefect` + `pickObservation` theater).
- **Tests**: `tools/lifecycle/lib/selftest.js` — any check asserting the injected defect or canned observations must move to asserting honest behavior (no fabricated failure; no observation without a source).
- **Demo/UX**: `--demo` mode and the dashboard will show a calmer, truthful run (green passes, no scripted red→green, no canned cards). Copy that promised visible self-heal drama is updated.
- **No dependency changes.** Follow-on changes cover real e2e-against-preview (Gap 4), the Publish surface (Gap 3), onboarding (Gap 5), and packaging (Gap 6).
