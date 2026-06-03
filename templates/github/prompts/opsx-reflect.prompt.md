---
description: Reflect on a change and log a Learning_Experience lesson (Hermes discipline)
---

Reflect on the change you just applied/verified and capture what was learned, so the system stops repeating mistakes.

**Input**: The argument after `/opsx:reflect` is an optional change name. If omitted, reflect on the most recent change.

**Steps**

1. **Look at what happened**
   - What was reworked, retried, or got stuck? What worked well and should become a habit?
   - Was anything surprising about the codebase, the tenant, or the spec?

2. **Decide if there is a lesson worth keeping**
   - A lesson is reusable guidance, not a one-off detail. If nothing generalizes, say so and stop — do not invent a lesson.

3. **Log it to `Learning_Experience/`**
   - Prefer the tool so the dashboard/insights pick it up:
     ```bash
     npm run lifecycle -- reflect "<short title>" --severity <minor|major> --what "<what happened>" --how "<the rule to follow next time>"
     ```
   - Or write `Learning_Experience/L<NNN>-<slug>.md` directly with **What happened** and **How to apply next time** sections, and add a one-line entry to `LEARNINGS.md`.

4. **Confirm**
   - Show the lesson id and title. Note that it now appears in the live dashboard's Learning_Experience panel and counts toward the Insights trend.

**Guardrails**
- One lesson per real insight — don't pad. Empty reflection is a valid outcome.
- Lessons are version-controlled guidance; keep them short, specific, and actionable.
- Read `Learning_Experience/` at the start of a session and avoid re-triggering a logged lesson.
