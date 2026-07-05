---
id: L002
slug: keep-openspec-requirements-behavioral
date: 2026-07-05
severity: minor
area: openspec, spec-authoring
status: resolved
---

# L002 — Leaked implementation detail into an OpenSpec requirements delta

## What happened
Authored the `add-agent-harness` delta spec (`specs/agent-harness/spec.md`) with
internal implementation details embedded directly in the requirements and scenarios:
function names (`compose`, `detectMode`, `pickCodeappsSkill`), a literal marker string
(`POWERCODEX HARNESS`), and a specific mechanism ("self-contained system preamble").
Several terms were also left operationally undefined (substantive turn, status bus,
prompt-logging telemetry). Review flagged it as mixing product requirements,
implementation, and policy, and as overfitting to one harness architecture.

## Why it was wrong
An OpenSpec delta describes observable capability behaviour (the WHAT). The chosen
mechanism and internal API surface belong in `design.md` (the HOW). Naming internal
functions and mechanisms inside requirement text over-couples the spec to one
implementation, hurts reuse, and makes the requirement untestable as written. I
carried design-doc content into the requirements file instead of keeping the two
layers separate.

## Impact
Spec rated "medium quality; needs tightening" in review — a rewrite pass required
before implementation planning could proceed. No shipped damage (caught at the spec
review gate).

## How to apply (the rule going forward)
When writing an OpenSpec delta requirement or scenario: phrase it in behavioural,
mechanism-agnostic terms and define any non-obvious term inline. Keep internal
function names, marker strings, and the chosen mechanism in `design.md`. Make each
scenario assert an observable behaviour; for content that is guidance injected into an
LLM, assert "the guidance is present," never an unprovable downstream outcome (e.g.
"the agent preserved accessibility").

## Related
- Spec: openspec/changes/add-agent-harness/ (proposal, design, specs/agent-harness)
- Prior lesson on order-of-operations: [[L001]]
