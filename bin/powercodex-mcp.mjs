#!/usr/bin/env node
// PowerCodex MCP server entry point.
// Connects the MCP server to stdio transport so any MCP-compatible host
// (Claude Code, Claude Desktop, Cursor, VS Code, Antigravity) can drive PowerCodex.
//
// Add to Claude Desktop's claude_desktop_config.json:
//   "mcpServers": {
//     "powercodex": {
//       "command": "node",
//       "args": ["/absolute/path/to/codespec/bin/powercodex-mcp.mjs"],
//       "env": { "POWERCODEX_ROOT": "/absolute/path/to/your/project" }
//     }
//   }
//
// Or use npx after publishing:
//   "command": "npx", "args": ["-y", "@elfredseow/powercodex", "mcp"]

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/mcp/server.mjs';

// ── stdout hygiene (Fix 2.4) ────────────────────────────────────────────────────
// On stdio, process.stdout IS the JSON-RPC channel — a stray console.log in any
// wrapped library would corrupt the stream and break the session. Redirect all
// console.* to stderr so diagnostics never touch the protocol pipe. The transport
// writes to process.stdout.write directly, so it is unaffected.
for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
  console[level] = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
}

const log = (msg) => process.stderr.write(`[powercodex-mcp] ${msg}\n`);

const projectRoot = process.env.POWERCODEX_ROOT || process.cwd();

// ── error boundary & graceful shutdown (Fix 0.1) ────────────────────────────────
let transport;

async function shutdown(reason, code = 0) {
  log(`shutting down (${reason})`);
  try { await transport?.close?.(); } catch { /* ignore */ }
  process.exit(code);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err?.stack || err}`);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (err) => {
  log(`unhandledRejection: ${err?.stack || err}`);
  shutdown('unhandledRejection', 1);
});

try {
  const server = createServer({ projectRoot });
  transport = new StdioServerTransport();
  await server.connect(transport);
  log(`connected · root ${projectRoot}`);
} catch (err) {
  log(`failed to start: ${err?.stack || err}`);
  process.exit(1);
}
