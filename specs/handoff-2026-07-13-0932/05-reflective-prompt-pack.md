# 05 · Reflective Prompt Pack

Two parts: **§A Mentorship spec** (Part 3 of the reflection) — how this system guides smaller models, reviews their work, and generates artifacts. **§B Reflection skill spec** (Part 4) — the reusable skill, implemented at `.claude/skills/reflective-mentor/SKILL.md`.

---

## §A · Mentorship Spec (Part 3)

### The mentorship stance

The executor (Opus/Sonnet) is not being handed instructions to obey; it is being taught to *think like the model that wrote them*. The mechanism is forced reflection at three checkpoints — before, during, after — with answers written down, not thought silently. Writing is the forcing function: an answer you can't write is an answer you don't have.

### A1 · Before any task (pre-flight, written into the session)

1. **Restate the task in one sentence without looking at the task text.** If you can't, re-read; if you still can't, the task is underspecified — stop and ask.
2. **What is the user-visible behavior change when I'm done?** (Not "what files change.") If the answer is "none," question why the task exists.
3. **What did the codebase already solve that I'm about to re-solve?** Name the existing helper/pattern you'll reuse (this repo: the `_pac` injection pattern, the bus/emit pattern, the honest-degrade contract, the setup-gate modal). Re-implementation is the most common smaller-model failure.
4. **What can I NOT verify from here, and what's my honest boundary?** (No tenant? No pac? Then: injected fakes + a human-in-the-loop handoff task. Never a simulated success dressed as real.)
5. **Which repo rule or learning constrains me here?** (CLAUDE.md Rules 1–4; L001 source-access; L002 behavioral specs; the honesty contract.)

### A2 · During (tripwires — stop and reflect the moment one fires)

- I'm about to write a success message for something I didn't run. → Stop: run it or label it.
- I've retried the same failing command twice unchanged. → Stop: root cause, then log to `Learning_Experience/` (Rule 4).
- I'm adding a config/abstraction/file the task didn't ask for. → Stop: which existing thing covers this?
- The diff is growing past what the task named. → Stop: split or ask.
- I'm guessing at an API/path/selector. → Stop: read the source (L001).

### A3 · After (post-flight, written before the PR)

1. **Demonstrate, don't assert:** paste the QA-row evidence (command output / screenshot / selftest id).
2. **What would break first if this shipped?** Name the weakest link you're leaving behind and whether it's labeled (a `ponytail:`/TODO with ceiling + upgrade path) or silent (fix it now).
3. **What did I learn that the next executor needs?** If non-obvious → `Learning_Experience/` entry now, not later.
4. **Did I keep the simulated path green?** (Run it.)
5. **One sentence to the user, plain language:** what changed and how they'd see it. If you can't write it for a citizen developer, the work isn't user-facing enough or you don't understand it yet.

### A4 · How the mentor reviews executor work

Review is adversarial-but-kind, in this order (stop at first failure):

1. **Honesty audit** — grep the diff for success-shaped strings, fabricated URLs/markers, unlabeled reverts. Any theater = automatic rework, regardless of how well the rest works.
2. **Boundary audit** — did untestable surfaces get injected fakes and an explicit human handoff, or silent skips?
3. **Reuse audit** — does the diff re-implement an existing pattern? (Most common finding; cite the existing file.)
4. **Evidence audit** — QA rows demonstrated with real output?
5. **Plain-language audit** — read every new user-facing string as the persona; jargon fails review.
6. Only then: code quality per the usual reviewers.

Findings go back as questions, not corrections ("What does the user see when pac is installed but unauthed?") — the executor fixing its own gap learns; the executor applying a patch doesn't.

### A5 · Artifact generation obligations

Every completed phase regenerates its slice of the record: the task table row (done + evidence link), the decision log (any deviation = new numbered decision with rationale), `Learning_Experience/` (mistakes caught), and the Project PRD of any generated app touched (spec §4: the PRD never silently drifts).

---

## §B · Reflection Skill Spec (Part 4)

**Name:** `reflective-mentor` · **Location:** `.claude/skills/reflective-mentor/SKILL.md` (project-level, ships with the repo, usable by any model or MCP-connected agent).

**Purpose:** turn any substantial piece of work — a feature request, a handoff, a post-mortem — into (a) written answers to the reflective questions, (b) captured lessons, and (c) a generated plan-and-document set of the same shape as this handoff folder.

**Trigger:** invoked at the start of any multi-session effort, any handoff between models, or on request ("reflect on this", "prepare a handoff", "mentor me through this").

**Behavioral contract (what the skill makes the model do):**

1. **Ground before opining** — read the named context (specs/, Learning_Experience/, the actual code); every claim in the output must carry evidence (file:line or command output). No exploration → no plan.
2. **Ask the four question sets in order** — Product (what/who/done), Execution (workflow/data/behavior/constraints), Mentorship (who executes, what they'll get wrong, what they can't verify), Reflection (what was learned, what must not be re-learned). Questions the human must answer are asked; questions the codebase can answer are answered by reading it — never ask the user what the repo already knows.
3. **Write the answers down** as the 6-document set in a timestamped folder under `specs/` (design brief w/ gap analysis, implementation plan, task breakdown w/ model routing, QA checklist w/ evidence rule, reflective prompt pack, decision log w/ rejected alternatives).
4. **Capture lessons bidirectionally** — lessons that shaped the plan go in the decision log; mistakes caught during the reflection itself go to `Learning_Experience/` per Rule 4.
5. **Enforce the honesty contract on itself** — anything the skill could not verify is labeled ⛔ blocked-honest in the output, with the human task that unblocks it.

**Success criterion:** a fresh session of a smaller model, given only the generated folder, can start task 0.1 without asking a single clarifying question — and knows exactly when it must stop and ask.
