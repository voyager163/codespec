// MCP tools: lifecycle loop control.
//
// The lifecycle loop is long-running (up to 20 rotations of real browser
// automation) and has human-in-the-loop approval gates. MCP hosts serialize tool
// calls and time out long requests (~60s on Claude Desktop), so we MUST NOT model
// a human pause as one blocking request. Instead the loop runs as a background
// session in this (long-lived) server process, and each tool call returns at the
// next "checkpoint" — an approval gate or completion — never spanning the pause:
//
//   start_lifecycle_loop → runs until the first gate or completion, returns a snapshot
//   approve_fix / reject_fix → set the decision, return at the next gate or completion
//   get_lifecycle_state → reports the current session status + new events
//
// See docs/plans/mcp-production-hardening-plan.html (Fixes 1.1–1.4).

import { z } from 'zod';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safe } from '../lib/safe-tool.mjs';
import { resolveProjectDir } from '../lib/resolve-root.mjs';
import { makeProgress } from '../lib/progress.mjs';

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');
function lib(name) { return require(path.join(LIB, name)); }

const noop = async () => {};

// One background loop session per project root.
const sessions = new Map(); // root → session

const SESSION_TTL_MS = 30 * 60 * 1000; // keep a settled session's final state readable for 30 min

// Drop settled sessions whose final state has been readable long enough, so a
// long-lived server doesn't accumulate one entry per project root forever.
function pruneSessions() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (s.settled && s.settledAt && now - s.settledAt > SESSION_TTL_MS) sessions.delete(key);
  }
}

function makeCheckpoint() {
  let resolve;
  let done = false;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve: () => { if (!done) { done = true; resolve(); } } };
}

function raceTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => { setTimeout(r, ms).unref?.(); })]);
}

// Render the new events since the caller last looked, plus a status header.
function snapshot(session) {
  const newEvents = session.events.slice(session.cursor);
  session.cursor = session.events.length;

  const head = [];
  head.push(`Lifecycle: ${session.status}${session.status === 'awaiting_approval' ? ` · resumeToken ${session.id}` : ''}`);
  if (session.status === 'awaiting_approval') {
    head.push('Review the plan/diff, then call approve_fix (or reject_fix) for this project to continue.');
  }
  if (session.summary) {
    const s = session.summary;
    head.push(`Rotations: ${s.rotations} · Self-heals: ${s.selfHeals} · Mode: ${s.mode} · Fix-mode: ${s.fixMode}` + (s.stopped ? ' · ⚠ stopped' : ''));
  }
  if (session.error) head.push(`Error: ${session.error}`);

  const text = [...head, '', 'Events:', ...(newEvents.length ? newEvents : ['(no new events)'])].join('\n');
  const result = { content: [{ type: 'text', text }] };
  if (session.status === 'error') result.isError = true;
  return result;
}

export function registerLifecycleTools(server, defaultRoot) {

  // ── start_lifecycle_loop ────────────────────────────────────────────────────
  server.tool(
    'start_lifecycle_loop',
    {
      goal:            z.string().optional().describe('What the app should do for its users'),
      rotations:       z.number().int().min(1).max(20).optional().default(1).describe('Number of loop rotations to run'),
      fixMode:         z.enum(['manual', 'diff', 'auto']).optional().default('manual')
                        .describe('What to do when tests stay red after self-heal: manual=stop, diff=gate for approval, auto=keep fixing'),
      maxHealRetries:  z.number().int().min(1).max(10).optional().default(3).describe('Max auto-fix attempts per rotation (auto mode only)'),
      maxDurationMs:   z.number().int().min(1).optional().default(600000).describe('Wall-clock cap; the loop stops cleanly at the next rotation/approval boundary when exceeded'),
      real:            z.boolean().optional().default(false).describe('Use real managed Edge browser (needs Playwright)'),
      appUrl:          z.string().optional().describe('Live app URL for real e2e smoke tests'),
      environmentId:   z.string().optional().describe('Power Platform environment GUID'),
      projectDir:      z.string().optional().describe('Project root (defaults to server cwd)'),
    },
    safe(async ({ goal, rotations, fixMode, maxHealRetries, maxDurationMs, real, appUrl, environmentId, projectDir }, extra) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { mustExist: true, label: 'projectDir' });
      const { runLoop } = lib('loop');
      pruneSessions();

      const session = {
        id: `loop-${Date.now().toString(36)}`,
        status: 'running',
        events: [],
        cursor: 0,
        approved: false,
        rejected: false,
        settled: false,
        summary: null,
        error: null,
        deadline: Date.now() + maxDurationMs,
        progress: makeProgress(extra),
        checkpoint: makeCheckpoint(),
      };
      sessions.set(root, session);

      const emit = async (event) => {
        const line = `[${event.stage ?? '?'}:${event.level}] ${event.message}`;
        session.events.push(line);
        await session.progress(line);
        const msg = event.message || '';
        if (/Waiting for your approval/i.test(msg)) {
          session.status = 'awaiting_approval';
          session.checkpoint.resolve();           // gate reached → unblock the in-flight call
        } else if (/proceeding to build|re-running tests/i.test(msg)) {
          session.approved = false;               // consume the approval; next gate waits again
          session.status = 'running';
        }
      };

      // Kick the loop off DETACHED — the request returns at the first checkpoint, the
      // loop keeps running in this process until the next call resumes/observes it.
      runLoop(root, {
        goal,
        rotations,
        fixMode,
        maxHealRetries,
        simulate: !real,
        appUrl,
        env: environmentId,
        isApproved: fixMode === 'diff' ? () => session.approved : undefined,
        isRejected: () => session.rejected,
        shouldAbort: () => Date.now() > session.deadline,
        emit,
      }).then((summary) => {
        session.summary = summary;
        session.status = summary.stopped ? 'stopped' : 'complete';
        session.settled = true;
        session.settledAt = Date.now();
        session.checkpoint.resolve();
      }).catch((err) => {
        session.status = 'error';
        session.error = err?.message || String(err);
        session.settled = true;
        session.settledAt = Date.now();
        session.checkpoint.resolve();
      });

      try {
        await session.checkpoint.promise;          // first gate or completion
        return snapshot(session);
      } finally {
        session.progress = noop;                    // stop streaming to this (now-finished) request
      }
    }),
  );

  // ── approve_fix ─────────────────────────────────────────────────────────────
  // Resume a loop paused at an approval gate (build approval or diff fix-mode).
  server.tool(
    'approve_fix',
    {
      projectDir: z.string().optional().describe('Project root matching the running loop'),
    },
    safe(async ({ projectDir }, extra) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { label: 'projectDir' });
      return resumeSession(root, extra, { approve: true });
    }),
  );

  // ── reject_fix ──────────────────────────────────────────────────────────────
  // Decline the pending fix/build so the loop stops cleanly instead of building.
  server.tool(
    'reject_fix',
    {
      projectDir: z.string().optional().describe('Project root matching the running loop'),
    },
    safe(async ({ projectDir }, extra) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { label: 'projectDir' });
      return resumeSession(root, extra, { approve: false });
    }),
  );

  function resumeSession(root, extra, { approve }) {
    const session = sessions.get(root);
    if (!session) return { content: [{ type: 'text', text: 'No lifecycle loop is running for this project. Start one with start_lifecycle_loop.' }] };
    if (session.settled) return snapshot(session);
    if (session.status !== 'awaiting_approval') {
      return { content: [{ type: 'text', text: `Loop is "${session.status}", not waiting for approval. Use get_lifecycle_state to follow it.` }] };
    }

    session.checkpoint = makeCheckpoint();   // fresh checkpoint BEFORE flipping the decision
    session.progress = makeProgress(extra);
    if (approve) { session.approved = true; session.status = 'running'; }
    else { session.rejected = true; }

    // Await the NEXT gate or completion, but don't block past a step budget — a real
    // build can take a while, in which case we return "running" and the caller polls.
    const stepBudget = Math.max(5000, Math.min(session.deadline - Date.now(), 120000));
    return raceTimeout(session.checkpoint.promise, stepBudget)
      .then(() => snapshot(session))
      .finally(() => { session.progress = noop; });
  }

  // ── get_lifecycle_state ─────────────────────────────────────────────────────
  server.tool(
    'get_lifecycle_state',
    {
      projectDir: z.string().optional().describe('Project root'),
    },
    safe(async ({ projectDir }) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { label: 'projectDir' });

      // Prefer the live in-memory session when one is active.
      const session = sessions.get(root);
      if (session) return snapshot(session);

      // Otherwise fall back to the persisted bus state on disk.
      const { liveDir } = lib('paths');
      const fs = require('node:fs');
      const busFile = path.join(liveDir(root), 'bus.json');
      if (!fs.existsSync(busFile)) return { content: [{ type: 'text', text: 'No lifecycle state found. Run start_lifecycle_loop first.' }] };
      const state = JSON.parse(fs.readFileSync(busFile, 'utf8'));
      return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
    }),
  );
}
