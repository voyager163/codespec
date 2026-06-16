// MCP tools: lifecycle loop control.
// start_lifecycle_loop spawns the loop in-process and streams events back.
// control_lifecycle is used for approval gates (diff mode).

import { z } from 'zod';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const LIB = path.resolve(fileURLToPath(import.meta.url), '../../../../tools/lifecycle/lib');
function lib(name) { return require(path.join(LIB, name)); }

// Per-project approval state for the 'diff' fix-mode gate.
const approvalState = new Map(); // projectDir → { approved: bool, pending: bool }

export function registerLifecycleTools(server, defaultRoot) {

  // ── start_lifecycle_loop ────────────────────────────────────────────────────
  server.tool(
    'start_lifecycle_loop',
    {
      goal:            z.string().optional().describe('What the app should do for its users'),
      rotations:       z.number().int().min(1).max(20).optional().default(1).describe('Number of loop rotations to run'),
      fixMode:         z.enum(['manual', 'diff', 'auto']).optional().default('manual')
                        .describe('What to do when tests stay red after self-heal: manual=stop, diff=show diff+wait, auto=keep fixing'),
      maxHealRetries:  z.number().int().min(1).max(10).optional().default(3).describe('Max auto-fix attempts per rotation (auto mode only)'),
      real:            z.boolean().optional().default(false).describe('Use real managed Edge browser (needs Playwright)'),
      appUrl:          z.string().optional().describe('Live app URL for real e2e smoke tests'),
      environmentId:   z.string().optional().describe('Power Platform environment GUID'),
      projectDir:      z.string().optional().describe('Project root (defaults to server cwd)'),
    },
    async ({ goal, rotations, fixMode, maxHealRetries, real, appUrl, environmentId, projectDir }) => {
      const root = projectDir || defaultRoot;
      const { runLoop } = lib('loop');
      const log = [];

      // For 'diff' mode, wire up an isApproved callback that checks the approval state map.
      const stateKey = root;
      approvalState.set(stateKey, { approved: false, pending: false });
      const isApproved = fixMode === 'diff' ? () => {
        const s = approvalState.get(stateKey);
        return !!(s && s.approved);
      } : undefined;

      const summary = await runLoop(root, {
        goal,
        rotations,
        fixMode,
        maxHealRetries,
        simulate: !real,
        appUrl,
        env: environmentId,
        isApproved,
        emit: async (event) => { log.push(`[${event.stage ?? '?'}:${event.level}] ${event.message}`); },
      });

      approvalState.delete(stateKey);

      const text = [
        `Loop complete. Rotations: ${summary.rotations} · Self-heals: ${summary.selfHeals} · Mode: ${summary.mode} · Fix-mode: ${summary.fixMode}`,
        summary.stopped ? '⚠ Loop was stopped before completion.' : '✓ Loop finished cleanly.',
        '',
        'Event log:',
        ...log,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    },
  );

  // ── approve_fix ─────────────────────────────────────────────────────────────
  // Used in 'diff' fix-mode: call this after reviewing the diff event to let the
  // loop re-run the tests with the applied fix.
  server.tool(
    'approve_fix',
    {
      projectDir: z.string().optional().describe('Project root matching the running loop'),
    },
    async ({ projectDir }) => {
      const root = projectDir || defaultRoot;
      const s = approvalState.get(root);
      if (!s) return { content: [{ type: 'text', text: 'No loop is waiting for fix approval in this project.' }] };
      s.approved = true;
      return { content: [{ type: 'text', text: '✓ Fix approved — loop will re-run tests.' }] };
    },
  );

  // ── get_lifecycle_state ─────────────────────────────────────────────────────
  server.tool(
    'get_lifecycle_state',
    {
      projectDir: z.string().optional().describe('Project root'),
    },
    async ({ projectDir }) => {
      const root = projectDir || defaultRoot;
      try {
        const { liveDir } = lib('paths');
        const fs = require('node:fs');
        const busFile = path.join(liveDir(root), 'bus.json');
        if (!fs.existsSync(busFile)) return { content: [{ type: 'text', text: 'No lifecycle state found. Run start_lifecycle_loop first.' }] };
        const state = JSON.parse(fs.readFileSync(busFile, 'utf8'));
        return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error reading state: ${e.message}` }] };
      }
    },
  );
}
