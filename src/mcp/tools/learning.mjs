// MCP tool: log_learning
//
// Implements the Rule 4 obligation for non-Claude AI agents: any agent that catches
// a mistake must log it here before continuing. Writes a new Lxxx-slug.md file to
// Learning_Experience/ and appends a row to LEARNINGS.md — the same format Claude Code
// uses when following the learning-experience-protocol memory.
//
// The tool is intentionally narrow: it only appends, never edits existing entries,
// and validates the severity enum so the index stays machine-readable.

import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { safe } from '../lib/safe-tool.mjs';
import { resolveProjectDir } from '../lib/resolve-root.mjs';

const SEVERITY = ['minor', 'major', 'critical'];

export function registerLearningTool(server, defaultRoot) {
  server.tool(
    'log_learning',
    {
      title:       z.string().min(5).describe('One-line title of the mistake (e.g. "Hallucinated API method name")'),
      what:        z.string().min(10).describe('Plain description of what went wrong'),
      why:         z.string().min(10).describe('Root cause — the actual reasoning gap or missing check'),
      impact:      z.string().describe('What it cost: wasted steps, wrong output, user correction, etc.'),
      rule:        z.string().min(10).describe('Concrete imperative rule to avoid repeating this (e.g. "Always grep for X before calling Y")'),
      severity:    z.enum(['minor', 'major', 'critical']).describe('minor | major | critical'),
      area:        z.string().optional().describe('Domain area (e.g. planning, git, dataverse, scaffold, research)'),
      projectDir:  z.string().optional().describe('Project root (defaults to server cwd)'),
    },
    safe(async ({ title, what, why, impact, rule, severity, area, projectDir }) => {
      const root = resolveProjectDir(projectDir, defaultRoot, { mustExist: true, label: 'projectDir' });
      const learningsDir = path.join(root, 'Learning_Experience');

      if (!existsSync(learningsDir)) mkdirSync(learningsDir, { recursive: true });

      // Derive next ID and slug.
      const { readdirSync } = await import('node:fs');
      const nums = readdirSync(learningsDir)
        .map((f) => f.match(/^L(\d+)-/))
        .filter(Boolean)
        .map((m) => parseInt(m[1], 10));
      const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
      const id = `L${String(nextNum).padStart(3, '0')}`;
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
      const filename = `${id}-${slug}.md`;
      const today = new Date().toISOString().slice(0, 10);
      const areaStr = area || 'general';

      // Write the entry file.
      const entry = [
        `---`,
        `id: ${id}`,
        `slug: ${slug}`,
        `date: ${today}`,
        `severity: ${severity}`,
        `area: ${areaStr}`,
        `status: open`,
        `---`,
        ``,
        `# ${id} — ${title}`,
        ``,
        `## What happened`,
        what,
        ``,
        `## Why it was wrong`,
        why,
        ``,
        `## Impact`,
        impact,
        ``,
        `## How to apply (the rule going forward)`,
        rule,
        ``,
        `## Related`,
        `<!-- Add links to specs, memory slugs, or other lessons here -->`,
        ``,
      ].join('\n');

      writeFileSync(path.join(learningsDir, filename), entry, 'utf8');

      // Append a row to LEARNINGS.md.
      const indexFile = path.join(learningsDir, 'LEARNINGS.md');
      if (existsSync(indexFile)) {
        let index = readFileSync(indexFile, 'utf8');
        const row = `| [${id}](./${filename}) | ${severity} | ${title} | ${rule} |`;
        // Insert before the sentinel comment if present, otherwise append.
        const sentinel = '<!-- Append new rows above this line. Newest at the bottom of the table. -->';
        if (index.includes(sentinel)) {
          index = index.replace(sentinel, `${row}\n${sentinel}`);
        } else {
          index = index.trimEnd() + '\n' + row + '\n';
        }
        writeFileSync(indexFile, index, 'utf8');
      }

      return {
        content: [{
          type: 'text',
          text: `Logged ${id}: "${title}" (${severity}) → Learning_Experience/${filename}\nRule: ${rule}`,
        }],
      };
    }),
  );
}
