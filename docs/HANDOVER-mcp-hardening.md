# Handover — PowerCodex MCP production hardening

**Created:** 2026-06-18 07:32 (+0800)
**Author:** Claude (Opus 4.8) session
**Branch:** `docs/mcp-production-hardening-plan` (pushed to origin, up to date)
**Working tree:** clean

---

## 1. Purpose of this work

Take the PowerCodex MCP server from a happy-path prototype to production-ready.
Scope was deliberately the **MCP boundary** (`src/mcp/**`, `bin/powercodex-mcp.mjs`)
plus minimal, additive hooks into the lifecycle engine — not an engine rewrite.

Maker decisions that shaped it:
- **Pre-release → break freely** (no backward-compat shims).
- **Broad host support** (Claude Code, Claude Desktop, Cursor, VS Code, Antigravity);
  Claude Desktop's ~60s request timeout is the binding constraint.
- **Deny-outside-workspace** path confinement by default.
- **Real (browser/tenant) mode is the priority** for "production-ready".

---

## 2. Current state — what's DONE

All four phases of the plan are implemented, committed, and pushed.

| Commit | Contents |
|--------|----------|
| `07db14b` | The plan doc (`docs/plans/mcp-production-hardening-plan.html`) |
| `00d72a1` | Phases 0–3 implementation |
| `19ba907` | Coverage tests, doc updates, real-mode checklist, session pruning |

### Phase 0 — resilience & safety
- `bin/powercodex-mcp.mjs`: error boundary, `uncaughtException`/`unhandledRejection` +
  `SIGINT`/`SIGTERM` graceful shutdown, **stdout hygiene** (all `console.*` → stderr).
- `src/mcp/lib/safe-tool.mjs`: uniform `{ isError: true }` contract — wraps every tool.
- `src/mcp/lib/resolve-root.mjs`: path confinement (deny outside workspace;
  `POWERCODEX_ALLOWED_ROOTS` escape hatch) — applied to every path param.

### Phase 1 — long-running ops & real mode
- `src/mcp/lib/progress.mjs`: events → MCP `notifications/progress`.
- `src/mcp/tools/lifecycle.mjs`: **background session manager + poll/resume gate**.
  `start_lifecycle_loop` returns at the first checkpoint (`awaiting_approval` w/
  `resumeToken`, or `complete`/`stopped`/`error`); `approve_fix`/`reject_fix` resume;
  `maxDurationMs` cap; 30-min session TTL pruning.
- `tools/lifecycle/lib/loop.js`: **forwards events to `opts.emit`** (was silently
  dropped — pre-existing bug), `isRejected`/`shouldAbort` hooks, and a **try/finally so
  the real-mode browser/CDP is always released** on completion, error, or abort.
- `tools/lifecycle/lib/pac-init.js`: `preflight()` + `checkPac` on push for actionable
  auth/missing-pac errors.

### Phase 2 — consistency
- Resources accept per-project root via `{?root}` (`state.mjs`, `plans.mjs`) — values
  are percent-decoded in the handler.
- Prompts read at **request time** + best-effort watcher for added files (`opsx.mjs`).
- Server version sourced from `package.json` (`src/mcp/lib/version.mjs`).

### Phase 3 — tests & CI
- `src/mcp/__tests__/`: 16 automated tests (simulate mode, offline) across
  `resolve-root.test.mjs`, `server.test.mjs`, `coverage.test.mjs`.
- `src/mcp/__tests__/real-mode.e2e.mjs`: env-gated real-mode smoke (excluded from the
  default glob; self-skips unless `POWERCODEX_MCP_E2E=1`).
- `.github/workflows/ci.yml`: runs `npm test` on push/PR (Ubuntu, Node 20).

### Docs
- `docs/mcp-user-guide.html`: updated to the new contract (11 tools, poll/resume,
  `approve_fix`/`reject_fix`, `maxDurationMs`, progress, session-aware state).
- `docs/plans/mcp-production-hardening-plan.html`: marked **Implemented**.
- `docs/mcp-real-mode-checklist.md`: pre-release manual checklist for tenant/browser.

---

## 3. How to verify

```bash
npm test                 # 16/16 pass (offline)
npm run test:e2e         # 2 skipped unless POWERCODEX_MCP_E2E=1
node tools/lifecycle/bin/powercodex-lifecycle.js selftest   # 101/101 (CLI, no regression)
```

Live stdio boot (clean JSON-RPC on stdout, diagnostics on stderr) was verified manually.

---

## 4. OPEN CONCERNS — start here next session

Ordered by priority. Items 1–2 are the recommended next commit; 3 is a known limit.

### Worth fixing
1. ~~**Concurrent `start_lifecycle_loop` on the same root orphans the old run.**~~ **Fixed.**
   `session.aborted = true` is set on the existing unsettled session before starting a new one;
   `shouldAbort` now checks `session.aborted || Date.now() > session.deadline`. The old
   session's checkpoint is also resolved so any waiting call returns immediately.
2. ~~**No way to stop a running loop.**~~ **Fixed.** `stop_lifecycle_loop` tool added — sets
   `session.aborted = true` and resolves the checkpoint. Documented in `mcp-user-guide.html`.
   Tool count updated to 12. Coverage test updated.
3. **Duration cap is not a hard kill.** `shouldAbort` is only checked at rotation
   boundaries / approval polls, not during an in-flight browser action. A hung CDP call
   won't be bounded by `maxDurationMs`. True hard-kill needs cooperative cancellation
   deeper in the engine (out of the boundary-only scope).

### Known limitations (documented, deferrable)
4. **Real mode is unexecuted** — hardened in code + checklist, but never run against an
   actual tenant/browser. Run `docs/mcp-real-mode-checklist.md` before relying on it.
5. **CI is Ubuntu/Node 20 only** — dev platform is Windows 11, where path confinement
   and `fs.watch` differ. Cheap win: add `windows-latest` to the CI matrix.
6. **Path confinement doesn't follow symlinks** — a symlink inside the allowed root
   pointing outside isn't caught.
7. **Sessions are in-memory** — a server restart mid-loop loses the session.
8. **Progress streams only to the currently-awaiting request** — between calls a long
   background build buffers events but emits nothing live.
9. **Empty `.github/prompts` at boot** — the SDK installs prompt handlers only once a
   prompt exists, so watcher-added prompts won't surface until restart (documented in
   `opsx.mjs`).

---

## 5. Outstanding actions (not code)

- **PR is NOT opened** (per maker instruction). To open it:
  `https://github.com/voyager163/codespec/pull/new/docs/mcp-production-hardening-plan`
- Real-mode checklist has not been executed.

---

## 6. Key files map

```
bin/powercodex-mcp.mjs            entry: error boundary, shutdown, stdout hygiene
src/mcp/server.mjs                wiring (version from package.json)
src/mcp/lib/safe-tool.mjs         isError wrapper
src/mcp/lib/resolve-root.mjs      path confinement
src/mcp/lib/progress.mjs          progress notifications
src/mcp/lib/version.mjs           version source
src/mcp/tools/lifecycle.mjs       session manager + poll/resume gate  <- concerns #1/#2 here
src/mcp/tools/{dataverse,scaffold,pac}.mjs   safe + confinement + progress
src/mcp/resources/{state,plans}.mjs          per-project root via {?root}
src/mcp/prompts/opsx.mjs          live prompts + watcher
tools/lifecycle/lib/loop.js       emit forwarding, isRejected/shouldAbort, try/finally cleanup
tools/lifecycle/lib/pac-init.js   preflight()
src/mcp/__tests__/                tests (+ env-gated real-mode.e2e.mjs)
docs/plans/mcp-production-hardening-plan.html   the plan (Implemented)
docs/mcp-user-guide.html          end-user docs (current)
docs/mcp-real-mode-checklist.md   manual pre-release checklist
```
