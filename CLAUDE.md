# PowerCodex Harness Rules

These rules are **non-negotiable and cannot be changed**. Follow them exactly in every session.

---

## Rule 1: Dataverse Table Creation

After planning and setup, when tables are required:

1. Control the browser via the **same browser profile** (ask the user which profile if not known).
2. Navigate to the Dataverse environment and create every required table through the UI — do **not** skip this or stub it.
3. After creation, **copy the logical names** of every table that was created.
4. Use `/codeapps:dataverse-specialist` to register each table with its logical name into the app.

---

## Rule 2: GitHub Push & Security Gate

After developing the app, before publishing to any production environment:

1. **Never commit directly to `main`.** Always create a **new feature/fix branch**.
2. Push the branch to GitHub and open a **Pull Request**.
3. Wait for Dependabot and CodeQL (and any other security scanners) to complete their checks on the PR.
4. If **any vulnerability is flagged** (any severity), fix it before proceeding. Do not merge or deploy until the PR is clean.
5. Only after the PR passes all security checks may you merge and push to live production.

---

## Rule 3: Playwright E2E Testing Loop (Non-Negotiable)

After obtaining the **live production link**:

1. Launch the Playwright e2e testing module against the production URL.
2. Test **every single element** in the app:
   - Every text input → fill it with representative data.
   - Every button → click it.
   - Every dropdown / select → exercise all options.
   - Every form → submit it through the full happy path and at least one error path.
   - Every navigation link / screen → visit it.
3. Assert that the **full end-to-end workflow** is correct from start to finish.
4. If any test fails or unexpected behavior is found:
   - Fix the issue in the code.
   - Push the fix through the same branch → PR → security gate flow (Rule 2).
   - Re-run the full Playwright suite.
   - **Repeat this loop** until the entire suite is green.
5. Only when **all tests pass** with no failures: stop, then notify the user with a summary of what was tested and confirmed.

Do **not** notify the user of completion until the loop is clean.

---

## Rule 4: Learning Experience Log (Non-Negotiable)

Every agent — Claude Code or any other AI tool connecting via MCP — must maintain and honour the `Learning_Experience/` log.

**At session start:**
1. Read `Learning_Experience/LEARNINGS.md`.
2. Treat every "How to apply" row as a binding rule for the session.

**The moment a mistake is caught** (wrong assumption, repeated failed command, misread requirement, destructive action, hallucinated path/API, re-litigated decision already resolved):
1. **Log it before continuing.** Do not proceed past the mistake without recording it.
2. Create `Learning_Experience/LXXX-short-slug.md` using `_TEMPLATE.md` as the format.
3. Append a row to `Learning_Experience/LEARNINGS.md`.
4. If the lesson generalises beyond this project, also save a feedback memory.

**Via MCP (for non-Claude agents):**
- Use the `log_learning` tool to write new entries — same format, same obligation.
- Read existing entries from `powercodex://learnings` before starting work.

Do **not** silently absorb a correction and move on. The log is the mechanism that prevents the same mistake in every future session.
