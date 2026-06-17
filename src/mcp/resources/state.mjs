// MCP resource: powercodex://lifecycle/state{?root}
// Returns the live lifecycle bus state (current stage, last events, scores).
//
// The optional ?root query selects the project, resolved through the same
// confinement logic as the tools (Fix 2.1) so resources and tools agree on which
// project they operate against. Omitting it uses the server's configured root.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveProjectDir } from '../lib/resolve-root.mjs';

// Query-template values arrive percent-encoded; decode before resolving.
const decode = (v) => { if (v == null) return v; try { return decodeURIComponent(v); } catch { return v; } };

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');

export function registerStateResource(server, defaultRoot) {
  server.resource(
    'lifecycle-state',
    new ResourceTemplate('powercodex://lifecycle/state{?root}', {
      list: async () => ({ resources: [{ uri: 'powercodex://lifecycle/state', name: 'lifecycle-state', mimeType: 'application/json' }] }),
    }),
    async (uri, variables) => {
      try {
        const root = resolveProjectDir(decode(variables?.root), defaultRoot, { label: 'root' });
        const { liveDir } = require(path.join(LIB, 'paths'));
        const busFile = path.join(liveDir(root), 'bus.json');
        if (!existsSync(busFile)) {
          return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ status: 'idle', message: 'No lifecycle run yet.' }) }] };
        }
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: readFileSync(busFile, 'utf8') }] };
      } catch (e) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: e.message }) }] };
      }
    },
  );
}
