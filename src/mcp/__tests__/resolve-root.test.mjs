// Unit tests for path confinement (Fix 0.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectDir, allowedRoots } from '../lib/resolve-root.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-ws-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-out-'));

test('defaults to the workspace root when no input is given', () => {
  assert.equal(resolveProjectDir(undefined, workspace), path.resolve(workspace));
});

test('accepts a subdirectory of the workspace', () => {
  const sub = path.join(workspace, 'nested', 'app');
  assert.equal(resolveProjectDir(sub, workspace), path.resolve(sub));
});

test('rejects a path outside the allow-list', () => {
  assert.throws(() => resolveProjectDir(outside, workspace), /outside the allowed workspace/);
});

test('POWERCODEX_ALLOWED_ROOTS opts an extra root in', () => {
  const prev = process.env.POWERCODEX_ALLOWED_ROOTS;
  process.env.POWERCODEX_ALLOWED_ROOTS = outside;
  try {
    assert.equal(resolveProjectDir(outside, workspace), path.resolve(outside));
    assert.ok(allowedRoots(workspace).includes(path.resolve(outside)));
  } finally {
    if (prev === undefined) delete process.env.POWERCODEX_ALLOWED_ROOTS;
    else process.env.POWERCODEX_ALLOWED_ROOTS = prev;
  }
});

test('mustExist rejects a non-existent directory', () => {
  assert.throws(
    () => resolveProjectDir(path.join(workspace, 'does-not-exist'), workspace, { mustExist: true }),
    /does not exist/,
  );
});
