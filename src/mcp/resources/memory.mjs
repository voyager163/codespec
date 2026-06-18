// MCP resources: powercodex://rules, powercodex://memory, powercodex://memory/{filename},
//                powercodex://learnings, powercodex://learnings/{filename}
//
// Exposes the PowerCodex harness rules (CLAUDE.md), persistent memory files, and the
// Learning_Experience log so any MCP-compatible AI agent can load the same project
// context that Claude Code uses — and read the accumulated mistake log before starting work.
//
// URIs:
//   powercodex://rules                   → CLAUDE.md non-negotiable workflow rules
//   powercodex://memory                  → MEMORY.md index of all memory files
//   powercodex://memory/{filename}       → individual memory file
//   powercodex://learnings               → Learning_Experience/LEARNINGS.md index
//   powercodex://learnings/{filename}    → individual learning entry (e.g. L001-slug.md)
//
// Memory location: Claude Code stores project memories at
//   ~/.claude/projects/{encoded-root}/memory/
// where the encoded root lowercases the absolute path and replaces : \ / with -.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

// Encode an absolute project path to the Claude Code project directory name.
// Example: C:\Users\foo\my-proj  →  c--users-foo-my-proj
function encodeProjectPath(absPath) {
  return absPath.toLowerCase().replace(/[:\\/]/g, '-').replace(/^-+/, '');
}

function claudeMemoryDir(root) {
  const encoded = encodeProjectPath(path.resolve(root));
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory');
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md'));
}

const SAFE_FILENAME = /^[A-Za-z0-9_.-]+\.md$/;

function safeFilename(filename) {
  return SAFE_FILENAME.test(filename) && !filename.includes('..');
}

export function registerMemoryResource(server, defaultRoot) {
  const memDir = claudeMemoryDir(defaultRoot);
  const learningsDir = path.join(defaultRoot, 'Learning_Experience');

  // ── powercodex://rules — CLAUDE.md harness rules ──────────────────────────
  server.resource(
    'harness-rules',
    new ResourceTemplate('powercodex://rules', {
      list: async () => ({
        resources: [{
          uri: 'powercodex://rules',
          name: 'harness-rules',
          mimeType: 'text/markdown',
          description: 'Non-negotiable PowerCodex workflow rules (CLAUDE.md)',
        }],
      }),
    }),
    async (uri) => {
      const rulesFile = path.join(defaultRoot, 'CLAUDE.md');
      if (!existsSync(rulesFile)) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'No CLAUDE.md found in project root.' }] };
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(rulesFile, 'utf8') }] };
    },
  );

  // ── powercodex://memory — MEMORY.md index ────────────────────────────────
  server.resource(
    'memory-index',
    new ResourceTemplate('powercodex://memory', {
      list: async () => {
        const files = listMarkdownFiles(memDir);
        return {
          resources: [
            { uri: 'powercodex://memory', name: 'memory-index', mimeType: 'text/markdown', description: 'Index of all PowerCodex memory files' },
            ...files
              .filter((f) => f !== 'MEMORY.md')
              .map((f) => ({ uri: `powercodex://memory/${f}`, name: f, mimeType: 'text/markdown' })),
          ],
        };
      },
    }),
    async (uri) => {
      const indexFile = path.join(memDir, 'MEMORY.md');
      if (!existsSync(indexFile)) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: 'No memory index found. Memory files are written by Claude Code during sessions.',
          }],
        };
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(indexFile, 'utf8') }] };
    },
  );

  // ── powercodex://memory/{filename} — individual memory file ───────────────
  server.resource(
    'memory-by-filename',
    new ResourceTemplate('powercodex://memory/{filename}', { list: undefined }),
    async (uri, variables) => {
      const filename = variables?.filename;
      if (!safeFilename(filename)) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Invalid filename.' }] };
      }
      const memFile = path.join(memDir, filename);
      if (!existsSync(memFile)) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Memory file "${filename}" not found. Fetch powercodex://memory to list available files.`,
          }],
        };
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(memFile, 'utf8') }] };
    },
  );

  // ── powercodex://learnings — Learning_Experience/LEARNINGS.md index ───────
  server.resource(
    'learnings-index',
    new ResourceTemplate('powercodex://learnings', {
      list: async () => {
        const files = listMarkdownFiles(learningsDir).filter((f) => f !== 'LEARNINGS.md' && f !== 'README.md' && f !== '_TEMPLATE.md');
        return {
          resources: [
            { uri: 'powercodex://learnings', name: 'learnings-index', mimeType: 'text/markdown', description: 'Index of all logged Learning_Experience entries' },
            ...files.map((f) => ({ uri: `powercodex://learnings/${f}`, name: f, mimeType: 'text/markdown' })),
          ],
        };
      },
    }),
    async (uri) => {
      const indexFile = path.join(learningsDir, 'LEARNINGS.md');
      if (!existsSync(indexFile)) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'No Learning_Experience log found. The log is created when the first mistake is recorded.' }] };
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(indexFile, 'utf8') }] };
    },
  );

  // ── powercodex://learnings/{filename} — individual learning entry ─────────
  server.resource(
    'learning-by-filename',
    new ResourceTemplate('powercodex://learnings/{filename}', { list: undefined }),
    async (uri, variables) => {
      const filename = variables?.filename;
      if (!safeFilename(filename)) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Invalid filename.' }] };
      }
      const entryFile = path.join(learningsDir, filename);
      if (!existsSync(entryFile)) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Learning entry "${filename}" not found. Fetch powercodex://learnings to list available entries.`,
          }],
        };
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(entryFile, 'utf8') }] };
    },
  );
}
