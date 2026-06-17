# MCP real-mode integration checklist

The automated suite (`npm test`) runs the MCP server in **simulate mode** — offline, no
`pac`, no browser — so it can run in CI. The hardening pass also touched **real mode**
(managed Edge/CDP + Playwright + `pac` against a tenant), which *cannot* run in CI.

Run this checklist **before each release** on a machine with:

- The Power Platform CLI (`pac`) installed and a signed-in auth profile.
- Playwright + a managed Edge profile available.
- A throwaway Power Platform environment you're allowed to write to.

There's also an env-gated smoke (`POWERCODEX_MCP_E2E=1 npm run test:e2e`) that automates the
parts that can be checked without a tenant; the rest below are manual observations.

---

## 1. Browser lifecycle & cleanup (Fix 1.4)

- [ ] **Normal completion** — run `start_lifecycle_loop` with `real: true` to green. Confirm
      no Edge/CDP process is left running afterwards (Task Manager / `Get-Process msedge`).
- [ ] **Mid-run abort** — start a multi-rotation real run, then kill the request (or set a
      tiny `maxDurationMs`). Confirm the browser is released and the managed profile directory
      is **not** locked for the next run.
- [ ] **Error path** — point at an unreachable `appUrl`. Confirm the tool returns a structured
      error (not a hang) and the browser is still released.

## 2. pac auth & profile failure handling (Fix 1.5)

- [ ] **pac missing** — temporarily remove `pac` from PATH. `initialize_code_app` /
      `push_code_app` return an actionable "install pac" message, not a raw spawn error.
- [ ] **No matching profile** — call `initialize_code_app` with an `environmentUrl` you are
      not authenticated to. Confirm the message tells you to run `pac auth create --environment …`.
- [ ] **Expired profile** — let an auth profile expire (or sign out). Confirm the failure is
      reported up front, not partway through a push.

## 3. Progress streaming (Fix 1.1)

- [ ] In a host that renders progress (e.g. Claude Desktop), confirm a multi-rotation real run
      shows live progress notifications *before* the tool returns — the session does not go dark.

## 4. Approval gate over a real host (Fix 1.3)

- [ ] With `fixMode: 'diff'` and `real: true`, confirm `start_lifecycle_loop` returns
      `awaiting_approval` quickly (well within the host's request timeout), and that
      `approve_fix` / `reject_fix` drive it to completion as separate calls.

## 5. Resilience (Fix 0.1 / 2.4)

- [ ] Send `SIGINT` to the server mid-run; confirm a clean "shutting down" line on stderr and
      no orphaned browser.
- [ ] Confirm nothing but JSON-RPC ever appears on stdout (all logs go to stderr).
