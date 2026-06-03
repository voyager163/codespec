'use strict';

// Real goal↔MVP compliance: does the MVP actually serve the stated goal? A
// deterministic keyword-coverage heuristic — the MVP must mention the goal's
// salient concepts. Cheap, explainable, and good enough to catch drift.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'with', 'in', 'on', 'is', 'are', 'be', 'that',
  'this', 'it', 'as', 'by', 'from', 'at', 'their', 'what', 'who', 'so', 'see', 'every', 'each', 'all',
  'they', 'can', 'will', 'should', 'has', 'have', 'into', 'its', 'you', 'your', 'our', 'when', 'then',
]);

function tokenize(text) {
  return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function keywords(text) {
  return [...new Set(tokenize(text).filter((t) => t.length > 2 && !STOP.has(t)))];
}

// Returns { score, aligned, covered, missing, reason }.
function scoreCompliance(goal, mvp) {
  const goalKeys = keywords(goal);
  if (goalKeys.length === 0) {
    return { score: 0, aligned: false, covered: [], missing: [], reason: 'No goal set yet.' };
  }
  const mvpTokens = new Set(tokenize(mvp));
  const covered = goalKeys.filter((k) => mvpTokens.has(k));
  const missing = goalKeys.filter((k) => !mvpTokens.has(k));
  const score = Math.round((covered.length / goalKeys.length) * 100);
  const aligned = score >= 60;
  return {
    score,
    aligned,
    covered,
    missing,
    reason: aligned
      ? 'MVP covers the goal.'
      : `MVP drifts from the goal — not covered: ${missing.slice(0, 6).join(', ')}.`,
  };
}

module.exports = { scoreCompliance, keywords };
