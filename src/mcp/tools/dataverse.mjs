// MCP tools: Dataverse schema management.
// These are thin wrappers over tools/lifecycle/lib/dataverse-schema.js.
// All the real logic (browser automation, schema file I/O) lives there.

import { z } from 'zod';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');

function lib(name) { return require(path.join(LIB, name)); }

export function registerDataverseTools(server, defaultRoot) {

  // ── dataverse_init_schema ───────────────────────────────────────────────────
  // Creates .powercodex/dataverse-schema.json with a starter template.
  server.tool(
    'dataverse_init_schema',
    {
      projectDir:  z.string().optional().describe('Absolute path to the project root (defaults to server cwd)'),
      displayName: z.string().optional().default('MyTable').describe('Display name for the first table in the template'),
      pluralName:  z.string().optional().describe('Plural display name (defaults to displayName + "s")'),
    },
    async ({ projectDir, displayName, pluralName }) => {
      const root = projectDir || defaultRoot;
      const ds = lib('dataverse-schema');
      const result = ds.initSchema(root, { displayName, pluralName });
      const text = result.created
        ? `Created schema template at ${result.path}. Edit it to define your tables and columns, then call dataverse_apply_schema.`
        : `Schema file already exists at ${result.path}. Edit it and call dataverse_apply_schema.`;
      return { content: [{ type: 'text', text }] };
    },
  );

  // ── dataverse_apply_schema ──────────────────────────────────────────────────
  // Reads .powercodex/dataverse-schema.json and drives managed Edge to create
  // each table and column that isn't already in .powercodex/dataverse.json.
  // Returns the applied state including captured logical names.
  server.tool(
    'dataverse_apply_schema',
    {
      projectDir:    z.string().optional().describe('Absolute path to the project root'),
      environmentId: z.string().optional().describe('Power Platform environment GUID (optional; uses default env)'),
      dryRun:        z.boolean().optional().default(false).describe('Log what would be done without opening the browser'),
    },
    async ({ projectDir, environmentId, dryRun }) => {
      const root = projectDir || defaultRoot;
      const ds = lib('dataverse-schema');
      const log = [];
      const result = await ds.applySchema(root, {
        environmentId,
        dryRun,
        emit: async ({ level, message }) => { log.push(`[${level}] ${message}`); },
      });
      const summary = [
        `Schema apply ${result.errors.length ? 'completed with errors' : 'succeeded'}.`,
        `Tables processed: ${result.tables.length}`,
        `Errors: ${result.errors.length}`,
        '',
        'Log:',
        ...log,
        '',
        'Result:',
        JSON.stringify(result, null, 2),
      ].join('\n');
      return { content: [{ type: 'text', text: summary }] };
    },
  );

  // ── dataverse_get_state ─────────────────────────────────────────────────────
  // Returns the current .powercodex/dataverse.json (applied logical names).
  server.tool(
    'dataverse_get_state',
    {
      projectDir: z.string().optional().describe('Absolute path to the project root'),
    },
    async ({ projectDir }) => {
      const root = projectDir || defaultRoot;
      const ds = lib('dataverse-schema');
      const state = ds.readState(root);
      return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
    },
  );
}
