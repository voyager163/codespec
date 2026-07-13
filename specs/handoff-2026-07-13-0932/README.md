# PowerCodex Production Handoff — 2026-07-13 09:32

Prepared by Claude Fable 5 as a mentorship handoff to Opus / Sonnet executors.
Grounded in a full-codebase exploration (desktop shell, lifecycle engine, templates, MCP, openspec) on branch `feat/strengthen-the-PRD`.

## The one-paragraph brief

PowerCodex is "Lovable for Power Platform": a desktop agentic vibe-coding tool where a citizen developer describes an app in plain language, watches it come alive in a **live localhost preview with local mock data**, and clicks **Publish** to push it to Power Platform as a real Code App (`pac code push`). Today the harness, CLI, and MCP layers are production-grade; the desktop product is a polished chat shell whose two defining features — live preview and real publish — were not yet wired when this package was written. **Re-baseline 2026-07-13 PM:** live preview is now wired (G1 closed) and publish is committed but not one-click (G2 partial); bespoke codegen + the data seam (G3/G4) are the top blockers — see the re-baseline note in [01-design-brief.md](01-design-brief.md). Closing the remaining gap, honestly and without demo theater, is the work described here.

## Reading order (the 4-part reflection)

| Part | What it answers | Document |
| --- | --- | --- |
| 1. Product brief | What the tool is, who it's for, what "done" looks like | [01-design-brief.md](01-design-brief.md) |
| 2. Execution spec | Exact workflow, data flow, preview/publish behavior, harness requirements | [02-implementation-plan.md](02-implementation-plan.md) |
| 3. Mentorship spec | How to guide smaller models, review their work, generate artifacts | [05-reflective-prompt-pack.md](05-reflective-prompt-pack.md) §A |
| 4. Reflection skill spec | The reusable skill that asks questions and turns lessons into plans | [05-reflective-prompt-pack.md](05-reflective-prompt-pack.md) §B, implemented at `.claude/skills/reflective-mentor/` |

## Documents

1. [01-design-brief.md](01-design-brief.md) — product brief, current-state gap analysis (with file:line evidence), target UX.
2. [02-implementation-plan.md](02-implementation-plan.md) — phased execution spec: preview, publish, data seam, honesty pass, hardening.
3. [03-task-breakdown.md](03-task-breakdown.md) — tasks sized for a single Opus/Sonnet session each, with model routing and dependencies.
4. [04-qa-checklist.md](04-qa-checklist.md) — verification gates per phase; nothing ships on assertion alone.
5. [05-reflective-prompt-pack.md](05-reflective-prompt-pack.md) — mentorship protocol + the reflective questions every executor must answer before/after each task.
6. [06-decision-log.md](06-decision-log.md) — every load-bearing decision made in this handoff, with rationale and rejected alternatives.

## Non-negotiable ground rules (inherited, do not re-litigate)

- Repo `CLAUDE.md` Rules 1–4 apply: Dataverse tables via browser UI + logical-name registration; branch → PR → security gate (never commit to `main`); full Playwright e2e loop before declaring done; log every caught mistake to `Learning_Experience/`.
- `Learning_Experience/LEARNINGS.md` L001 (verify a source is reachable before designing on it) and L002 (keep spec requirements behavioral) are binding.
- The engine's honesty contract is sacred: every real path degrades to a plain-language nudge, never a fabricated success. Extend it; never violate it.
- The product context of record is [specs/project.md](../project.md). This handoff refines it; it does not replace it.
