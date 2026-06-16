// MCP resource: powercodex://plans and powercodex://plans/{id}
// Returns the HTML content of registered plans.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');

export function registerPlansResource(server, defaultRoot) {
  // Static resource — list all plans.
  server.resource(
    'plans-list',
    'powercodex://plans',
    async (uri) => {
      const root = defaultRoot;
      try {
        const planRegistry = require(path.join(LIB, 'plans'));
        const list = planRegistry.listPlans(root);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(list, null, 2),
          }],
        };
      } catch (e) {
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: e.message }) }],
        };
      }
    },
  );

  // Template resource — individual plan by ID.
  server.resource(
    'plan-by-id',
    new ResourceTemplate('powercodex://plans/{id}', { list: undefined }),
    async (uri, { id }) => {
      const root = defaultRoot;
      try {
        const planRegistry = require(path.join(LIB, 'plans'));
        const resolved = planRegistry.resolvePlan(root, id);
        if (!resolved || !existsSync(resolved.file)) {
          return {
            contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Plan "${id}" not found.` }],
          };
        }
        const html = readFileSync(resolved.file, 'utf8');
        return {
          contents: [{ uri: uri.href, mimeType: 'text/html', text: html }],
        };
      } catch (e) {
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${e.message}` }],
        };
      }
    },
  );
}
