---
id: L003
slug: secondhand-claims-need-first-party-evidence
date: 2026-07-13
severity: major
area: planning
status: resolved
---

# L003 — Load-bearing claims from subagents were nearly written into binding documents without first-party verification

## What happened
While preparing the production handoff package, an explorer subagent reported "no dev server is ever actually launched — the preview URL is narrative only." The claim was about to be written into the design brief and used to justify a whole implementation phase, on the subagent's word alone. A review gate forced a direct check first (`grep` of the emit site and of every `child_process` call site), which confirmed it — but the verification happened because it was demanded, not because the workflow required it.

The same session's baseline skill-test showed the twin failure in the other direction: a handoff whose "verification" was a string-grep of generated source, standing in for whether a CSV download actually works in a browser. Both are one mistake: **evidence that looks sufficient substituting for evidence that is sufficient.**

## Why it was wrong
A subagent's report is a compressed secondhand summary; writing it into a decision document promotes it to a fact others will build phases on. The missing check was cheap (one grep) relative to the cost of a handoff phase justified by a wrong premise. Proxy checks (grep, compile, "selftest green") verify the artifact's *shape*, not the user-visible *behavior* the claim is actually about.

## Impact
None materialized — the claim was true. But only the forced check made the difference between "true" and "luckily true" in a document meant to steer smaller models that will not re-verify premises.

## How to apply (the rule going forward)
Before writing any claim into a spec, handoff, or decision log that a later task will build on: reproduce it first-party with the cheapest direct check (grep/run/read the line yourself) and record that evidence next to the claim. When specifying verification for others, state what each check does NOT prove; if the real behavior can only be observed somewhere you can't reach, label it ⛔ blocked-honest with the human task that unblocks it. The `reflective-mentor` skill (.claude/skills/reflective-mentor/) encodes both rules.

## Related
- specs/handoff-2026-07-13-0932/ (the package this protected)
- .claude/skills/reflective-mentor/SKILL.md
- L001 (verify a source before designing on it — this is L001 generalized to subagent reports and proxy checks)
