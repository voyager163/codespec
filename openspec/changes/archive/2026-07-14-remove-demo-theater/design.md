## Context

The lifecycle loop (`tools/lifecycle/lib/loop.js`) drives a test → self-heal → observe cycle. Two hardcoded fabrications make an otherwise-fine run look eventful:

- `injectDefect` — computed as `r === 1 && opts.selfHeal !== false ? specs[0] : null` and passed into the simulated `e2eTester` (`tools/lifecycle/lib/engines.js`), whose `fail = injectDefect && spec === injectDefect` branch forces `specs[0]` to report FAIL on rotation 1. The downstream self-heal block then "repairs" it and re-runs with `injectDefect: null`, producing a scripted red→green cycle.
- `pickObservation(rotation)` — returns one of two hardcoded cards (`gap`, `improvement`) by `(rotation - 1) % list.length`, emitted each rotation as "Authored next spec from observation," incrementing `summary.observations` and feeding the consent-gated auto-apply path.

Neither reflects a real signal. The simulate-mode engine seam itself is honest (labeled "simulated") and is out of scope — only the fabricated drama layered on top is removed.

## Goals / Non-Goals

**Goals:**
- Remove `injectDefect` and `pickObservation` and every call site, so the loop reports only true test outcomes and real observations.
- Keep the loop runnable end to end in simulate mode, and keep the real self-heal / fix-mode / observe machinery intact and reachable when a genuine failure or observation occurs.
- Keep the self-test green by asserting honest behavior instead of the fabricated defect/observations.

**Non-Goals:**
- Building a real observation source or real e2e-against-preview — that is Gap 4, a separate change. This change leaves the observer step silent when no real source exists; it does not invent one.
- Touching the simulate/real engine seam, the dashboard rendering, or any other loop stage.

## Decisions

- **Delete `injectDefect` outright, not behind a flag.** Fabricated failures have no legitimate use; a "demo drama" toggle would just re-introduce theater one flag away. The 5 call sites in `loop.js` drop the argument; `e2eTester` drops the parameter and the `fail` branch, testing `spec` truthfully (in simulate mode that means honest passes). *Alternative considered:* keep it behind `opts.demoDefect` — rejected as YAGNI and contrary to the spec.
- **Delete `pickObservation` and the observer emission block, leaving no canned output.** The `observation` variable, its emit, the `summary.observations += 1`, and the `auto`/auto-apply-defect computation that depended on it are removed. The observer step becomes a no-op until a real source is wired (Gap 4). *Alternative considered:* return `null` from `pickObservation` — rejected; dead scaffolding for later invites the same theater back. Later can scaffold for itself.
- **Self-test moves from "assert the injected defect" to "assert honest behavior."** Replace any check that expected a rotation-1 failure or a canned card with checks that a clean simulate run stays green and emits no unsourced observation.

## Risks / Trade-offs

- **Loop control flow downstream of a real failure goes untested by the removed path.** → The fix-mode branches (manual/diff/auto), no-progress detector, and screenshot capture were previously exercised only via the fake failure. They remain wired and are covered by asserting they DON'T fire on a green run; a real-failure path test can come with Gap 4's real tester. Mark the now-quiet observer step with a `ponytail:` comment pointing at Gap 4.
- **`--demo` mode and the dashboard look calmer.** → Intended. Update any copy that promised visible self-heal/observation drama so it describes an honest run, not a scripted one.
- **`summary.observations` / self-heal counters read 0 in a clean simulate run.** → Correct — they were inflated by theater. Adjust the self-test expectations accordingly.

## Migration Plan

1. Remove `injectDefect` from `loop.js` (rotation-1 computation + 5 call sites) and from `e2eTester` in `engines.js` (signature + `fail` branch).
2. Remove `pickObservation` and the observer emission block in `loop.js`.
3. Update `selftest.js` to the honest-behavior assertions.
4. Run `npm run lifecycle:selftest` until green; run a `--demo` loop and confirm no fabricated failure or canned card appears.

Rollback: revert the change; no data or schema migration is involved.
