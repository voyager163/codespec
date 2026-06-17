// Progress notifications for long-running tools (Fix 1.1).
// The lifecycle loop and schema-apply already emit a rich event stream; this turns
// each event into an MCP `notifications/progress` so the host shows live progress
// (and keeps the request alive against idle-timeout heuristics) instead of going
// dark until the tool returns.
//
// `extra` is the request handler context the MCP SDK passes as the 2nd tool arg.
// When the host didn't supply a progressToken, this is a no-op.

export function makeProgress(extra) {
  const token = extra?._meta?.progressToken;
  let n = 0;
  return async (message) => {
    if (token === undefined || token === null || typeof extra?.sendNotification !== 'function') return;
    n += 1;
    try {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: n, message: String(message).slice(0, 500) },
      });
    } catch {
      /* progress is best-effort — never let a dropped notification fail the tool */
    }
  };
}
