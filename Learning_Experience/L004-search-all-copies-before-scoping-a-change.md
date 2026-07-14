---
id: L004
slug: search-all-copies-before-scoping-a-change
date: 2026-07-14
severity: major
area: openspec
status: resolved
---

# L004 — Scoped a change to one copy of a duplicated module, missing the shipped vendored copy

## What happened
Implementing `remove-demo-theater`, I removed the `injectDefect` / `pickObservation` demo theater from `tools/lifecycle/lib/` (loop.js, engines.js, selftest.js) and reported the work complete with a full-tree grep claim of "five call sites." The change's Impact section and a full-tree grep both should have surfaced that a **second, git-tracked copy** of the same engine lives at `templates/starter/tools/lifecycle/lib/` — the copy that is copied into every generated app. It still contained the identical theater. A Stop-hook review forced the full-tree grep that exposed it.

## Why it was wrong
I scoped the change from the paths I already had in context (the dev copy) instead of first grepping the **whole tree** for the symbols being removed. This repo vendors a starter template that duplicates the lifecycle engine; the two copies have drifted (different self-heal logic) so they are not auto-synced. Removing theater from the dev copy while the shipped copy keeps fabricating defeats the change's entire purpose ("never ship theater") — and the shipped copy is the more user-facing instance.

## Impact
The change was declared done while the user-facing starter still shipped the fabricated red→green cycle and canned observations. No wrong code merged (caught pre-commit by the review hook), but the "Implementation Complete / 169/169" report was premature and would have shipped a lie to every scaffolded app.

## How to apply (the rule going forward)
Before scoping OR closing a deletion/refactor change, run `grep -rn "<symbol>" .` across the **entire tree** (excluding node_modules/.git) for every identifier being removed. If the repo vendors or duplicates a module (look for `templates/`, `vendor/`, `starter/`, worktrees), treat each tracked copy as in-scope unless a copy is explicitly a different branch's worktree. Never report "N call sites" from in-context files alone — cite the full-tree grep.

## Related
[[remove-demo-theater]] · openspec/changes/remove-demo-theater · L003 (first-party evidence for load-bearing claims).
