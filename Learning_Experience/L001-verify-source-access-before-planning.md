---
id: L001
slug: verify-source-access-before-planning
date: 2026-06-03
severity: major
area: research, planning
status: resolved
---

# L001 — Planned against a reference repo before confirming I could actually read it

## What happened
While planning the Playwright-for-MDM automation work, I treated `ElfredSeow/Playwright-for-MDM-Browser` as a usable source and began designing around its assumed mechanics. The repo turned out to be **private** — I had no read access — so the MDM details were inferred from generic managed-Edge patterns, not the actual reference.

## Why it was wrong
I committed to a plan that depended on a source before running the cheap check of whether the source was reachable. Access is a precondition; assuming it inverts the order of operations and risks building on invented details.

## Impact
The MDM plan carries an explicit caveat that its mechanics are inferred, not verified — a known accuracy gap that has to be revisited if/when access is granted. Recorded in the auto-memory `mdm-automation-plan` entry.

## How to apply (the rule going forward)
Before designing or planning against any external source (repo, API, doc, dataset), **first verify it is reachable** (fetch it / confirm permissions). If it is not, say so explicitly, label any derived content as *inferred*, and ask whether to proceed on assumptions or get access first. Never present inferred mechanics as if they came from the source.

## Related
- Auto-memory: [[mdm-automation-plan]]
- Plan: docs/plans/mdm-automation-workflow-plan.html
