'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Freeze state for the review artifacts (user stories + MVP). "draft" → the loop
// may (re)generate the artifact; "frozen" → the loop reads it but MUST NOT rewrite
// it. Kept in one small file so the loop has a single, format-independent place to
// consult, and so only the explicit unlock action can move frozen → draft.
const ARTIFACTS = ['stories', 'mvp'];
const DEFAULT = { stories: 'draft', mvp: 'draft' };

function freezeFile(root) {
  return path.join(root, '.powercodex', 'freeze.json');
}

function readFreeze(root) {
  try {
    return Object.assign({}, DEFAULT, JSON.parse(fs.readFileSync(freezeFile(root), 'utf8')));
  } catch {
    return Object.assign({}, DEFAULT);
  }
}

function writeFreeze(root, state) {
  fs.mkdirSync(path.join(root, '.powercodex'), { recursive: true });
  fs.writeFileSync(freezeFile(root), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function statusOf(root, artifact) {
  return readFreeze(root)[artifact] || 'draft';
}

function isFrozen(root, artifact) {
  return statusOf(root, artifact) === 'frozen';
}

// The only path to change a status. Validates the artifact + value so the loop has
// no accidental route to unfreeze — unlock is an explicit caller decision.
function setStatus(root, artifact, value) {
  if (!ARTIFACTS.includes(artifact)) throw new Error(`unknown artifact: ${artifact}`);
  if (value !== 'draft' && value !== 'frozen') throw new Error(`invalid status: ${value}`);
  const state = readFreeze(root);
  state[artifact] = value;
  return writeFreeze(root, state);
}

const freeze = (root, artifact) => setStatus(root, artifact, 'frozen');
const unlock = (root, artifact) => setStatus(root, artifact, 'draft');

module.exports = { ARTIFACTS, readFreeze, statusOf, isFrozen, setStatus, freeze, unlock, freezeFile };
