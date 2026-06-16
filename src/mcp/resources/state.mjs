// MCP resource: powercodex://lifecycle/state
// Returns the live lifecycle bus state (current stage, last events, scores).

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');

export function registerStateResource(server, defaultRoot) {
  server.resource(
    'lifecycle-state',
    'powercodex://lifecycle/state',
    async (uri) => {
      const root = defaultRoot;
      try {
        const { liveDir } = require(path.join(LIB, 'paths'));
        const busFile = path.join(liveDir(root), 'bus.json');
        if (!existsSync(busFile)) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ status: 'idle', message: 'No lifecycle run yet.' }),
            }],
          };
        }
        const data = readFileSync(busFile, 'utf8');
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: data }],
        };
      } catch (e) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: e.message }),
          }],
        };
      }
    },
  );
}
