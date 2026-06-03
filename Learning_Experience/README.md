# Learning_Experience

A persistent, version-controlled record of mistakes made while working on PowerCodex — so the same mistake is never repeated. This is PowerCodex's answer to the Hermes Agent **"learning loop"**: instead of silently re-learning, the agent writes down what went wrong, why, and the corrected behaviour, then **reads this folder at the start of every session**.

> One file = one lesson. Small, atomic, greppable. Never edit a lesson to soften it — append a follow-up instead.

## The protocol (read this, then follow it every session)

1. **At session start** — read [LEARNINGS.md](./LEARNINGS.md) (the index). Treat each lesson's **"How to apply"** as a binding rule for this session.
2. **The moment a mistake is caught** — a wrong assumption, a failed command repeated, a misread requirement, a destructive action, a hallucinated path/API, a re-litigated decision — stop and log it before continuing. Do not wait until the end.
3. **Write one new file** in this folder using [_TEMPLATE.md](./_TEMPLATE.md). Number it sequentially (`LXXX-short-slug.md`).
4. **Add one line** to [LEARNINGS.md](./LEARNINGS.md) pointing at the new file.
5. **If the lesson is general** (applies beyond PowerCodex, e.g. "always verify repo access before planning on a source"), also mirror a short feedback memory into the auto-memory store so it survives outside this repo. See [[learning-experience-protocol]].

## What counts as a "mistake" worth logging

| Log it | Don't log it |
| --- | --- |
| Wrong assumption that wasted a step or misled the user | Normal iteration / expected trial-and-error |
| Repeated a command that already failed | A one-off typo fixed in the same turn |
| Misread or skipped a stated requirement | A decision the user later simply changed their mind on |
| Destructive / irreversible action without confirming | Style nits already covered by linters |
| Hallucinated a file, path, flag, or API | |
| Re-opened a decision already settled in specs/memory | |

## Severity tags

- `critical` — data loss, irreversible action, or broke the user's trust/workflow.
- `major` — wasted significant time or produced wrong output that shipped.
- `minor` — caught quickly, low cost, but a real pattern worth not repeating.

## Why this is robust

- **Durable** — it lives in the repo (git history), not just chat context.
- **Loaded every session** — the auto-memory entry [[learning-experience-protocol]] forces a read at session start.
- **Self-reinforcing** — each lesson's "How to apply" becomes a checklist item, so the corrective behaviour is re-applied, not just remembered.
