'use strict';
// Dataverse schema orchestrator.
//
// Schema source:  {root}/.powercodex/dataverse-schema.json
// Schema state:   {root}/.powercodex/dataverse.json   (written after each apply)
//
// The schema file declares what tables and columns should exist.
// applySchema() drives the maker portal (via engines.real) to create anything
// that isn't already in the state file, then writes back the captured logical names.
//
// Both files are designed to be committed to source control:
//   dataverse-schema.json  — intent  (what you want)
//   dataverse.json         — outcome (what Dataverse confirmed + logical names)

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEMA_FILE = '.powercodex/dataverse-schema.json';
const STATE_FILE  = '.powercodex/dataverse.json';

// ── Schema file helpers ────────────────────────────────────────────────────────

function schemaPath(root) { return path.join(root, SCHEMA_FILE); }
function statePath(root)  { return path.join(root, STATE_FILE);  }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Read the schema (intent). Returns null if not initialised.
function readSchema(root) {
  return readJson(schemaPath(root));
}

// Read the state (what's been created + logical names). Returns empty structure when absent.
function readState(root) {
  return readJson(statePath(root)) || { tables: [] };
}

// Write the state back to disk.
function writeState(root, state) {
  writeJson(statePath(root), state);
}

// Create a starter schema template so the user / Claude can fill it in.
function initSchema(root, { displayName = 'MyTable', pluralName = 'MyTables' } = {}) {
  const p = schemaPath(root);
  if (fs.existsSync(p)) return { created: false, path: p };
  const template = {
    tables: [
      {
        displayName,
        pluralName,
        primaryColumn: 'Name',
        columns: [
          { displayName: 'Name',   type: 'text',   required: true  },
          { displayName: 'Status', type: 'choice', choices: ['Active', 'Inactive'] },
          { displayName: 'Notes',  type: 'text' },
        ],
      },
    ],
  };
  writeJson(p, template);
  return { created: true, path: p };
}

// ── Apply schema to Dataverse ──────────────────────────────────────────────────

// applySchema drives the real browser engine to create each table and column that
// isn't already recorded in the state file. Emits progress events so the lifecycle
// dashboard (or MCP caller) can display live status.
//
// Options:
//   environmentId  — Power Platform environment GUID (optional; uses default if absent)
//   emit           — async fn({ level, message }) for progress output
//   dryRun         — if true, log what would be done but don't open the browser
//
// Returns: { tables: [{ displayName, logicalName, columns: [...] }], errors: [] }
async function applySchema(root, opts = {}) {
  const { environmentId, emit = async () => {}, dryRun = false } = opts;
  const schema = readSchema(root);
  if (!schema || !Array.isArray(schema.tables) || !schema.tables.length) {
    throw new Error(`No schema found at ${SCHEMA_FILE}. Run: powercodex-lifecycle dataverse init`);
  }

  const state = readState(root);
  const stateByDisplay = new Map((state.tables || []).map((t) => [t.displayName, t]));
  const errors = [];
  const results = [];

  // Load the real engine lazily (only when Playwright is installed).
  let eng = null;
  let context = null;

  async function getContext() {
    if (context) return context;
    if (dryRun) return null;
    const engineUrl = pathToFileURL(path.join(__dirname, '..', 'engine', 'mdm-attach.mjs')).href;
    eng = await import(engineUrl);
    if (!(await eng.isCdpEndpointAvailable())) {
      throw new Error('No managed Edge CDP session found. Run: powercodex-lifecycle profiles use <profile> and open Edge with --remote-debugging-port=9222');
    }
    const { browser } = await eng.attachToEdge();
    context = eng.getAttachedBrowserContext(browser);
    return context;
  }

  for (const tableDef of schema.tables) {
    const existing = stateByDisplay.get(tableDef.displayName);
    let tableLogicalName = existing ? existing.logicalName : null;
    const tableResult = {
      displayName: tableDef.displayName,
      logicalName: tableLogicalName,
      columns: existing ? [...(existing.columns || [])] : [],
    };

    // Create table if not yet in state.
    if (!tableLogicalName) {
      await emit({ level: 'info', message: `Creating table "${tableDef.displayName}"…` });
      if (dryRun) {
        await emit({ level: 'info', message: `[dry-run] would create table "${tableDef.displayName}"` });
        tableResult.logicalName = '(dry-run)';
      } else {
        try {
          const ctx = await getContext();
          const out = await eng.createDataverseTable(ctx, {
            environmentId,
            displayName: tableDef.displayName,
            pluralName: tableDef.pluralName,
            primaryColumn: tableDef.primaryColumn,
          });
          if (out.created) {
            tableLogicalName = out.logicalName;
            tableResult.logicalName = out.logicalName;
            await emit({ level: 'good', message: `Table "${tableDef.displayName}" created · logical name: ${out.logicalName || '(not captured)'}` });
          } else {
            await emit({ level: 'warn', message: `Table "${tableDef.displayName}" not created: ${out.reason}` });
            errors.push({ table: tableDef.displayName, reason: out.reason });
          }
        } catch (e) {
          await emit({ level: 'bad', message: `Table "${tableDef.displayName}" error: ${e.message}` });
          errors.push({ table: tableDef.displayName, reason: e.message });
        }
      }
    } else {
      await emit({ level: 'info', message: `Table "${tableDef.displayName}" already in state (logicalName: ${tableLogicalName}) · skipping create` });
    }

    // Add columns that aren't already in state.
    const existingColsByDisplay = new Map((tableResult.columns || []).map((c) => [c.displayName, c]));
    for (const colDef of (tableDef.columns || [])) {
      if (existingColsByDisplay.has(colDef.displayName)) {
        await emit({ level: 'info', message: `  Column "${colDef.displayName}" already in state · skipping` });
        continue;
      }
      if (!tableLogicalName) {
        await emit({ level: 'warn', message: `  Skipping column "${colDef.displayName}" — parent table logical name unknown` });
        errors.push({ table: tableDef.displayName, column: colDef.displayName, reason: 'table logical name unknown' });
        continue;
      }
      await emit({ level: 'info', message: `  Adding column "${colDef.displayName}" (${colDef.type || 'text'})…` });
      if (dryRun) {
        await emit({ level: 'info', message: `  [dry-run] would add column "${colDef.displayName}"` });
        tableResult.columns.push({ displayName: colDef.displayName, type: colDef.type, logicalName: '(dry-run)' });
      } else {
        try {
          const ctx = await getContext();
          const out = await eng.addDataverseColumn(ctx, {
            environmentId,
            tableLogicalName,
            displayName: colDef.displayName,
            type: colDef.type || 'text',
            choices: colDef.choices || [],
            required: !!colDef.required,
            description: colDef.description || '',
          });
          if (out.created) {
            tableResult.columns.push({
              displayName: colDef.displayName,
              type: colDef.type || 'text',
              logicalName: out.logicalName,
            });
            await emit({ level: 'good', message: `  Column "${colDef.displayName}" created · logical name: ${out.logicalName || '(not captured)'}` });
          } else {
            await emit({ level: 'warn', message: `  Column "${colDef.displayName}" not created: ${out.reason}` });
            errors.push({ table: tableDef.displayName, column: colDef.displayName, reason: out.reason });
          }
        } catch (e) {
          await emit({ level: 'bad', message: `  Column "${colDef.displayName}" error: ${e.message}` });
          errors.push({ table: tableDef.displayName, column: colDef.displayName, reason: e.message });
        }
      }
    }

    results.push(tableResult);
  }

  // Write state after every run so partial progress is never lost.
  writeState(root, { tables: results, appliedAt: new Date().toISOString() });
  await emit({ level: results.length && !errors.length ? 'good' : 'warn',
    message: `Schema apply complete · ${results.length} table(s) · ${errors.length} error(s) · state written to ${STATE_FILE}` });

  return { tables: results, errors };
}

module.exports = { readSchema, readState, writeState, initSchema, applySchema, schemaPath, statePath };
