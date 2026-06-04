'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readEvents } = require('./bus');
const { load: loadRights } = require('./rights');
const { scoreCompliance, scoreStoriesGrounding, scoreMvpAgainstStories } = require('./compliance');
const { computeInsights } = require('./insights');
const { summary: workspaceSummary, brainDir } = require('./workspace');
const { readStories } = require('./stories');
const { readDigest } = require('./digest');
const freeze = require('./freeze');

const STAGES = ['Intake', 'Plan', 'Approve', 'Build', 'Run', 'Test', 'Observe'];

// Each agent owns one or more lifecycle stages. State is derived from the bus.
const AGENTS = [
  { id: 'intake', name: 'Intake', role: 'goal + MVP gate', emoji: '🚦', stages: [0] },
  { id: 'planner', name: 'Planner', role: 'HTML spec artifacts', emoji: '🧭', stages: [1, 2] },
  { id: 'build-executor', name: 'Build Executor', role: 'Engine 1 · MDM browser', emoji: '🛠', stages: [3] },
  { id: 'runner', name: 'Runner', role: 'push / dev', emoji: '🚀', stages: [4] },
  { id: 'e2e-tester', name: 'E2E Tester', role: 'Engine 2 · self-heal', emoji: '🧪', stages: [5] },
  { id: 'observer', name: 'Observer', role: 'spec author', emoji: '👁', stages: [6] },
];

// The whole system, as one JSON snapshot the dashboard renders from.
function deriveState(root) {
  const events = readEvents(root);
  const last = events[events.length - 1] || {};
  const rotation = events.reduce((max, e) => Math.max(max, e.rotation || 0), 0);
  const done = last.stage === 7;
  const stopped = done && last.level === 'warn';
  const stageEvents = events.filter((e) => typeof e.stage === 'number' && e.stage < 7);
  const currentStage = done ? 7 : stageEvents.length ? stageEvents[stageEvents.length - 1].stage : 0;

  // Use the most recent intake (a dashboard edit appends a newer one).
  const intakeGood = [...events].reverse().find((e) => e.data && e.data.goal) || {};
  const intakeData = intakeGood.data || {};

  const stages = STAGES.map((label, i) => ({
    i,
    label,
    status: done || i < currentStage ? 'done' : i === currentStage ? 'active' : 'queued',
  }));

  const agents = AGENTS.map((a) => {
    const mine = events.filter((e) => e.agent === a.id);
    const min = Math.min(...a.stages);
    const max = Math.max(...a.stages);
    let state;
    let progress;
    if (done) {
      state = mine.length ? 'done' : 'idle';
      progress = mine.length ? 100 : 0;
    } else if (currentStage > max) {
      state = 'done';
      progress = 100;
    } else if (currentStage >= min && currentStage <= max) {
      state = 'working';
      progress = 70;
    } else {
      state = 'queued';
      progress = 0;
    }
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      emoji: a.emoji,
      state,
      progress,
      task: mine.length ? mine[mine.length - 1].message : 'waiting…',
      events: mine.length,
    };
  });

  const coverageEvent = [...events].reverse().find((e) => /MVP coverage/.test(e.message || ''));
  const coverageMatch = coverageEvent ? /(\d+)% MVP coverage/.exec(coverageEvent.message) : null;
  const failEvent = [...events].reverse().find((e) => e.agent === 'e2e-tester' && e.level === 'bad');

  const observations = events
    .filter((e) => e.level === 'observation')
    .map((e) => ({
      ts: e.ts,
      rotation: e.rotation,
      signal: (e.data && e.data.signal) || 'observation',
      confidence: (e.data && e.data.confidence) || null,
      needsApproval: !(e.data && e.data.needsApproval === false),
      title: (e.message || '').replace(/^Authored next spec from observation · \w+ · /, ''),
    }))
    .reverse();

  // Real goal↔MVP compliance, recomputed from the latest intake.
  const compliance = scoreCompliance(intakeData.goal, intakeData.mvp);

  // Code-grounded intake: stories from the digest + the extra compliance
  // dimensions (stories↔code, MVP↔stories). All optional — null when not ingested.
  const digest = readDigest(root);
  const storiesDoc = readStories(root);
  const storyList = (storiesDoc && storiesDoc.stories) || [];
  const ingestion = {
    analyzed: !!digest,
    digest: digest
      ? { name: digest.name, mode: digest.mode, routes: (digest.routes || []).length, components: (digest.components || []).length, partial: !!(digest.coverage && digest.coverage.partial) }
      : null,
    stories: storyList,
    freeze: freeze.readFreeze(root),
    grounding: storiesDoc ? scoreStoriesGrounding(storyList, digest) : null,
    mvpAgainstStories: storyList.length && intakeData.mvp ? scoreMvpAgainstStories(intakeData.mvp, storyList) : null,
  };

  // Notifications: approvals waiting + goal drift. Surfaced as a banner.
  const notifications = [];
  for (const o of observations) {
    if (o.needsApproval) notifications.push({ kind: 'approval', signal: o.signal, title: o.title, ts: o.ts });
  }
  if (intakeData.goal && intakeData.mvp && !compliance.aligned) {
    notifications.push({ kind: 'drift', signal: 'drift', title: compliance.reason, ts: last.ts || null });
  }

  return {
    brand: 'PowerCodex',
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    lastTs: last.ts || null,
    rotation,
    mode: intakeData.mode || null,
    done,
    stopped,
    currentStage,
    overallProgress: done ? 100 : Math.round((currentStage / STAGES.length) * 100),
    stages,
    agents,
    intake: {
      goal: intakeData.goal || null,
      mvp: intakeData.mvp || null,
      compliance: compliance.score,
      complianceDetail: compliance,
      rights: loadRights(root),
    },
    insights: computeInsights(root, events),
    ingestion,
    workspace: workspaceSummary(root),
    notifications,
    test: {
      coverage: coverageMatch ? Number(coverageMatch[1]) : null,
      lastFailure: failEvent ? failEvent.message : null,
    },
    feed: events
      .slice(-44)
      .reverse()
      .map((e) => ({ ts: e.ts, rotation: e.rotation, agent: e.agent, level: e.level, message: e.message })),
    observations,
    lessons: readLessons(root),
  };
}

// Surface real lessons from the Learning_Experience/ log when present.
function readLessons(root) {
  const dir = brainDir(root); // shared brain when inside a workspace
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^L\d+.*\.md$/i.test(f))
      .map((f) => {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        const heading = (text.split('\n').find((l) => l.trim().startsWith('#')) || f).replace(/^#+\s*/, '').trim();
        return { id: f.split('-')[0].toUpperCase(), title: heading };
      });
  } catch {
    return [];
  }
}

module.exports = { deriveState, STAGES, AGENTS };
