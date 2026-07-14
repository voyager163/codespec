## 1. Remove the fabricated defect

- [x] 1.1 In `tools/lifecycle/lib/engines.js`, drop `injectDefect` from the `e2eTester` signature and delete the `fail = injectDefect && spec === injectDefect` branch so each spec reports its true outcome.
- [x] 1.2 In `tools/lifecycle/lib/loop.js`, delete the rotation-1 `injectDefect` computation (`const injectDefect = r === 1 && ...`).
- [x] 1.3 Remove the `injectDefect` argument from all `eng.e2eTester(...)` call sites (the initial call and each re-run after heal / fix-mode).

## 2. Remove the fabricated observation

- [x] 2.1 In `tools/lifecycle/lib/loop.js`, delete the `pickObservation` function.
- [x] 2.2 Remove the observer emission block that calls `pickObservation`, emits "Authored next spec from observation," increments `summary.observations`, and computes the `auto` auto-apply flag from a canned defect.
- [x] 2.3 Leave the observer step reachable but silent, with a `ponytail:` comment noting a real observation source is Gap 4 (e2e-against-preview).

## 3. Keep the loop honest and green

- [x] 3.1 Confirm the simulate-mode engine bundle and the real self-heal / fix-mode paths remain intact and reachable (no accidental removal of genuine-failure handling).
- [x] 3.2 Update `tools/lifecycle/lib/selftest.js`: replace any assertion of a rotation-1 injected defect or a canned observation with checks that a clean simulate run stays green and emits no unsourced observation.
- [x] 3.3 Update `--demo`/dashboard copy that promised visible self-heal or observation drama to describe an honest run.

## 4. Mirror the removal into the vendored starter copy

- [x] 4.1 Full-tree grep for `injectDefect`/`pickObservation`; confirm the git-tracked `templates/starter/tools/lifecycle/lib/` copy (shipped into generated apps) carries the identical theater.
- [x] 4.2 Apply the same removal to the starter's `engines.js` (`e2eTester`), `loop.js` (`injectDefect` + `pickObservation` → honest heartbeat), `selftest.js` (honest assertions), and `dashboard.js` (empty-state copy).
- [x] 4.3 Baseline the committed starter selftest to confirm the theater removal introduces no new failure (the starter's 2 pre-existing failures — `push-vs-dev rule`, `starterDir` helper — predate this change and are out of scope).

## 5. Verify

- [x] 5.1 Run the dev-copy `npm run lifecycle:selftest` and confirm it passes.
- [x] 5.2 Run a loop directly and confirm the event stream has no fabricated failure and no canned observation card; the run reports honest passes only.
- [x] 5.3 Run `openspec validate remove-demo-theater` and confirm the change is valid.
