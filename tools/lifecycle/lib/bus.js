'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { liveDir } = require('./paths');

// Append-only, newline-delimited event bus. Every agent appends; nothing mutates
// past events, so the run history stays browsable and auditable.
function statusFile(root) {
  return path.join(liveDir(root), 'status.json');
}

function ensureLive(root) {
  fs.mkdirSync(liveDir(root), { recursive: true });
}

function emit(root, event) {
  ensureLive(root);
  const record = Object.assign({ ts: new Date().toISOString() }, event);
  fs.appendFileSync(statusFile(root), `${JSON.stringify(record)}\n`);
  return record;
}

function readEvents(root) {
  const file = statusFile(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function reset(root) {
  const file = statusFile(root);
  if (fs.existsSync(file)) fs.rmSync(file);
}

module.exports = { emit, readEvents, reset, statusFile, ensureLive };
