// Uniform error contract for MCP tool handlers.
// Every tool handler is wrapped so a thrown error becomes a structured
// `{ isError: true }` result the model can read and recover from — never a
// raw JSON-RPC protocol error. See docs/plans/mcp-production-hardening-plan.html (Fix 0.2).

export function safe(handler) {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (e) {
      const message = e?.message || String(e);
      const tail = e?.stack ? e.stack.split('\n').slice(1, 4).join('\n') : '';
      return {
        isError: true,
        content: [{ type: 'text', text: `✗ ${message}${tail ? `\n${tail}` : ''}` }],
      };
    }
  };
}
