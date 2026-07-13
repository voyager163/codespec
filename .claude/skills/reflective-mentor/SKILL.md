---
name: reflective-mentor
description: Use when preparing a handoff to another model or session, starting a multi-session effort, planning a feature for someone else to execute, reviewing an executor's finished task, or asked to "reflect", "mentor", "prepare a handoff", or run a post-mortem in this repo.
---

# Reflective Mentor

## Overview

A handoff is not a plan; it is a transfer of judgment. The executor must receive not just what to do, but what they cannot verify, what they will plausibly get wrong, and how anyone will know the work is real. You produce that by answering four question sets **in writing** — an answer you can't write is an answer you don't have.

Exemplar output: `specs/handoff-2026-07-13-0932/` (full package) — match its standards, not necessarily its length.

## The four question sets (answer in order, in writing)

**1. Product** — answer from the user + `specs/project.md`:
- What is the user-visible behavior when this is done? (Not which files change.) Who sees it, in what words would *they* describe it?
- What is explicitly out of scope?

**2. Execution** — answer from the code, never from memory (read it; cite `file:line` for every claim):
- What does the codebase already solve that this work must reuse? Name the existing pattern/helper.
- What is the exact workflow and data flow, including every failure path the user can hit?
- Which repo rules constrain this? (CLAUDE.md Rules 1–4, `Learning_Experience/LEARNINGS.md` — read both.)

**3. Mentorship** — answer thinking as the executor:
- What will a smaller model plausibly get wrong here? Put a counter for each in the task text.
- What can the executor NOT verify from their seat (no tenant, no browser, no human)? Each such item is labeled **⛔ blocked-honest** with the human task that unblocks it — never left implied, never covered by a proxy check that only *looks* sufficient (a string-grep is not a download test).
- Where must the executor stop and ask instead of deciding?

**4. Reflection** — answer before finishing:
- What did I learn producing this that the next session needs? → `Learning_Experience/` entry (Rule 4) if a mistake was caught; decision-log entry if it shaped the plan.
- What decision did I make that someone could reasonably have made differently? → decision log, with the rejected alternative and why.

## Required output shape

For a multi-session effort: a timestamped folder `specs/handoff-<YYYY-MM-DD-HHMM>/` containing `README.md` (index), `01-design-brief.md` (product + gap analysis with evidence), `02-implementation-plan.md` (execution spec), `03-task-breakdown.md` (tasks sized one-session-each, model routing), `04-qa-checklist.md`, `05-reflective-prompt-pack.md`, `06-decision-log.md`.

For a single task, one message with these REQUIRED slots — omitting a slot is an incomplete handoff:

```
User-visible outcome: <one plain-language sentence a citizen developer would recognize>
Grounding: <what you read; file:line for each load-bearing claim>
Changes: <edits, reusing named existing patterns>
Verification: <how the executor DEMONSTRATES it works — command/screenshot/e2e per Rule 3,
              not a proxy check; state explicitly what the checks do NOT prove>
⛔ Blocked-honest: <what cannot be verified from the executor's seat + the human task that unblocks it;
                    write "none" only after checking>
Executor tripwires: <2-4 "stop and ask when..." lines specific to this task>
Decisions: <choices made + rejected alternative, one line each>
```

## Reviewing an executor's finished work

Audit in this order, stop at first failure, and return findings as questions, not patches: honesty (success-shaped strings for things never run?) → boundaries (silent skips vs labeled ⛔?) → reuse (re-implemented an existing pattern?) → evidence (demonstrated or asserted?) → plain language (would the persona understand every new user-facing string?) → only then code quality.

## Common mistakes

- Strong technical grounding mistaken for a complete handoff — the four question sets are the completeness check, not the exploration quality.
- A green proxy check standing in for real verification: state what each check does *not* prove.
- Time pressure ("it's straightforward") used to skip slots — the slots are how a straightforward task stays straightforward for a smaller model.
- Asking the user what the repo already knows, or telling the repo what only the user knows.
