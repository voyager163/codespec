// Contract + smoke tests for the PowerCodex MCP server.
// Runs entirely over an in-memory transport in simulate mode — no pac, no browser,
// no network — so it is CI-runnable. See docs/plans/mcp-production-hardening-plan.html (Fix 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.mjs';

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-proj-'));
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

function textOf(result) {
  return (result.content || []).map((c) => c.text || '').join('\n');
}

test('lists all expected tools', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    for (const expected of [
      'start_lifecycle_loop', 'approve_fix', 'reject_fix', 'get_lifecycle_state',
      'dataverse_init_schema', 'dataverse_apply_schema', 'dataverse_get_state',
      'scaffold_project', 'initialize_code_app', 'push_code_app', 'list_pac_auth',
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
  } finally { await close(); }
});

test('lists resources (state + plans)', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const names = (await client.listResources()).resources.map((r) => r.name);
    assert.ok(names.includes('lifecycle-state'));
    assert.ok(names.includes('plans-list'));
  } finally { await close(); }
});

test('error contract: out-of-workspace path returns isError, not a protocol throw', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.callTool({ name: 'get_lifecycle_state', arguments: { projectDir: path.join(os.tmpdir(), 'totally-elsewhere-xyz') } });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /outside the allowed workspace/);
  } finally { await close(); }
});

test('prompts are read at request time (edits reflected without restart)', async () => {
  const root = tmpProject();
  const promptFile = path.join(root, '.github', 'prompts', 'demo.md');
  fs.writeFileSync(promptFile, 'VERSION ONE');
  const { client, close } = await connect(root);
  try {
    const names = (await client.listPrompts()).prompts.map((p) => p.name);
    assert.ok(names.includes('opsx_demo'), 'opsx_demo should be registered');

    let got = await client.getPrompt({ name: 'opsx_demo' });
    assert.match(got.messages[0].content.text, /VERSION ONE/);

    fs.writeFileSync(promptFile, 'VERSION TWO');
    got = await client.getPrompt({ name: 'opsx_demo' });
    assert.match(got.messages[0].content.text, /VERSION TWO/, 'edited content should be served on re-request');
  } finally { await close(); }
});

test('approval gate: start pauses, approve/poll drives to completion', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const start = await client.callTool({
      name: 'start_lifecycle_loop',
      arguments: { goal: 'demo app', rotations: 1, fixMode: 'diff', real: false, projectDir: root },
    });
    assert.match(textOf(start), /awaiting_approval/, 'loop should pause at the approval gate');

    // Drive the gate: approve when waiting, poll otherwise, until settled.
    let settled = false;
    for (let i = 0; i < 40 && !settled; i += 1) {
      const state = await client.callTool({ name: 'get_lifecycle_state', arguments: { projectDir: root } });
      const txt = textOf(state);
      if (/Lifecycle: (complete|stopped|error)/.test(txt)) { settled = true; assert.doesNotMatch(txt, /Lifecycle: error/, 'loop should not error'); break; }
      if (/Lifecycle: awaiting_approval/.test(txt)) {
        await client.callTool({ name: 'approve_fix', arguments: { projectDir: root } });
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(settled, 'loop should reach a terminal state after approvals');
  } finally { await close(); }
});

test('reject_fix stops a paused loop', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const start = await client.callTool({
      name: 'start_lifecycle_loop',
      arguments: { goal: 'demo app', rotations: 1, fixMode: 'diff', real: false, projectDir: root },
    });
    assert.match(textOf(start), /awaiting_approval/);
    const rej = await client.callTool({ name: 'reject_fix', arguments: { projectDir: root } });
    // Either already stopped, or will be on the next poll.
    let txt = textOf(rej);
    for (let i = 0; i < 30 && !/Lifecycle: (stopped|complete)/.test(txt); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      txt = textOf(await client.callTool({ name: 'get_lifecycle_state', arguments: { projectDir: root } }));
    }
    assert.match(txt, /Lifecycle: (stopped|complete)/);
  } finally { await close(); }
});
