---
id: L003
slug: unref-guard-timers-break-isolated-timeout-tests
date: 2026-07-15
severity: minor
area: node, testing, timeouts
status: resolved
---

# L003 — An unref'd guard timer let the event loop exit before the timeout could fire

## What happened
`timeout.js`'s `withTimeout` created its guard timer with `setTimeout(...).unref()`, so
the timer would not keep the Node event loop alive. In the app that was harmless (the
HTTP server keeps the loop alive), but in isolated `node --test` cases — e.g. asserting
`withTimeout(new Promise(() => {}), 30)` rejects — the guard timer was the *only* pending
handle. The loop drained and node exited before the 30ms fired, so every test in the file
reported `cancelledByParent` / "Promise resolution is still pending but the event loop has
already resolved" (19/19 cancelled, 0 pass/fail).

## Why it was wrong
`unref()` on a *guard* timer contradicts the guard's purpose. The timer exists to fire
when the guarded work hangs; in a real hang it is often the last live handle, and unref
lets the process exit instead of rejecting. The timer is already `clearTimeout`'d when the
work settles, so it can only linger during an actual hang — exactly when it must stay
ref'd. I copied a "don't keep the process alive" reflex from fire-and-forget timers to a
timer whose whole job is to fire.

## Impact
One red test run; diagnosed and fixed in minutes (removed the `unref`). Caught by the
new integration tests before commit — no shipped damage.

## How to apply (the rule going forward)
Do not `unref()` a timer whose callback is the operation's only guaranteed completion
path (timeout guards, deadlines, watchdogs). Reserve `unref()` for best-effort timers
that must never delay process exit (periodic cache warmers, telemetry flushes). When a
timeout util is added, unit-test it in isolation against a never-settling promise — if
the loop can exit early, the guard is misconfigured.

## Related
- Commit: Tier 6 reliability pass (timeout.js, __tests__/lifecycle.test.js).
- File: tools/lifecycle/lib/timeout.js.
