// MCP tools: project scaffolding (wraps bin/create-powercodex.js).

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { safe } from '../lib/safe-tool.mjs';
import { resolveProjectDir } from '../lib/resolve-root.mjs';

const execAsync = promisify(execFile);
const BIN = path.resolve(fileURLToPath(import.meta.url), '../../../../bin/create-powercodex.js');

export function registerScaffoldTools(server, defaultRoot) {

  // ── scaffold_project ────────────────────────────────────────────────────────
  // Creates a new PowerCodex project (Vite + React + TypeScript + OpenSpec + pac).
  server.tool(
    'scaffold_project',
    {
      name:        z.string().describe('App name in kebab-case (e.g. inspection-app)'),
      targetDir:   z.string().describe('Absolute path to the directory where the project will be created'),
      skipInstall: z.boolean().optional().default(false).describe('Skip npm install (faster but leaves node_modules absent)'),
      skipGit:     z.boolean().optional().default(false).describe('Skip git init'),
    },
    safe(async ({ name, targetDir, skipInstall, skipGit }) => {
      // Confine the creation directory to the allowed workspace (Fix 0.3).
      const dir = resolveProjectDir(targetDir, defaultRoot, { mustExist: true, label: 'targetDir' });
      const args = [name];
      if (skipInstall) args.push('--skip-install');
      if (skipGit) args.push('--skip-git');

      const { stdout, stderr } = await execAsync('node', [BIN, ...args], { cwd: dir });
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Project "${name}" scaffolded at ${path.join(dir, name)}`,
            stdout,
            stderr ? `\nWarnings:\n${stderr}` : '',
          ].join('\n').trim(),
        }],
      };
    }),
  );
}
