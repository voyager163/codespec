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

// Stories↔code: are the generated stories grounded in the digest? A story is
// grounded when every source it cites exists in the digest's known files. Returns
// { score, grounded, ungrounded, reason } — explainable, like scoreCompliance.
function scoreStoriesGrounding(stories, digest) {
  const list = Array.isArray(stories) ? stories : (stories && stories.stories) || [];
  if (!list.length) {
    return { score: 0, grounded: false, ungrounded: [], reason: 'No stories to score yet.' };
  }
  const known = new Set();
  for (const arr of [digest && digest.routes, digest && digest.components, digest && digest.data]) {
    for (const item of arr || []) if (item.source) known.add(item.source);
  }
  const isGrounded = (s) => (s.sources || []).length > 0 && s.sources.every((f) => known.has(f));
  const ok = list.filter(isGrounded);
  const ungrounded = list.filter((s) => !isGrounded(s)).map((s) => s.id || s.title);
  const score = Math.round((ok.length / list.length) * 100);
  return {
    score,
    grounded: score >= 60,
    ungrounded,
    reason: ungrounded.length
      ? `Stories not grounded in the code: ${ungrounded.slice(0, 6).join(', ')}.`
      : 'Every story is grounded in the code.',
  };
}

// MVP↔stories: does the MVP serve the reviewed stories? Keyword coverage of the
// stories' intents against the MVP text — same heuristic as goal↔MVP.
function scoreMvpAgainstStories(mvp, stories) {
  const list = Array.isArray(stories) ? stories : (stories && stories.stories) || [];
  if (!list.length) {
    return { score: 0, aligned: false, covered: [], missing: [], reason: 'No stories to score the MVP against.' };
  }
  const mvpTokens = new Set(tokenize(mvp));
  const intentText = (s) => `${s.title} ${s.iWant} ${s.soThat}`;
  const covered = [];
  const missing = [];
  for (const s of list) {
    const intentKeys = keywords(intentText(s));
    const hit = intentKeys.some((k) => mvpTokens.has(k));
    (hit ? covered : missing).push(s.id || s.title);
  }
  const score = Math.round((covered.length / list.length) * 100);
  return {
    score,
    aligned: score >= 60,
    covered,
    missing,
    reason: missing.length
      ? `MVP does not yet serve: ${missing.slice(0, 6).join(', ')}.`
      : 'MVP serves every reviewed story.',
  };
}

module.exports = { scoreCompliance, keywords, scoreStoriesGrounding, scoreMvpAgainstStories };
