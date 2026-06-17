// MCP server factory for PowerCodex.
// Each tool/resource/prompt module registers itself against the McpServer instance.
// This file is the single wiring point — no business logic lives here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { version } from './lib/version.mjs';
import { registerDataverseTools } from './tools/dataverse.mjs';
import { registerLifecycleTools } from './tools/lifecycle.mjs';
import { registerScaffoldTools } from './tools/scaffold.mjs';
import { registerPacTools } from './tools/pac.mjs';
import { registerStateResource } from './resources/state.mjs';
import { registerPlansResource } from './resources/plans.mjs';
import { registerOpsxPrompts } from './prompts/opsx.mjs';

export function createServer({ projectRoot } = {}) {
  const root = projectRoot || process.cwd();

  const server = new McpServer({
    name: 'powercodex',
    version, // single source of truth: package.json (Fix 2.3)
  });

  registerDataverseTools(server, root);
  registerLifecycleTools(server, root);
  registerScaffoldTools(server, root);
  registerPacTools(server, root);
  registerStateResource(server, root);
  registerPlansResource(server, root);
  registerOpsxPrompts(server, root);

  return server;
}
