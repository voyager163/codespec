'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A workspace lets many projects share one "brain": a single Learning_Experience/
// at the workspace root that every project's reflect/insights reads and writes.
// So a lesson learned building project A is available when building project B.
const MARKER = '.powercodex-workspace.json';

// Walk up from `start` to find the workspace marker.
function findWorkspace(start) {
  let dir = path.resolve(start);
  for (;;) {
    const marker = path.join(dir, MARKER);
    if (fs.existsSync(marker)) return { root: dir, marker };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The shared brain dir: the workspace's Learning_Experience/ if inside a
// workspace, else the project-local one (single-project behavior, unchanged).
function brainDir(projectRoot) {
  const ws = findWorkspace(projectRoot);
  return ws ? path.join(ws.root, 'Learning_Experience') : path.join(projectRoot, 'Learning_Experience');
}

function readMarker(root) {
  const ws = findWorkspace(root);
  if (!ws) return null;
  try {
    return Object.assign({ root: ws.root }, JSON.parse(fs.readFileSync(ws.marker, 'utf8')));
  } catch {
    return { root: ws.root, name: path.basename(ws.root), projects: [] };
  }
}

function initWorkspace(root, opts = {}) {
  fs.mkdirSync(path.join(root, 'Learning_Experience'), { recursive: true });
  const marker = path.join(root, MARKER);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(
      marker,
      `${JSON.stringify({ name: opts.name || path.basename(root), projects: opts.projects || [], createdAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`,
    );
  }
  return marker;
}

function registerProject(fromRoot, projectPath) {
  const ws = findWorkspace(fromRoot) || { root: path.resolve(fromRoot), marker: path.join(path.resolve(fromRoot), MARKER) };
  initWorkspace(ws.root, {});
  const data = JSON.parse(fs.readFileSync(ws.marker, 'utf8'));
  const rel = path.relative(ws.root, path.resolve(fromRoot, projectPath)) || '.';
  if (!data.projects.includes(rel)) {
    data.projects.push(rel);
    fs.writeFileSync(ws.marker, `${JSON.stringify(data, null, 2)}\n`);
  }
  return data.projects;
}

// Summary surfaced on the dashboard: shared brain name, projects, lesson count.
function summary(projectRoot) {
  const marker = readMarker(projectRoot);
  if (!marker) return null;
  let lessons = 0;
  const dir = path.join(marker.root, 'Learning_Experience');
  if (fs.existsSync(dir)) lessons = fs.readdirSync(dir).filter((f) => /^L\d+.*\.md$/i.test(f)).length;
  return { name: marker.name, projects: marker.projects || [], lessons, shared: true };
}

module.exports = { findWorkspace, brainDir, readMarker, initWorkspace, registerProject, summary, MARKER };
