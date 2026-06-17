// Single source of truth for the server version (Fix 2.3).
// Read from package.json so a release bump can't leave the MCP server reporting
// a stale hardcoded version to hosts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgPath = path.resolve(fileURLToPath(import.meta.url), '../../../../package.json');

let version = '0.0.0';
try {
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || version;
} catch {
  /* fall back to 0.0.0 if package.json is unreadable */
}

export { version };
