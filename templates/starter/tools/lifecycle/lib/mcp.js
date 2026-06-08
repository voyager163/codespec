'use strict';
// MCP bridge — "use the right tool for the project." VS Code (and Cursor) keep their
// Model Context Protocol server definitions in the workspace at .vscode/mcp.json (or
// .cursor/mcp.json). PowerCodex reads those so the agent knows which capabilities are
// available — e.g. a Power BI MCP for dashboard/dataset work.
//
// This is read-only and entirely optional: no MCP configured simply means the agent
// falls back to authoring a standalone artifact instead. PowerCodex never depends on an
// MCP server being present, and never writes these files.
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATHS = [
  ['.vscode', 'mcp.json'],
  ['.cursor', 'mcp.json'],
  ['.mcp.json'],
];

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// VS Code uses { "servers": { name: {...} } }; some tools use { "mcpServers": {...} }.
function serversFrom(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return obj.servers || obj.mcpServers || {};
}

// List the MCP servers configured for this workspace. Returns
// [{ name, command, source }] — empty when nothing is configured.
function list(root) {
  const out = [];
  const seen = new Set();
  for (const parts of CONFIG_PATHS) {
    const p = path.join(root, ...parts);
    const obj = readJson(p);
    const servers = serversFrom(obj);
    for (const [name, def] of Object.entries(servers)) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        command: (def && (def.command || (Array.isArray(def.args) ? def.args.join(' ') : ''))) || (def && def.url) || '',
        source: parts.join('/'),
      });
    }
  }
  return out;
}

function has(root, predicate) {
  return list(root).some(predicate);
}

// Is a Power BI MCP available? Matches common naming.
function powerBi(root) {
  return list(root).find((s) => /power ?bi|pbi|fabric/i.test(s.name + ' ' + s.command)) || null;
}

module.exports = { list, has, powerBi };
