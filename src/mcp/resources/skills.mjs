// MCP resources: powercodex://skills and powercodex://skills/{name}
//
// Exposes every .powerplatform/**/SKILL.md file so any MCP-compatible AI agent
// (Cursor, Windsurf, Copilot, etc.) can read full skill instructions — not just
// Claude Code via the /skill harness command.
//
// URIs:
//   powercodex://skills          → JSON list of { name, uri } for each skill found
//   powercodex://skills/{name}   → full markdown content of that skill's SKILL.md

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

function discoverSkills(root) {
  const base = path.join(root, '.powerplatform');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, file: path.join(base, d.name, 'SKILL.md') }))
    .filter((s) => existsSync(s.file));
}

export function registerSkillsResource(server, defaultRoot) {
  // List all discovered skills.
  server.resource(
    'skills-list',
    new ResourceTemplate('powercodex://skills', {
      list: async () => ({
        resources: [{ uri: 'powercodex://skills', name: 'skills-list', mimeType: 'application/json', description: 'Lists all available PowerCodex skills' }],
      }),
    }),
    async (uri) => {
      const skills = discoverSkills(defaultRoot);
      const list = skills.map((s) => ({ name: s.name, uri: `powercodex://skills/${s.name}` }));
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  // Individual skill by folder name.
  server.resource(
    'skill-by-name',
    new ResourceTemplate('powercodex://skills/{name}', { list: undefined }),
    async (uri, variables) => {
      const name = variables?.name;
      const skillFile = path.join(defaultRoot, '.powerplatform', name, 'SKILL.md');
      if (!existsSync(skillFile)) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Skill "${name}" not found. Fetch powercodex://skills to list available skills.`,
          }],
        };
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(skillFile, 'utf8') }],
      };
    },
  );
}
