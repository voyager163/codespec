'use strict';
const fs = require('node:fs');
const { brainDir } = require('./workspace');

// Computes the "is the loop actually improving?" metrics from the status bus and
// the Learning_Experience log — the numbers behind the Insights view.
function computeInsights(root, events) {
  const evts = events || [];
  const rotations = evts.reduce((max, e) => Math.max(max, e.rotation || 0), 0);

  // mistakes = red e2e events; self-heals = explicit self-heal steps.
  const mistakeEvents = evts.filter((e) => e.agent === 'e2e-tester' && e.level === 'bad');
  const selfHeals = evts.filter((e) => /Self-heal:/.test(e.message || '')).length;
  const observations = evts.filter((e) => e.level === 'observation').length;

  // mistakes per rotation (for the trend chart)
  const perRotation = [];
  for (let r = 1; r <= rotations; r += 1) {
    perRotation.push(mistakeEvents.filter((e) => e.rotation === r).length);
  }

  const lessons = readLessons(root);
  const reworkRate = rotations ? Math.round((selfHeals / rotations) * 100) : 0;

  return {
    rotations,
    mistakes: mistakeEvents.length,
    selfHeals,
    observations,
    reworkRate, // % of rotations that needed a self-heal
    lessons: lessons.length,
    repeats: 0, // no lesson re-triggered (placeholder until lesson-trigger tracking lands)
    perRotation,
  };
}

function readLessons(root) {
  const dir = brainDir(root); // shared brain when inside a workspace
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((f) => /^L\d+.*\.md$/i.test(f));
  } catch {
    return [];
  }
}

module.exports = { computeInsights };
