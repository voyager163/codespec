'use strict';
// mockdata.js — representative sample data for the preview, so data-driven screens
// render with realistic rows WITHOUT a database.
//
// Power Apps Code Apps talk to Dataverse through generated data clients. In preview we
// don't have (and don't want) a live connection, so generated apps read through a small
// data seam (src/data, scaffolded into new projects) that returns this mock data when
// VITE_POWERCODEX_MOCK is set. The rows are generated from the project's declared schema
// (.powercodex/dataverse-schema.json) so they match the real tables/columns/types.
//
// Pure generation is unit-tested; writeMockModule is the thin file-writing wrapper.
const fs = require('node:fs');
const path = require('node:path');

// A representative value for one column + row index, honoring the declared type.
function representativeCell(column, i) {
  const name = String(column.displayName || column.name || 'Field');
  const type = String(column.type || 'text').toLowerCase();
  const n = i + 1;
  if (type === 'choice' || type === 'optionset' || type === 'picklist') {
    const choices = column.choices || column.options || ['Option A', 'Option B', 'Option C'];
    return choices[i % choices.length];
  }
  if (/^(number|int|integer|decimal|float|currency|money)$/.test(type)) return n * 10;
  if (/^(date|datetime|datetimeoffset)$/.test(type)) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)); // deterministic, no Date.now()
    return type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
  }
  if (/^(bool|boolean|yesno|two ?options?)$/.test(type)) return i % 2 === 0;
  if (/^(lookup|reference)$/.test(type)) return `${name}-${n}`;
  // text-ish: bias by column name so screens look real
  if (/e-?mail/i.test(name)) return `user${n}@example.com`;
  if (/phone|tel/i.test(name)) return `555-01${String(n).padStart(2, '0')}`;
  if (/name|title/i.test(name)) return `Sample ${name} ${n}`;
  if (/status|state/i.test(name)) return ['Open', 'In progress', 'Done'][i % 3];
  if (/note|desc/i.test(name)) return `Representative ${name.toLowerCase()} for row ${n}.`;
  return `${name} ${n}`;
}

// A stable key for a table, matching how a data client would name it.
function tableKey(table) {
  return String(table.pluralName || table.logicalName || table.displayName || 'Items')
    .replace(/\s+/g, '');
}

function generateRows(table, rows) {
  const cols = table.columns || [];
  const out = [];
  for (let i = 0; i < rows; i++) {
    const row = { id: `${tableKey(table).toLowerCase()}-${i + 1}` };
    for (const c of cols) row[String(c.displayName || c.name)] = representativeCell(c, i);
    out.push(row);
  }
  return out;
}

// { TableKey: [rows...] } for every table in the schema.
function generate(schema, { rows = 5 } = {}) {
  const tables = (schema && Array.isArray(schema.tables)) ? schema.tables : [];
  const out = {};
  for (const t of tables) out[tableKey(t)] = generateRows(t, rows);
  return out;
}

function readSchema(root) {
  for (const rel of ['.powercodex/dataverse-schema.json', '.powercodex/dataverse.json']) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      if (data && Array.isArray(data.tables) && data.tables.length) return data;
    } catch { /* try next */ }
  }
  return null;
}

function hasDataConvention(root) {
  return fs.existsSync(path.join(root, 'src', 'data', 'index.ts'));
}

// Regenerate src/data/mock.generated.ts from the current schema. No-op (returns false)
// when the project doesn't use the data convention. Safe to call before every preview.
function writeMockModule(root, schema) {
  if (!hasDataConvention(root)) return { written: false, reason: 'no data convention' };
  const s = schema || readSchema(root);
  const tables = generate(s || { tables: [] });
  const body =
    '// AUTO-GENERATED for preview by PowerCodex (mockdata.js). Do not edit by hand.\n' +
    '// Representative rows so data screens render without a live Dataverse connection.\n' +
    'export const mockTables: Record<string, Array<Record<string, unknown>>> = ' +
    JSON.stringify(tables, null, 2) + ';\n';
  const file = path.join(root, 'src', 'data', 'mock.generated.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return { written: true, tables: Object.keys(tables).length, file };
}

module.exports = { representativeCell, tableKey, generateRows, generate, readSchema, hasDataConvention, writeMockModule };
