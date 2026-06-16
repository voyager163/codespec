#!/usr/bin/env node
// Registers the PowerCodex MCP server with Claude Code (or prints Claude Desktop instructions).
// Usage:
//   node bin/install-plugin.mjs              → project-scoped (default)
//   node bin/install-plugin.mjs --user       → user-scoped (all projects)
//   node bin/install-plugin.mjs --root /path → set POWERCODEX_ROOT explicitly
//   npx @elfredseow/powercodex install-powercodex-mcp

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    user:  { type: 'boolean',           default: false  },
    root:  { type: 'string',            default: process.cwd() },
    help:  { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

const MCP_BIN = path.resolve(fileURLToPath(import.meta.url), '../powercodex-mcp.mjs');
const ROOT    = path.resolve(values.root);

if (values.help) {
  console.log(`
powercodex install-powercodex-mcp — register the PowerCodex MCP server with Claude Code

Usage:
  node bin/install-plugin.mjs [options]
  npx @elfredseow/powercodex install-powercodex-mcp [options]

Options:
  --user         Register at user scope (available in all projects)
  --root <path>  Set POWERCODEX_ROOT (default: current directory)
  -h, --help     Show this help

Examples:
  npx @elfredseow/powercodex install-powercodex-mcp
  npx @elfredseow/powercodex install-powercodex-mcp --user
  npx @elfredseow/powercodex install-powercodex-mcp --root /path/to/my-project
`);
  process.exit(0);
}

// ── Check claude CLI is available ──────────────────────────────────────────────
const probe = spawnSync('claude', ['--version'], { encoding: 'utf8' });
if (probe.error) {
  console.error('\n❌  The "claude" CLI was not found on your PATH.\n');
  console.error('   Install Claude Code: https://claude.ai/download\n');
  console.error('   Then re-run this command.\n');
  console.error('   ── Claude Desktop users ─────────────────────────────────────────────');
  console.error('   Add this block to claude_desktop_config.json manually:\n');
  console.error(JSON.stringify({
    mcpServers: {
      powercodex: {
        command: 'node',
        args: [MCP_BIN],
        env: { POWERCODEX_ROOT: ROOT },
      },
    },
  }, null, 2));
  process.exit(1);
}

// ── Build claude mcp add arguments ────────────────────────────────────────────
const scope = values.user ? 'user' : 'project';
const args  = [
  'mcp', 'add',
  '--scope', scope,
  '--env',   `POWERCODEX_ROOT=${ROOT}`,
  'powercodex',
  'node', MCP_BIN,
];

console.log(`\n  Scope : ${scope}`);
console.log(`  Root  : ${ROOT}`);
console.log(`\n  Running: claude ${args.join(' ')}\n`);

try {
  execFileSync('claude', args, { stdio: 'inherit' });
} catch {
  process.exit(1);
}

console.log(`
✓  PowerCodex MCP server registered (${scope} scope).

   Next: restart Claude Code (or your AI host) to activate the server.
   Test:  ask Claude "List my pac auth profiles." to verify the connection.
`);
