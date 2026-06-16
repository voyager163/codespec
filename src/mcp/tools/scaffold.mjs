// MCP tools: project scaffolding (wraps bin/create-powercodex.js).

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execAsync = promisify(execFile);
const BIN = path.resolve(fileURLToPath(import.meta.url), '../../../../bin/create-powercodex.js');

export function registerScaffoldTools(server, _defaultRoot) {

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
    async ({ name, targetDir, skipInstall, skipGit }) => {
      const args = [name];
      if (skipInstall) args.push('--skip-install');
      if (skipGit) args.push('--skip-git');

      try {
        const { stdout, stderr } = await execAsync('node', [BIN, ...args], { cwd: targetDir });
        return {
          content: [{
            type: 'text',
            text: [
              `✓ Project "${name}" scaffolded at ${path.join(targetDir, name)}`,
              stdout,
              stderr ? `\nWarnings:\n${stderr}` : '',
            ].join('\n').trim(),
          }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `✗ Scaffold failed: ${e.message}\n${e.stderr || ''}` }],
        };
      }
    },
  );
}
