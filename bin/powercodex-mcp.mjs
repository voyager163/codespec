#!/usr/bin/env node
// PowerCodex MCP server entry point.
// Connects the MCP server to stdio transport so any MCP-compatible host
// (Claude Desktop, VS Code, Cursor, Claude Code) can drive PowerCodex.
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

const projectRoot = process.env.POWERCODEX_ROOT || process.cwd();
const server = createServer({ projectRoot });
const transport = new StdioServerTransport();

await server.connect(transport);
