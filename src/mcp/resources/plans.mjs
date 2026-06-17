// MCP resources: powercodex://plans{?root} and powercodex://plans/{id}{?root}
// Returns the registered plans for a project (list) and the HTML of one plan (by id).
//
// The optional ?root query selects the project, resolved through the shared
// confinement logic (Fix 2.1) so resources and tools agree on the target project.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveProjectDir } from '../lib/resolve-root.mjs';

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');

export function registerPlansResource(server, defaultRoot) {
  // List all plans.
  server.resource(
    'plans-list',
    new ResourceTemplate('powercodex://plans{?root}', {
      list: async () => ({ resources: [{ uri: 'powercodex://plans', name: 'plans-list', mimeType: 'application/json' }] }),
    }),
    async (uri, variables) => {
      try {
        const root = resolveProjectDir(variables?.root, defaultRoot, { label: 'root' });
        const planRegistry = require(path.join(LIB, 'plans'));
        const list = planRegistry.listPlans(root);
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(list, null, 2) }] };
      } catch (e) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: e.message }) }] };
      }
    },
  );

  // Individual plan by ID.
  server.resource(
    'plan-by-id',
    new ResourceTemplate('powercodex://plans/{id}{?root}', { list: undefined }),
    async (uri, variables) => {
      try {
        const root = resolveProjectDir(variables?.root, defaultRoot, { label: 'root' });
        const planRegistry = require(path.join(LIB, 'plans'));
        const resolved = planRegistry.resolvePlan(root, variables?.id);
        if (!resolved || !existsSync(resolved.file)) {
          return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Plan "${variables?.id}" not found.` }] };
        }
        return { contents: [{ uri: uri.href, mimeType: 'text/html', text: readFileSync(resolved.file, 'utf8') }] };
      } catch (e) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${e.message}` }] };
      }
    },
  );
}
