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
      'start_lifecycle_loop', 'approve_fix', 'reject_fix', 'stop_lifecycle_loop', 'get_lifecycle_state',
      'dataverse_init_schema', 'dataverse_apply_schema', 'dataverse_get_state',
      'scaffold_project', 'initialize_code_app', 'push_code_app', 'list_pac_auth',
      'log_learning',
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
  } finally { await close(); }
});

test('lists resources (state + plans + skills + memory + rules)', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const names = (await client.listResources()).resources.map((r) => r.name);
    assert.ok(names.includes('lifecycle-state'));
    assert.ok(names.includes('plans-list'));
    assert.ok(names.includes('skills-list'));
    assert.ok(names.includes('memory-index'));
    assert.ok(names.includes('harness-rules'));
  } finally { await close(); }
});

test('skills-list returns empty array when .powerplatform is absent', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://skills' });
    const list = JSON.parse(res.contents[0].text);
    assert.deepEqual(list, []);
  } finally { await close(); }
});

test('skills-list discovers SKILL.md files under .powerplatform', async () => {
  const root = tmpProject();
  const skillDir = path.join(root, '.powerplatform', 'my-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\nDo the thing.');
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://skills' });
    const list = JSON.parse(res.contents[0].text);
    assert.ok(list.some((s) => s.name === 'my-skill'), 'my-skill should appear in skills list');
    assert.ok(list.some((s) => s.uri === 'powercodex://skills/my-skill'));
  } finally { await close(); }
});

test('skill-by-name returns SKILL.md content', async () => {
  const root = tmpProject();
  const skillDir = path.join(root, '.powerplatform', 'dataverse-specialist');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Dataverse Specialist\nManage tables.');
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://skills/dataverse-specialist' });
    assert.match(res.contents[0].text, /Dataverse Specialist/);
  } finally { await close(); }
});

test('skill-by-name returns not-found message for missing skill', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://skills/nonexistent' });
    assert.match(res.contents[0].text, /not found/i);
  } finally { await close(); }
});

test('harness-rules returns CLAUDE.md content when present', async () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# PowerCodex Harness Rules\nRule 1: do the thing.');
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://rules' });
    assert.match(res.contents[0].text, /PowerCodex Harness Rules/);
  } finally { await close(); }
});

test('harness-rules returns not-found message when CLAUDE.md is absent', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://rules' });
    assert.match(res.contents[0].text, /No CLAUDE\.md/i);
  } finally { await close(); }
});

test('memory-index returns not-found message when memory dir is absent', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://memory' });
    assert.match(res.contents[0].text, /No memory index found/i);
  } finally { await close(); }
});

test('memory-by-filename rejects path traversal', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://memory/..%2Fsecret.md' });
    assert.match(res.contents[0].text, /not found|invalid filename/i);
  } finally { await close(); }
});

test('learnings-index returns not-found message when Learning_Experience is absent', async () => {
  const root = tmpProject();
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://learnings' });
    assert.match(res.contents[0].text, /No Learning_Experience log found/i);
  } finally { await close(); }
});

test('learnings-index returns LEARNINGS.md when present', async () => {
  const root = tmpProject();
  const leDir = path.join(root, 'Learning_Experience');
  fs.mkdirSync(leDir, { recursive: true });
  fs.writeFileSync(path.join(leDir, 'LEARNINGS.md'), '# Learnings Index\n| ID | Severity | Lesson | Rule |\n');
  const { client, close } = await connect(root);
  try {
    const res = await client.readResource({ uri: 'powercodex://learnings' });
    assert.match(res.contents[0].text, /Learnings Index/);
  } finally { await close(); }
});

test('log_learning writes entry file and appends LEARNINGS.md row', async () => {
  const root = tmpProject();
  const leDir = path.join(root, 'Learning_Experience');
  fs.mkdirSync(leDir, { recursive: true });
  fs.writeFileSync(
    path.join(leDir, 'LEARNINGS.md'),
    '# Learnings Index\n\n| ID | Severity | Lesson | Rule in one line |\n| --- | --- | --- | --- |\n\n<!-- Append new rows above this line. Newest at the bottom of the table. -->\n',
  );
  const { client, close } = await connect(root);
  try {
    const res = await client.callTool({
      name: 'log_learning',
      arguments: {
        title: 'Hallucinated API method name',
        what: 'Called a method that does not exist on the SDK.',
        why: 'Did not grep for the method before assuming it existed.',
        impact: 'Two wasted tool calls and a user correction.',
        rule: 'Always grep for any method name before calling it.',
        severity: 'major',
        area: 'research',
        projectDir: root,
      },
    });
    const txt = res.content[0].text;
    assert.match(txt, /L001/);
    assert.match(txt, /hallucinated-api-method-name/);

    // Entry file must exist.
    const files = fs.readdirSync(leDir);
    assert.ok(files.some((f) => f.startsWith('L001-')), 'L001 entry file should exist');

    // LEARNINGS.md must have the new row.
    const index = fs.readFileSync(path.join(leDir, 'LEARNINGS.md'), 'utf8');
    assert.match(index, /L001/);
    assert.match(index, /Hallucinated API method name/);
  } finally { await close(); }
});

test('log_learning auto-increments ID on second entry', async () => {
  const root = tmpProject();
  const leDir = path.join(root, 'Learning_Experience');
  fs.mkdirSync(leDir, { recursive: true });
  fs.writeFileSync(path.join(leDir, 'LEARNINGS.md'), '# Learnings\n| ID | Severity | Lesson | Rule in one line |\n| --- | --- | --- | --- |\n<!-- Append new rows above this line. Newest at the bottom of the table. -->\n');

  const args = (n) => ({
    title: `Mistake number ${n}`,
    what: 'Something went wrong.',
    why: 'A reasoning gap.',
    impact: 'Minor cost.',
    rule: 'Do the right thing next time.',
    severity: 'minor',
    projectDir: root,
  });

  const { client, close } = await connect(root);
  try {
    await client.callTool({ name: 'log_learning', arguments: args(1) });
    const res2 = await client.callTool({ name: 'log_learning', arguments: args(2) });
    assert.match(res2.content[0].text, /L002/);
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
