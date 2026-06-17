// MCP tools: pac CLI wrappers (Power Apps Code App quick start).

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

export function registerPacTools(server, defaultRoot) {

  // ── initialize_code_app ─────────────────────────────────────────────────────
  // Runs pac auth (if environmentUrl given) + pac code init to scaffold the
  // Power Apps Code App entry point. This is the "quick start" step.
  server.tool(
    'initialize_code_app',
    {
      appName:        z.string().default('MyPowerApp').describe('Display name for the Code App'),
      environmentUrl: z.string().optional().describe('Power Platform environment URL — triggers pac auth if given'),
      outputDir:      z.string().optional().describe('Where to create the scaffold (absolute path; defaults to {projectDir}/src)'),
      projectDir:     z.string().optional().describe('Project root (defaults to server cwd)'),
    },
    safe(async ({ appName, environmentUrl, outputDir, projectDir }, extra) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { mustExist: true, label: 'projectDir' });
      const out = outputDir ? resolveProjectDir(outputDir, defaultRoot, { label: 'outputDir' }) : undefined;
      const pac = lib('pac-init');
      const progress = makeProgress(extra);
      const log = [];
      const onEmit = async ({ level, message }) => { const l = `[${level}] ${message}`; log.push(l); await progress(l); };

      // Fail fast with an actionable message if pac/auth aren't ready (Fix 1.5).
      await pac.preflight({ environmentUrl, emit: onEmit });

      const result = await pac.initCodeApp(root, { appName, environmentUrl, outputDir: out, emit: onEmit });
      const text = [
        result.initialised
          ? `✓ Code App "${appName}" initialised at: ${result.appDir}`
          : `✗ Initialisation failed: ${result.error}`,
        '',
        'Log:',
        ...log,
        result.initialised
          ? '\nNext: build the app (npm run build) then call push_code_app.'
          : '',
      ].join('\n');
      const res = { content: [{ type: 'text', text }] };
      if (!result.initialised) res.isError = true;
      return res;
    }),
  );

  // ── push_code_app ───────────────────────────────────────────────────────────
  // Runs pac code push to deploy the built app to Power Apps.
  server.tool(
    'push_code_app',
    {
      appDir:     z.string().optional().describe('Directory containing the built app (defaults to {projectDir}/src)'),
      projectDir: z.string().optional().describe('Project root (defaults to server cwd)'),
    },
    safe(async ({ appDir, projectDir }, extra) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { mustExist: true, label: 'projectDir' });
      const dir = appDir ? resolveProjectDir(appDir, defaultRoot, { label: 'appDir' }) : undefined;
      const pac = lib('pac-init');
      const progress = makeProgress(extra);
      const log = [];
      const result = await pac.pushCodeApp(root, {
        appDir: dir,
        emit: async ({ level, message }) => { const l = `[${level}] ${message}`; log.push(l); await progress(l); },
      });
      const text = [
        result.pushed ? '✓ pac code push succeeded.' : `✗ Push failed: ${result.error}`,
        '',
        'Log:',
        ...log,
      ].join('\n');
      const res = { content: [{ type: 'text', text }] };
      if (!result.pushed) res.isError = true;
      return res;
    }),
  );

  // ── list_pac_auth ───────────────────────────────────────────────────────────
  // Lists active pac auth profiles so the host knows which environments are ready.
  server.tool(
    'list_pac_auth',
    {},
    safe(async () => {
      const pac = lib('pac-init');
      const profiles = await pac.listAuthProfiles();
      const text = profiles.length
        ? profiles.map((p) => `${p.isActive ? '★ active' : '·'} ${p.url || '(no url)'} — ${p.line}`).join('\n')
        : 'No pac auth profiles found. Call initialize_code_app with environmentUrl to authenticate.';
      return { content: [{ type: 'text', text }] };
    }),
  );
}
