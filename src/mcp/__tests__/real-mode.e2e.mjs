// Env-gated real-mode integration smoke.
//
// NOT part of `npm test` (the filename lacks the `.test.mjs` suffix the default glob
// matches) and self-skips unless POWERCODEX_MCP_E2E=1. It exercises the parts of real
// mode that can be checked WITHOUT writing to a tenant — real `pac` invocation and the
// preflight failure path. The tenant/browser cases stay in docs/mcp-real-mode-checklist.md.
//
// Run:  POWERCODEX_MCP_E2E=1 npm run test:e2e

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.mjs';

const ENABLED = process.env.POWERCODEX_MCP_E2E === '1';
const opts = { skip: ENABLED ? false : 'set POWERCODEX_MCP_E2E=1 to run real-mode smoke' };

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-e2e-'));
  fs.mkdirSync(path.join(root, '.github', 'prompts'), { recursive: true });
  return root;
}

async function connect(projectRoot) {
  const server = createServer({ projectRoot });
  const client = new Client({ name: 'e2e', version: '0.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');

test('list_pac_auth invokes real pac and returns content', opts, async () => {
  const { client, close } = await connect(tmpProject());
  try {
    const res = await client.callTool({ name: 'list_pac_auth', arguments: {} });
    assert.ok(textOf(res).length > 0, 'expected some text (profiles or the no-profiles hint)');
  } finally { await close(); }
});

test('initialize_code_app preflight fails actionably for an unauthenticated environment', opts, async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.callTool({
      name: 'initialize_code_app',
      arguments: { appName: 'E2EProbe', environmentUrl: 'https://no-such-env.crm.dynamics.com/', projectDir: root },
    });
    assert.equal(res.isError, true, 'should fail when not authenticated to the environment');
    assert.match(textOf(res), /pac auth create --environment|pac CLI not found/);
  } finally { await close(); }
});
