// Coverage tests for the parts of the hardening pass that the smoke suite didn't
// directly exercise: progress notifications (1.1), the duration cap (1.2), the
// per-project resource ?root query (2.1), and the prompt watcher (2.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.mjs';

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-cov-'));
  fs.mkdirSync(path.join(root, '.github', 'prompts'), { recursive: true });
  return root;
}

async function connect(projectRoot) {
  const server = createServer({ projectRoot });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { server, client, close: async () => { await client.close(); await server.close(); } };
}

const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');

test('progress notifications stream during a long tool (Fix 1.1)', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const updates = [];
    const res = await client.callTool(
      { name: 'start_lifecycle_loop', arguments: { goal: 'demo', rotations: 1, fixMode: 'manual', real: false, projectDir: root } },
      undefined,
      { onprogress: (p) => updates.push(p) },
    );
    assert.match(textOf(res), /Lifecycle: (complete|stopped)/);
    assert.ok(updates.length > 0, 'expected at least one progress notification');
  } finally { await close(); }
});

test('duration cap stops the loop cleanly (Fix 1.2)', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.callTool({
      name: 'start_lifecycle_loop',
      arguments: { goal: 'demo', rotations: 5, fixMode: 'manual', real: false, maxDurationMs: 1, projectDir: root },
    });
    const txt = textOf(res);
    assert.match(txt, /stopped/);
    assert.match(txt, /Duration cap/);
  } finally { await close(); }
});

test('resource ?root resolves the target project (Fix 2.1)', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: `powercodex://lifecycle/state?root=${encodeURIComponent(root)}` });
    assert.match(res.contents[0].text, /idle|status/);
  } finally { await close(); }
});

test('resource ?root rejects a path outside the workspace (Fix 0.3 + 2.1)', async () => {
  const root = tmpProject();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-out-'));
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: `powercodex://lifecycle/state?root=${encodeURIComponent(elsewhere)}` });
    assert.match(res.contents[0].text, /outside the allowed workspace/);
  } finally { await close(); }
});

test('prompt added after boot becomes available (Fix 2.2)', async () => {
  const root = tmpProject();
  // Seed one prompt at boot so the SDK installs the prompts handlers/capability
  // (see the known-limitation note in prompts/opsx.mjs).
  fs.writeFileSync(path.join(root, '.github', 'prompts', 'seed.md'), 'SEED');
  const { client, close } = await connect(root);
  try {
    const before = (await client.listPrompts()).prompts.map((p) => p.name);
    assert.ok(before.includes('opsx_seed'));
    assert.ok(!before.includes('opsx_added_later'));

    fs.writeFileSync(path.join(root, '.github', 'prompts', 'added-later.md'), 'LATE PROMPT');

    // The watcher is debounced + platform-dependent; poll for a few seconds.
    let found = false;
    for (let i = 0; i < 30 && !found; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      found = (await client.listPrompts()).prompts.map((p) => p.name).includes('opsx_added_later');
    }
    assert.ok(found, 'a prompt file added after boot should be picked up by the watcher');

    const got = await client.getPrompt({ name: 'opsx_added_later' });
    assert.match(got.messages[0].content.text, /LATE PROMPT/);
  } finally { await close(); }
});
