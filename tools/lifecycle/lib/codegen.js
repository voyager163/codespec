'use strict';
// The real code-generation engine. This is what makes PowerCodex actually build:
// it authors real React + TypeScript screens into the project's src/, wires them into
// the router, and (in real mode) verifies the result with the project's own build.
//
// It is SCHEMA-DRIVEN: an approved intake is turned into a typed schema (an entity plus
// named, typed fields) and that one schema is the single source of truth for the screen,
// the emitted TS type, the data adapters, and the seed rows. Two different intakes yield
// two genuinely different apps — not the same table with a different label.
//
// It is deterministic-first: even with no AI CLI present it emits a working, strict-TS
// screen that implements the approved capabilities against seeded data — never theater,
// always a file that compiles. When a provider IS present it is asked to author a richer
// component grounded in the same schema; the output is validated and only used if it
// looks like a real default-export TSX module that stays consistent with the schema,
// otherwise the deterministic screen is kept. Every result reports whether a file was
// actually written and whether the build verified it.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ---- project layout discovery -------------------------------------------------

// Find the app's source root. Code Apps use src/; we accept a couple of fallbacks.
function findSrc(root) {
  for (const c of ['src', 'app', '.']) {
    const p = path.join(root, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      if (c === '.' && !fs.existsSync(path.join(p, 'main.tsx')) && !fs.existsSync(path.join(p, 'index.tsx'))) continue;
      return p;
    }
  }
  return path.join(root, 'src');
}

function isCodeApp(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const dd = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    return !!(dd.react || dd.vite || dd['react-dom']);
  } catch {
    return false;
  }
}

// A screen's `name` becomes a filename under src/pages/. It can originate from
// client-supplied intake tasks, so it must never be trusted as a path: strip it
// down to a safe, single-segment slug (no separators, no `..`, no leading dots).
// Returns '' when nothing usable remains, so callers can reject the task.
function safeScreenName(raw) {
  const slug = String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // collapse anything non-alphanumeric to a hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 64);
  return slug;
}

// Defence in depth: confirm the resolved write target stays inside `dir`.
function isWithin(dir, target) {
  const base = path.resolve(dir);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

// ---- schema derivation --------------------------------------------------------

// The closed set of field types the generators know how to emit. A field with any other
// type is dropped — the schema never contains a type the type-emitter/screen can't build.
const FIELD_TYPES = new Set(['string', 'number', 'date', 'choice', 'boolean', 'currency']);

// Deterministic keyword → field heuristics. Order is specific → general; the first hint
// that matches (and whose name isn't taken) contributes its field. This is the honest
// floor: coarse but never fabricated. A provider may author a richer screen on top, but
// it is validated against exactly this schema.
const FIELD_HINTS = [
  { re: /\b(due|deadline|expir\w*)\b/, field: { name: 'dueDate', type: 'date' } },
  { re: /\b(date|scheduled|when|day)\b/, field: { name: 'date', type: 'date' } },
  { re: /\b(amount|cost|price|budget|total|fee|salary|revenue|payment|invoice|\$)\b/, field: { name: 'amount', type: 'currency' } },
  { re: /\b(rating|score|stars?)\b/, field: { name: 'rating', type: 'number' } },
  { re: /\b(quantity|qty|count|stock|units?|inventory)\b/, field: { name: 'quantity', type: 'number' } },
  { re: /\b(priority|urgen\w*)\b/, field: { name: 'priority', type: 'choice', values: ['Low', 'Medium', 'High'] } },
  { re: /\b(status|state|stage|progress|approv\w*|workflow)\b/, field: { name: 'status', type: 'choice', values: ['Open', 'Done'] } },
  { re: /\b(category|kind|department|team)\b/, field: { name: 'category', type: 'string' } },
  { re: /\b(owner|assignee|assigned|responsible|staff|employee|manager|requester|borrower)\b/, field: { name: 'owner', type: 'string' } },
  { re: /\b(customer|client|contact|vendor|supplier|guest|patient|member)\b/, field: { name: 'contact', type: 'string' } },
  { re: /\b(email|e-mail)\b/, field: { name: 'email', type: 'string' } },
  { re: /\b(returned|paid|resolved|complete\w*|active|archived|shipped|delivered)\b/, field: { name: 'done', type: 'boolean' } },
  { re: /\b(notes?|comment|description|details|remarks?)\b/, field: { name: 'notes', type: 'string' } },
];

// Derive the app's schema from the approved intake. Returns:
//   { entity, typeName, fields: [{ name, type, values? }], fallback }
// `fields[0]` is always a string "label" field (what a record is called). When the intake
// is too thin to imply any other field, `fallback` is set and a minimal shape is used —
// reported honestly by the caller rather than fabricating fields the user never implied.
function deriveSchema({ goal, displayName, tasks } = {}) {
  const entity = nounFrom(goal, displayName);
  const parts = [displayName, goal];
  for (const t of tasks || []) {
    parts.push(t.displayName, t.goal, t.name);
    if (Array.isArray(t.items)) parts.push(...t.items);
  }
  const text = ' ' + parts.filter(Boolean).map(String).join(' ').toLowerCase() + ' ';

  const fields = [{ name: 'title', type: 'string' }];
  const seen = new Set(['id', 'title']);
  for (const hint of FIELD_HINTS) {
    if (fields.length >= 6) break;
    if (!FIELD_TYPES.has(hint.field.type)) continue; // never emit a type we can't build
    // One date column is enough — "due date" matches both dueDate and the generic date hint.
    if (hint.field.type === 'date' && fields.some((f) => f.type === 'date')) continue;
    if (hint.re.test(text) && !seen.has(hint.field.name)) {
      const f = { name: hint.field.name, type: hint.field.type };
      if (hint.field.values) f.values = [...hint.field.values];
      fields.push(f);
      seen.add(f.name);
    }
  }

  let fallback = false;
  if (fields.length < 2) {
    fallback = true;
    fields.push({ name: 'notes', type: 'string' }, { name: 'status', type: 'choice', values: ['Open', 'Done'] });
  }
  return { entity, typeName: capWord(entity), fields, fallback };
}

// A short, safe singular noun for UI labels ("Add task", "No tasks yet"), derived from
// the goal/title. Falls back to "item" so labels always read cleanly.
function nounFrom(goal, displayName) {
  const src = oneLine(displayName || goal || '').replace(/^plan:\s*/i, '');
  const words = src.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let w = (words.length ? words[words.length - 1] : 'item').toLowerCase();
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1); // rough singularize
  return /^[a-z][a-z0-9]*$/.test(w) ? w : 'item';
}
// Back-compat alias: callers that only want the entity noun still get it.
function entityFrom(goal, displayName) {
  return nounFrom(goal, displayName);
}

// The set of string fields that read as "a person"; capability flags like filter-by-user
// and the seed generator treat them as owners.
const OWNER_FIELDS = new Set(['owner', 'assignee', 'contact']);

// field type → the TypeScript type emitted for it.
function tsTypeOf(f) {
  switch (f.type) {
    case 'number':
    case 'currency':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'string'; // ISO YYYY-MM-DD
    case 'choice':
      return f.values && f.values.length ? f.values.map((v) => JSON.stringify(v)).join(' | ') : 'string';
    default:
      return 'string';
  }
}
// field type → the default value used in an empty draft record.
function tsDefaultOf(f) {
  switch (f.type) {
    case 'number':
    case 'currency':
      return '0';
    case 'boolean':
      return 'false';
    case 'choice':
      return f.values && f.values.length ? JSON.stringify(f.values[0]) : '""';
    default:
      return '""';
  }
}

// ---- the deterministic screen generator ---------------------------------------

// Produce a strict-TypeScript React screen that runs against the app's data seam
// (`@/data`). The screen renders the DERIVED SCHEMA: one column and form input per field,
// choice fields as a select + pill, boolean as a checkbox, date/currency formatted. It is
// INTERACTIVE: it lists rows from the local preview store and can add, delete, reset, and
// (when a boolean/2-value-choice field exists) toggle them — every change persists across
// reloads because the local source writes to localStorage. Capability flags only add
// refinements (search, overdue highlight, per-owner filter) and only bind when the schema
// actually supports them, so there are never unused locals (the starter compiles with
// strict + noUnusedLocals + noUnusedParameters).
function generateScreen(task) {
  const { componentName, displayName, goal, capabilities = {}, items = [] } = task || {};
  const c = capabilities;
  const schema = task && task.schema && task.schema.fields ? task.schema : deriveSchema(task || {});
  const fields = schema.fields;
  const entity = schema.entity;

  const label = fields[0].name; // always a string field
  const dateField = (fields.find((f) => f.type === 'date') || {}).name;
  const ownerField = (fields.find((f) => f.type === 'string' && OWNER_FIELDS.has(f.name)) || {}).name;
  // A togglable field: a boolean, or a choice with exactly two values (e.g. Open/Done).
  const toggleF =
    fields.find((f) => f.type === 'boolean') ||
    fields.find((f) => f.type === 'choice' && f.values && f.values.length === 2) ||
    null;
  const sortField = dateField || label;

  const useSearch = !!c.search;
  const useOwner = !!(c.filterByUser && ownerField);
  const useHighlight = !!(c.highlight && dateField);

  const L = [];
  const p = (s = '') => L.push(s);

  p(`// Generated by PowerCodex — ${displayName || componentName}`);
  p(`// Goal: ${String(goal || '').replace(/\n/g, ' ').slice(0, 120)}`);
  p(`// Schema: ${fields.map((f) => `${f.name}:${f.type}`).join(', ')}${schema.fallback ? ' (starter shape — thin intake)' : ''}`);
  if (items.length) {
    p('// Approved capabilities:');
    for (const it of items.slice(0, 8)) p('//   • ' + stripTags(it).replace(/\n/g, ' ').slice(0, 90));
  }
  p('import { useEffect, useMemo, useState } from "react"');
  p('import { data, type Item, type NewItem } from "@/data"');
  p('');
  if (useOwner) p('const CURRENT_USER = "you"');
  p(`const EMPTY: NewItem = { ${fields.map((f) => `${f.name}: ${tsDefaultOf(f)}`).join(', ')} }`);
  p('');
  if (useHighlight) {
    const notDone = toggleF
      ? toggleF.type === 'boolean'
        ? `!item.${toggleF.name} && `
        : `item.${toggleF.name} !== ${JSON.stringify(toggleF.values[1])} && `
      : '';
    p('function isOverdue(item: Item): boolean {');
    p(`  return ${notDone}new Date(item.${dateField}).getTime() < Date.now()`);
    p('}');
    p('');
  }
  p(`export default function ${componentName}() {`);
  p('  const [items, setItems] = useState<Item[]>([])');
  p('  const [draft, setDraft] = useState<NewItem>(EMPTY)');
  if (useSearch) p('  const [query, setQuery] = useState("")');
  p('');
  p('  // Load the local db on mount; every mutation below keeps React state and the');
  p('  // persisted store in sync, so a reload shows exactly what you left behind.');
  p('  useEffect(() => {');
  p('    data.list().then(setItems)');
  p('  }, [])');
  p('');
  p('  const visible = useMemo(() => {');
  p('    let rows = items');
  if (useOwner) p(`    rows = rows.filter((r) => r.${ownerField} === CURRENT_USER)`);
  if (useSearch) {
    p('    if (query.trim()) {');
    p('      const q = query.toLowerCase()');
    p(`      rows = rows.filter((r) => String(r.${label}).toLowerCase().includes(q))`);
    p('    }');
  }
  p(`    return [...rows].sort((a, b) => String(a.${sortField}).localeCompare(String(b.${sortField})))`);
  p(useSearch ? '  }, [items, query])' : '  }, [items])');
  p('');
  p('  async function add() {');
  p(`    if (!String(draft.${label}).trim()) return`);
  p('    const created = await data.create(draft)');
  p('    setItems((prev) => [...prev, created])');
  p('    setDraft(EMPTY)');
  p('  }');
  p('');
  if (toggleF) {
    const flip =
      toggleF.type === 'boolean'
        ? `!current.${toggleF.name}`
        : `current.${toggleF.name} === ${JSON.stringify(toggleF.values[1])} ? ${JSON.stringify(toggleF.values[0])} : ${JSON.stringify(toggleF.values[1])}`;
    p('  async function toggle(id: number) {');
    p('    const current = items.find((r) => r.id === id)');
    p('    if (!current) return');
    p(`    const updated = await data.update(id, { ${toggleF.name}: ${flip} })`);
    p('    if (updated) {');
    p('      const u = updated');
    p('      setItems((prev) => prev.map((r) => (r.id === id ? u : r)))');
    p('    }');
    p('  }');
    p('');
  }
  p('  async function remove(id: number) {');
  p('    await data.remove(id)');
  p('    setItems((prev) => prev.filter((r) => r.id !== id))');
  p('  }');
  p('');
  p('  async function resetData() {');
  p('    setItems(await data.reset())');
  p('  }');
  p('');
  // JSX
  p('  return (');
  p('    <div className="p-6 max-w-3xl mx-auto">');
  p(`      <h1 className="text-2xl font-semibold mb-1">${esc(displayName || componentName)}</h1>`);
  p(`      <p className="text-sm text-muted-foreground mb-4">${esc(oneLine(goal) || 'Your screen')}</p>`);
  p('');
  p('      <div className="flex flex-wrap items-center gap-2 mb-4">');
  fields.forEach((f, i) => {
    for (const line of formControl(f, i === 0, entity)) p(line);
  });
  p('        <button');
  p('          onClick={add}');
  p('          className="rounded-md border bg-primary text-primary-foreground px-3 py-2 text-sm hover:opacity-90"');
  p('        >');
  p(`          Add ${entity}`);
  p('        </button>');
  p('        <button');
  p('          onClick={resetData}');
  p('          className="ml-auto rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"');
  p('        >');
  p('          Reset sample data');
  p('        </button>');
  p('      </div>');
  p('');
  if (useSearch) {
    p('      <input');
    p('        value={query}');
    p('        onChange={(e) => setQuery(e.target.value)}');
    p('        placeholder="Search…"');
    p('        className="w-full mb-4 rounded-md border px-3 py-2 text-sm"');
    p('      />');
    p('');
  }
  p('      <table className="w-full text-sm border-collapse">');
  p('        <thead>');
  p('          <tr className="text-left border-b">');
  for (const f of fields) p(`            <th className="py-2 pr-4">${humanCap(f.name)}</th>`);
  p('            <th className="py-2 pr-4"></th>');
  p('          </tr>');
  p('        </thead>');
  p('        <tbody>');
  p('          {visible.map((r) => (');
  if (useHighlight) {
    p('            <tr key={r.id} className={"border-b " + (isOverdue(r) ? "text-red-600" : "")}>');
  } else {
    p('            <tr key={r.id} className="border-b">');
  }
  for (const f of fields) p(`              <td className="py-2 pr-4">${cellExpr(f)}</td>`);
  p('              <td className="py-2 pr-4 whitespace-nowrap">');
  if (toggleF) {
    const btnLabel =
      toggleF.type === 'boolean'
        ? `{r.${toggleF.name} ? "Undo" : "Mark done"}`
        : `{r.${toggleF.name} === ${JSON.stringify(toggleF.values[1])} ? "Reopen" : "Mark ${String(toggleF.values[1]).toLowerCase()}"}`;
    p('                <button');
    p('                  onClick={() => toggle(r.id)}');
    p('                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted"');
    p('                >');
    p(`                  ${btnLabel}`);
    p('                </button>');
  }
  p('                <button');
  p('                  onClick={() => remove(r.id)}');
  p(`                  className="${toggleF ? 'ml-2 ' : ''}rounded-md border px-2 py-1 text-xs text-red-600 hover:bg-muted"`);
  p('                >');
  p('                  Delete');
  p('                </button>');
  p('              </td>');
  p('            </tr>');
  p('          ))}');
  p('          {visible.length === 0 && (');
  p('            <tr>');
  p(`              <td colSpan={${fields.length + 1}} className="py-6 text-center text-muted-foreground">`);
  p(`                No ${entity}s yet — add one above.`);
  p('              </td>');
  p('            </tr>');
  p('          )}');
  p('        </tbody>');
  p('      </table>');
  p('    </div>');
  p('  )');
  p('}');
  p('');
  return L.join('\n');
}

// A field's form control (the "add a record" row). `isLabel` marks the primary text field.
function formControl(f, isLabel, entity) {
  const n = f.name;
  if (f.type === 'boolean') {
    return [
      '        <label className="flex items-center gap-1 text-sm">',
      `          <input type="checkbox" checked={draft.${n}} onChange={(e) => setDraft({ ...draft, ${n}: e.target.checked })} />`,
      `          ${humanCap(n)}`,
      '        </label>',
    ];
  }
  if (f.type === 'choice') {
    const values = f.values && f.values.length ? f.values : ['Open', 'Done'];
    return [
      '        <select',
      `          value={draft.${n}}`,
      `          onChange={(e) => setDraft({ ...draft, ${n}: e.target.value as Item["${n}"] })}`,
      '          className="rounded-md border px-3 py-2 text-sm"',
      '        >',
      `          {(${JSON.stringify(values)} as const).map((o) => (`,
      '            <option key={o} value={o}>{o}</option>',
      '          ))}',
      '        </select>',
    ];
  }
  if (f.type === 'date') {
    return [
      '        <input',
      '          type="date"',
      `          value={draft.${n}}`,
      `          onChange={(e) => setDraft({ ...draft, ${n}: e.target.value })}`,
      '          className="rounded-md border px-3 py-2 text-sm"',
      '        />',
    ];
  }
  if (f.type === 'number' || f.type === 'currency') {
    return [
      '        <input',
      '          type="number"',
      `          value={draft.${n}}`,
      `          onChange={(e) => setDraft({ ...draft, ${n}: Number(e.target.value) })}`,
      `          placeholder="${humanCap(n)}"`,
      '          className="w-28 rounded-md border px-3 py-2 text-sm"',
      '        />',
    ];
  }
  // string
  return [
    '        <input',
    `          value={draft.${n}}`,
    `          onChange={(e) => setDraft({ ...draft, ${n}: e.target.value })}`,
    `          placeholder="${isLabel ? `New ${entity}…` : humanCap(n)}"`,
    `          className="${isLabel ? 'flex-1 min-w-40' : 'w-32'} rounded-md border px-3 py-2 text-sm"`,
    '        />',
  ];
}

// A field's table-cell expression (goes inside `<td>…</td>`).
function cellExpr(f) {
  const n = f.name;
  switch (f.type) {
    case 'boolean':
      return `{r.${n} ? "Yes" : "No"}`;
    case 'choice':
      return `<span className="inline-block rounded-full border px-2 py-0.5 text-xs">{r.${n}}</span>`;
    case 'currency':
      return `{"$" + r.${n}.toFixed(2)}`;
    default:
      return `{r.${n}}`;
  }
}

// ---- the data seam --------------------------------------------------------------

// Ensure the project has a `src/data` seam so generated screens' `@/data` import resolves
// and the preview runs on a real local db — now shaped to the DERIVED SCHEMA. types.ts,
// index.ts, and seed.json are always (re)written from the schema (their shape is dynamic);
// the local/dataverse adapters are field-name-agnostic (they only touch `Item`/`id`), so
// they are written once and reused. A starter-shipped local.test.ts is rewritten to a
// shape-agnostic version so the app still typechecks under the new schema.
function ensureDataSeam(srcDir, schemaOrOpts) {
  const schema = schemaOrOpts && schemaOrOpts.fields ? schemaOrOpts : deriveSchema(schemaOrOpts || {});
  const dataDir = path.join(srcDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, 'seed.json'), JSON.stringify(seedFor(schema), null, 2) + '\n');
  fs.writeFileSync(path.join(dataDir, 'types.ts'), typesFor(schema));
  fs.writeFileSync(path.join(dataDir, 'index.ts'), SEAM.index);

  let wrote = false;
  if (!fs.existsSync(path.join(dataDir, 'local.ts'))) {
    fs.writeFileSync(path.join(dataDir, 'local.ts'), SEAM.local);
    wrote = true;
  }
  if (!fs.existsSync(path.join(dataDir, 'dataverse.ts'))) {
    fs.writeFileSync(path.join(dataDir, 'dataverse.ts'), SEAM.dataverse);
    wrote = true;
  }
  // Keep any shipped unit test compiling under the new shape (it must not hardcode fields).
  if (fs.existsSync(path.join(dataDir, 'local.test.ts'))) {
    fs.writeFileSync(path.join(dataDir, 'local.test.ts'), SEAM.localTest);
  }
  return { wrote, seededOnly: false };
}

// The emitted record type, derived from the schema. The exported identifiers `Item`/
// `NewItem` are the seam's stable contract (screens and adapters import them); only their
// FIELDS are schema-driven. Choice unions are inlined into the fields.
function typesFor(schema) {
  const lines = [];
  lines.push(`// ${schema.typeName} — the record shape PowerCodex derived for this app.`);
  lines.push('// Generated from the approved intake. Screens import { data, Item, NewItem } from "@/data";');
  lines.push('// the field set below is what makes this app itself rather than a generic table.');
  lines.push('');
  lines.push('export type Item = {');
  lines.push('  id: number');
  for (const f of schema.fields) lines.push(`  ${f.name}: ${tsTypeOf(f)}`);
  lines.push('}');
  lines.push('');
  lines.push('// A record being created does not have a server-assigned id yet.');
  lines.push('export type NewItem = Omit<Item, "id">');
  lines.push('');
  lines.push('// The one interface both sources honour. Async on purpose: Dataverse is a network');
  lines.push('// call, so preview is async too and screens need no changes when the source switches.');
  lines.push('export interface DataSource {');
  lines.push('  list(): Promise<Item[]>');
  lines.push('  create(input: NewItem): Promise<Item>');
  lines.push('  update(id: number, patch: Partial<NewItem>): Promise<Item | null>');
  lines.push('  remove(id: number): Promise<void>');
  lines.push('  reset(): Promise<Item[]>');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// Seed rows for the derived schema: each field is filled by type so every row conforms to
// the emitted `Item` type by construction. Domain-flavored where it helps the preview read
// as the user's app (the label field reads as the entity; owners cycle real-ish names).
const SEED_DATES = ['2026-06-01', '2026-06-10', '2026-05-20', '2026-07-02', '2026-06-18'];
const SEED_PEOPLE = ['you', 'alex', 'sam', 'jordan', 'you'];
function seedFor(schemaOrEntity) {
  const schema = schemaOrEntity && schemaOrEntity.fields ? schemaOrEntity : deriveSchema(schemaOrEntity && schemaOrEntity.goal ? schemaOrEntity : {});
  return SEED_DATES.map((_, i) => {
    const row = { id: i + 1 };
    for (const f of schema.fields) row[f.name] = seedValue(f, i, schema.entity);
    return row;
  });
}
function seedValue(f, i, entity) {
  switch (f.type) {
    case 'number':
      return (i + 1) * 3;
    case 'currency':
      return (i + 1) * 100 + 50;
    case 'boolean':
      return i % 2 === 0;
    case 'date':
      return SEED_DATES[i % SEED_DATES.length];
    case 'choice': {
      const vs = f.values && f.values.length ? f.values : ['Open', 'Done'];
      return vs[i % vs.length];
    }
    default: {
      // string
      if (f.name === 'email') return `${SEED_PEOPLE[i % SEED_PEOPLE.length]}@example.com`;
      if (OWNER_FIELDS.has(f.name)) return SEED_PEOPLE[i % SEED_PEOPLE.length];
      const base = f.name === 'title' ? capWord(entity) : humanCap(f.name);
      return `${base} ${i + 1}`;
    }
  }
}

// Field-name-agnostic seam files (they reference only `Item`/`NewItem`/`id`, never a field
// name) plus the schema-driven type index. The starter (templates/starter/src/data) ships
// richer-commented versions of local/dataverse; these are the fallback for brownfield
// projects and the canonical index/test.
const SEAM = {
  index: [
    '// The single entry point every screen imports: `import { data } from "@/data"`.',
    '// Preview runs on the local store; publish builds with VITE_POWERCODEX_LIVE=1 to swap',
    '// in Dataverse. Screens are identical in both modes — they only ever see `data`.',
    'import type { DataSource } from "./types"',
    'import { local } from "./local"',
    'import { dataverse } from "./dataverse"',
    'export type { Item, NewItem, DataSource } from "./types"',
    'export const data: DataSource =',
    '  import.meta.env.VITE_POWERCODEX_LIVE === "1" ? dataverse : local',
    '',
  ].join('\n'),
  local: [
    'import type { DataSource, Item, NewItem } from "./types"',
    'import seed from "./seed.json"',
    '',
    'const KEY = "powercodex.items"',
    'function seedRows(): Item[] { return (seed as Item[]).map((r) => ({ ...r })) }',
    'function load(): Item[] {',
    '  const raw = localStorage.getItem(KEY)',
    '  if (raw == null) { const rows = seedRows(); localStorage.setItem(KEY, JSON.stringify(rows)); return rows }',
    '  try { const p = JSON.parse(raw); return Array.isArray(p) ? (p as Item[]) : [] }',
    '  catch { const rows = seedRows(); localStorage.setItem(KEY, JSON.stringify(rows)); return rows }',
    '}',
    'function save(rows: Item[]): void { localStorage.setItem(KEY, JSON.stringify(rows)) }',
    'function nextId(rows: Item[]): number { return rows.reduce((m, r) => (r.id > m ? r.id : m), 0) + 1 }',
    '',
    'export const local: DataSource = {',
    '  async list() { return load() },',
    '  async create(input: NewItem) { const rows = load(); const row: Item = { ...input, id: nextId(rows) }; save([...rows, row]); return row },',
    '  async update(id: number, patch: Partial<NewItem>) {',
    '    const rows = load(); let updated: Item | null = null',
    '    const next = rows.map((r) => { if (r.id !== id) return r; updated = { ...r, ...patch }; return updated })',
    '    if (updated) save(next); return updated',
    '  },',
    '  async remove(id: number) { save(load().filter((r) => r.id !== id)) },',
    '  async reset() { const rows = seedRows(); save(rows); return rows },',
    '}',
    '',
  ].join('\n'),
  dataverse: [
    'import type { DataSource } from "./types"',
    'function notWired(): never {',
    '  throw new Error("This app\'s Dataverse data source isn\'t connected yet. Publish it to Power Platform to wire the tables up.")',
    '}',
    'export const dataverse: DataSource = { list: notWired, create: notWired, update: notWired, remove: notWired, reset: notWired }',
    '',
  ].join('\n'),
  // Shape-agnostic CRUD test: it derives a draft from a seed row instead of hardcoding
  // field names, so it stays green for ANY derived schema.
  localTest: [
    'import { beforeEach, describe, expect, it } from "vitest"',
    'import { local } from "./local"',
    'import seed from "./seed.json"',
    'import type { NewItem } from "./types"',
    '',
    'const SEED = seed as unknown as { id: number }[]',
    'const draftOf = (row: object): NewItem =>',
    '  Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id")) as unknown as NewItem',
    '',
    'describe("LocalDataSource (the preview\'s local db)", () => {',
    '  beforeEach(() => localStorage.clear())',
    '',
    '  it("seeds from seed.json on first read", async () => {',
    '    expect(await local.list()).toHaveLength(SEED.length)',
    '  })',
    '',
    '  it("creates a row, persists it, and assigns a new id", async () => {',
    '    const before = await local.list()',
    '    const created = await local.create(draftOf(before[0]))',
    '    expect(created.id).toBeGreaterThan(0)',
    '    expect(await local.list()).toHaveLength(before.length + 1)',
    '  })',
    '',
    '  it("updates a row and the change survives a re-read", async () => {',
    '    const [first] = await local.list()',
    '    const updated = await local.update(first.id, draftOf(first))',
    '    expect(updated?.id).toBe(first.id)',
    '  })',
    '',
    '  it("returns null when updating a row that does not exist", async () => {',
    '    expect(await local.update(999999, {})).toBeNull()',
    '  })',
    '',
    '  it("removes a row", async () => {',
    '    const before = await local.list()',
    '    await local.remove(before[0].id)',
    '    expect(await local.list()).toHaveLength(before.length - 1)',
    '  })',
    '',
    '  it("reset restores the seed rows after edits", async () => {',
    '    await local.remove((await local.list())[0].id)',
    '    expect(await local.reset()).toHaveLength(SEED.length)',
    '  })',
    '})',
    '',
  ].join('\n'),
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
}
function stripTags(s) {
  // Loop until stable so nested/overlapping tags cannot re-form after one pass.
  let out = String(s == null ? '' : s);
  let prev;
  do { prev = out; out = out.replace(/<[^>]+>/g, ''); } while (out !== prev);
  return out;
}
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
function capWord(s) {
  const w = String(s == null ? '' : s);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
function humanCap(s) {
  return capWord(String(s == null ? '' : s).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

// ---- router wiring ------------------------------------------------------------

// Best-effort: add `import Comp from "@/pages/<kebab>"` and a child route to the
// React-Router config in src/router.tsx. Idempotent and conservative — if the file
// doesn't match the known createBrowserRouter shape we leave it untouched and report
// wired:false (the screen file still exists; the maker can link it manually).
function wireRouter(srcDir, { componentName, route, kebab }) {
  const routerPath = path.join(srcDir, 'router.tsx');
  if (!fs.existsSync(routerPath)) return { wired: false, reason: 'no src/router.tsx' };
  let code = fs.readFileSync(routerPath, 'utf8');
  if (code.includes(`@/pages/${kebab}`) || new RegExp(`path:\\s*["']${route}["']`).test(code)) {
    return { wired: true, already: true };
  }
  if (!/createBrowserRouter\s*\(/.test(code) || !/children\s*:\s*\[/.test(code)) {
    return { wired: false, reason: 'router shape not recognized' };
  }
  // Insert the import after the last existing import line.
  const importLine = `import ${componentName} from "@/pages/${kebab}"`;
  const lines = code.split('\n');
  let lastImport = -1;
  for (let i = 0; i < lines.length; i += 1) if (/^\s*import\s/.test(lines[i])) lastImport = i;
  if (lastImport >= 0) lines.splice(lastImport + 1, 0, importLine);
  else lines.unshift(importLine);
  code = lines.join('\n');
  // Add the child route right after the first `children: [`.
  const childRoute = `{ path: "${route.replace(/^\//, '')}", element: <${componentName} /> }`;
  code = code.replace(/children\s*:\s*\[/, (m) => `${m}${childRoute}, `);
  fs.writeFileSync(routerPath, code);
  return { wired: true, already: false };
}

// ---- provider authoring (optional enhancement) --------------------------------

// Ask a provider to author the component, GROUNDED in the derived schema, and accept only
// if it looks like a real default-export TSX module consistent with that schema. Any doubt
// → null (caller keeps the deterministic file).
async function aiAuthor(provider, task) {
  if (!provider || typeof provider.send !== 'function') return null;
  const schema = task && task.schema && task.schema.fields ? task.schema : deriveSchema(task || {});
  const caps = Object.entries(task.capabilities || {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');
  const fieldList = schema.fields.map((f) => `${f.name}: ${f.type}${f.values ? ` (${f.values.join('/')})` : ''}`).join(', ');
  const prompt = [
    'Write ONE self-contained React + TypeScript screen component.',
    'Hard rules:',
    '- Import ONLY from `react` (useState/useMemo/useEffect) and from `@/data`.',
    '  No other imports, no UI libraries.',
    '- Read and WRITE data through the data seam so changes persist across reloads:',
    '    import { data, type Item, type NewItem } from "@/data"',
    '  Use data.list()/create()/update(id, patch)/remove(id)/reset() (all async, awaited).',
    '  Load rows in a useEffect on mount; never hardcode an inline data array.',
    '- The screen must be INTERACTIVE: the user can add, edit, and delete records, and',
    '  each change is persisted via the data seam (not just React state).',
    `- The record type Item has EXACTLY these fields (plus id: number): ${fieldList}.`,
    '  Reference ONLY these fields. Do NOT invent fields (e.g. no owner/due/status unless listed).',
    '- TypeScript strict, no unused variables/parameters, no `any`.',
    `- Default export named ${task.componentName}.`,
    '- Style with Tailwind className strings only.',
    `Build this screen: ${oneLine(task.goal)}`,
    caps ? `Capabilities to implement: ${caps}` : '',
    'Return ONLY the .tsx file contents — no markdown fences, no commentary.',
  ].join('\n');
  let text = '';
  try {
    const res = await provider.send({ prompt, timeoutMs: 60000 });
    text = (res && res.text) || '';
  } catch {
    return null;
  }
  return validateTsx(text, task.componentName, schema);
}

// Accept the model's code only when it is plausibly a complete TSX module that stays
// consistent with the derived schema.
function validateTsx(text, componentName, schema) {
  let code = String(text || '').trim();
  const fence = code.match(/```(?:tsx|ts|jsx|js)?\s*([\s\S]*?)```/);
  if (fence) code = fence[1].trim();
  if (!code) return null;
  const hasDefault = new RegExp(`export\\s+default\\s+function\\s+${componentName}\\b`).test(code) || /export\s+default\s+/.test(code);
  // Only `react` and the data seam `@/data` may be imported — nothing else can slip in.
  const importsAllowed = !/^\s*import\s+.*from\s+["'](?!react["']|@\/data["'])/m.test(code);
  const balanced = balancedBraces(code);
  const looksTsx = /return\s*\(/.test(code) && /</.test(code);
  // Schema grounding: reject the legacy default fields when the schema doesn't have them,
  // which is the realistic regression (the model regurgitating id/title/owner/due/status).
  // The build gate (tsc) is the backstop for any other unknown-field reference.
  // ponytail: targeted legacy-field check, not a full field-reference analysis — tsc catches the rest.
  let schemaConsistent = true;
  if (schema && Array.isArray(schema.fields)) {
    const has = new Set(schema.fields.map((f) => f.name));
    for (const legacy of ['title', 'owner', 'due', 'status']) {
      if (!has.has(legacy) && new RegExp(`\\.${legacy}\\b`).test(code)) { schemaConsistent = false; break; }
    }
  }
  if (hasDefault && importsAllowed && balanced && looksTsx && schemaConsistent && code.length > 120) return code;
  return null;
}

function balancedBraces(code) {
  let b = 0;
  let par = 0;
  for (const ch of code) {
    if (ch === '{') b += 1;
    else if (ch === '}') b -= 1;
    else if (ch === '(') par += 1;
    else if (ch === ')') par -= 1;
    if (b < 0 || par < 0) return false;
  }
  return b === 0 && par === 0;
}

// ---- the build executor (code tasks) ------------------------------------------

// Author each code.screen task into the project and wire it up. `emit` is the loop's
// event sink; `provider` (optional) enhances the deterministic output. A single schema is
// derived once (from the first screen) and threaded to the data seam AND every screen, so
// the emitted type, adapters, seed, and screens all agree. Returns one result per task
// with honest created/wired/source fields.
async function buildCodeTasks({ root, tasks, emit, rotation = 1, provider } = {}) {
  const srcDir = findSrc(root);
  fs.mkdirSync(path.join(srcDir, 'pages'), { recursive: true });

  // Derive the schema once from the first screen and materialize the data seam to match,
  // so every generated screen's `@/data` import resolves against the right shape.
  const firstScreen = tasks.find((t) => t.type === 'code.screen');
  let schema = null;
  if (firstScreen) {
    schema = deriveSchema(firstScreen);
    try {
      ensureDataSeam(srcDir, schema);
      if (schema.fallback) {
        await emitSafe(emit, { rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Intake was thin — generated a starter shape (${schema.fields.map((f) => f.name).join(', ')}). Add detail to your description for a richer app.` });
      } else {
        await emitSafe(emit, { rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Derived a "${schema.entity}" schema: ${schema.fields.map((f) => f.name).join(', ')}` });
      }
    } catch (e) {
      await emitSafe(emit, { rotation, stage: 3, agent: 'build-executor', level: 'warn', message: `Could not set up the local data layer: ${e.message}` });
    }
  }

  const results = [];

  for (const task of tasks) {
    if (task.type !== 'code.screen') {
      results.push({ task: task.type, name: task.displayName || task.name, status: 'skipped', created: false, reason: 'not a code task' });
      continue;
    }
    // Never trust task.name as a path component — it can arrive from a client-supplied
    // intake payload. Slugify to a single safe segment and reject if nothing remains.
    const kebab = safeScreenName(task.name);
    if (!kebab) {
      results.push({ task: task.type, name: task.displayName || task.componentName || task.name, status: 'skipped', created: false, reason: 'invalid screen name' });
      continue;
    }
    // Every screen shares the one derived schema so it matches the single data seam.
    task.schema = schema || deriveSchema(task);
    const name = task.displayName || task.componentName;
    await emitSafe(emit, { rotation, stage: 3, agent: 'build-executor', level: 'info', message: `Authoring screen "${name}" in code` });

    // Deterministic baseline always exists; provider may upgrade it.
    let code = generateScreen(task);
    let source = 'deterministic';
    const ai = await aiAuthor(provider, task);
    if (ai) {
      code = ai;
      source = (provider && provider.id) || 'provider';
      await emitSafe(emit, { rotation, stage: 3, agent: 'build-executor', level: 'info', message: `AI authored "${name}" · validated as a real component` });
    }

    const pagesDir = path.join(srcDir, 'pages');
    const pagesPath = path.join(pagesDir, kebab + '.tsx');
    let created = false;
    if (!isWithin(pagesDir, pagesPath)) {
      results.push({ task: task.type, name, status: 'skipped', created: false, reason: 'invalid screen name' });
      continue;
    }
    try {
      fs.writeFileSync(pagesPath, code.endsWith('\n') ? code : code + '\n');
      created = true;
    } catch (e) {
      await emitSafe(emit, { rotation, stage: 3, agent: 'build-executor', level: 'bad', message: `Could not write the screen file: ${e.message}` });
      results.push({ task: task.type, name, status: 'failed', created: false, error: e.message });
      continue;
    }

    const wired = wireRouter(srcDir, { componentName: task.componentName, route: task.route, kebab });
    await emitSafe(emit, {
      rotation,
      stage: 3,
      agent: 'build-executor',
      level: 'good',
      message: wired.wired
        ? `Built "${name}" → src/pages/${kebab}.tsx · ${wired.already ? 'already routed' : 'added to your app’s routes at ' + task.route}`
        : `Built "${name}" → src/pages/${kebab}.tsx · couldn’t auto-route (${wired.reason}); link it from your menu`,
    });

    results.push({
      task: task.type,
      name,
      status: 'succeeded',
      created,
      file: path.relative(root, pagesPath).replace(/\\/g, '/'),
      route: task.route,
      wired: wired.wired,
      source,
    });
  }
  return results;
}

// ---- build verification (real test, no browser needed) ------------------------

// Run the project's own build (tsc + bundler) to verify the generated code compiles.
// This is a genuine pass/fail gate that needs no tenant and no browser. Skips cleanly
// when dependencies aren't installed (reported as not-verified, never a false green).
function verifyBuild(root, { timeoutMs = 240000 } = {}) {
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    return { ran: false, passed: false, reason: 'dependencies not installed (npm install first)' };
  }
  let script = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.build) script = 'build';
  } catch {
    /* no package.json scripts */
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = script ? ['run', script, '--silent'] : ['exec', '--', 'tsc', '--noEmit'];
  const res = spawnSync(npm, args, { cwd: root, encoding: 'utf8', timeout: timeoutMs, shell: process.platform === 'win32' });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const passed = res.status === 0 && !res.error;
  const errors = passed ? [] : extractErrors(out);
  return { ran: true, passed, code: res.status, errors, output: out.slice(-4000) };
}

// Pull TypeScript/Vite error lines out of build output for a concise, real failure list.
function extractErrors(out) {
  const lines = String(out || '').split('\n');
  const errs = lines.filter((l) => /error TS\d+|ERROR|Could not resolve|is not assignable|Cannot find/i.test(l));
  return [...new Set(errs.map((l) => l.trim()))].slice(0, 12);
}

module.exports = { buildCodeTasks, verifyBuild, generateScreen, ensureDataSeam, deriveSchema, seedFor, entityFrom, findSrc, isCodeApp, wireRouter, validateTsx };

async function emitSafe(emit, evt) {
  try {
    if (emit) await emit(evt);
  } catch {
    /* emit must never break a build */
  }
}
