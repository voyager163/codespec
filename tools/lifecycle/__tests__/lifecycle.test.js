'use strict';
// Dependency-free integration tests for the preview / e2e / publish / timeout modules.
// Run with: npm run test:lifecycle   (needs no network, no Playwright, no pac, no tenant).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const preview = require('../lib/preview');
const e2e = require('../lib/e2e');
const publish = require('../lib/publish');
const mockdata = require('../lib/mockdata');
const { withTimeout, withTimeoutOr, deadline, TimeoutError } = require('../lib/timeout');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pcx-it-')); }

// ---- timeout util -------------------------------------------------------------
test('withTimeout rejects a hung promise', async () => {
  await assert.rejects(() => withTimeout(new Promise(() => {}), 30, 'hang'), (e) => e instanceof TimeoutError && e.timedOut);
});
test('withTimeout passes a fast promise through', async () => {
  assert.strictEqual(await withTimeout(Promise.resolve(7), 1000), 7);
});
test('withTimeoutOr degrades to fallback', async () => {
  assert.strictEqual(await withTimeoutOr(new Promise(() => {}), 20, 'fallback'), 'fallback');
});
test('deadline expires', async () => {
  const d = deadline(15);
  assert.ok(d());
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!d());
});

// ---- preview guard rails ------------------------------------------------------
test('preview needs a package.json', () => {
  const d = tmp();
  assert.strictEqual(preview.canRun(d).ok, false);
  fs.rmSync(d, { recursive: true, force: true });
});
test('preview reports needs-install without node_modules', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  const c = preview.canRun(d);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.needsInstall, true);
  fs.rmSync(d, { recursive: true, force: true });
});
test('preview refuses a project with no dev script', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.mkdirSync(path.join(d, 'node_modules'));
  assert.strictEqual(preview.canRun(d).ok, false);
  fs.rmSync(d, { recursive: true, force: true });
});
test('preview starts a real dev server, captures the URL, reuses and stops it', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { dev: 'node fake.js' } }));
  fs.writeFileSync(path.join(d, 'fake.js'), 'setTimeout(()=>console.log("  ➜  Local:   http://localhost:5321/"),100);setInterval(()=>{},1000);');
  const r = await preview.start(d, {});
  assert.strictEqual(r.ok, true);
  assert.match(r.url, /http:\/\/localhost:5321\//);
  const again = await preview.start(d, {});
  assert.strictEqual(again.already, true);
  assert.strictEqual(preview.status(d).running, true);
  preview.stop(d);
  await new Promise((res) => setTimeout(res, 100));
  assert.strictEqual(preview.status(d).running, false);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---- e2e engine ---------------------------------------------------------------
const fakeDriver = (queue, els) => ({
  async open() {}, async listInteractive() { return els || [{ kind: 'input', type: 'text', selector: '#a' }, { kind: 'button', text: 'Go', selector: '#b' }]; },
  async fill() {}, async check() {}, async click() {}, async select() {}, async navigate() {},
  async drainEvents() { return queue.shift() || {}; }, async close() {},
});

test('e2e plans fills before clicks and exercises every dropdown option', () => {
  const plan = e2e.planInteractions([
    { kind: 'button', text: 'Go', selector: '#g' },
    { kind: 'input', type: 'email', selector: '#e' },
    { kind: 'select', selector: '#s', options: ['a', 'b', 'c'] },
    { kind: 'link', text: 'Home', selector: '#h', href: '/' },
  ]);
  const acts = plan.map((s) => s.action);
  assert.ok(acts.indexOf('fill') < acts.indexOf('click'));
  assert.strictEqual(plan.filter((s) => s.action === 'select').length, 3);
  assert.strictEqual(acts[acts.length - 1], 'navigate');
});
test('e2e fills representative data by input type', () => {
  assert.strictEqual(e2e.representativeValue({ type: 'email' }), 'test.user@example.com');
  assert.strictEqual(e2e.representativeValue({ type: 'number' }), '42');
  assert.strictEqual(e2e.representativeValue({ type: 'url' }), 'https://example.com');
});
test('e2e classifies real failures and filters benign noise', () => {
  const f = e2e.classifyFailures({ consoleErrors: ['boom', 'boom', 'favicon.ico 404'], pageErrors: ['TypeError x'], failedRequests: [{ url: '/api/y', status: 500 }, { url: '/favicon.ico' }] });
  assert.strictEqual(f.filter((x) => x.type === 'console-error').length, 1);
  assert.strictEqual(f.filter((x) => x.type === 'netfail').length, 1);
  assert.ok(f.some((x) => x.type === 'pageerror'));
});
test('e2e run is green on a clean app, red on a page error', async () => {
  assert.strictEqual((await e2e.runE2E('http://x', fakeDriver([{}, {}, {}]))).passed, true);
  assert.strictEqual((await e2e.runE2E('http://x', fakeDriver([{ pageErrors: ['null'] }, {}, {}]))).passed, false);
});
test('e2e run returns a driver-missing failure when no driver', async () => {
  const r = await e2e.runE2E('http://x', null);
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.failures[0].type, 'setup');
});
test('e2e heal loop reaches green after a fix', async () => {
  let fixed = false;
  const h = await e2e.healLoop({ url: 'http://x', makeDriver: async () => fixed ? fakeDriver([{}, {}, {}]) : fakeDriver([{ pageErrors: ['bug'] }, {}, {}]), onFix: async () => { fixed = true; }, rebuild: async () => ({ passed: true }), maxRounds: 3 });
  assert.strictEqual(h.passed, true);
  assert.strictEqual(h.rounds, 2);
});
test('e2e heal loop stops on no-progress', async () => {
  const h = await e2e.healLoop({ url: 'http://x', makeDriver: async () => fakeDriver([{ pageErrors: ['same'] }, {}, {}]), onFix: async () => {}, rebuild: async () => ({ passed: true }), maxRounds: 5 });
  assert.strictEqual(h.passed, false);
  assert.strictEqual(h.noProgress, true);
});
test('e2e heal loop stops when a fix does not compile', async () => {
  const h = await e2e.healLoop({ url: 'http://x', makeDriver: async () => fakeDriver([{ pageErrors: ['bug'] }, {}, {}]), onFix: async () => {}, rebuild: async () => ({ passed: false }), maxRounds: 3 });
  assert.strictEqual(h.passed, false);
  assert.strictEqual(h.failures[0].type, 'build');
});

// ---- publish guard rails ------------------------------------------------------
test('publish blocks without explicit consent', async () => {
  const r = await publish.publish(tmp(), { confirm: false });
  assert.strictEqual(r.needsConsent, true);
});
test('publish captures the live app URL from pac output', () => {
  assert.strictEqual(publish.extractAppUrl('done. Play at https://apps.powerapps.com/play/e/env/a/app now'), 'https://apps.powerapps.com/play/e/env/a/app');
  assert.strictEqual(publish.extractAppUrl('nothing here'), '');
});
test('publish check never throws when pac is absent', async () => {
  const c = await publish.check(tmp());
  assert.strictEqual(typeof c.appName, 'string');
  assert.strictEqual(typeof c.pacInstalled, 'boolean');
});

// ---- mock data (preview without a database) -----------------------------------
const jobSchema = { tables: [{ displayName: 'Job', pluralName: 'Jobs', columns: [
  { displayName: 'Name', type: 'text' }, { displayName: 'Status', type: 'choice', choices: ['Open', 'Closed'] },
  { displayName: 'Hours', type: 'number' }, { displayName: 'Due', type: 'date' }, { displayName: 'Done', type: 'boolean' },
] }] };
test('mockdata generates typed rows per table from the schema', () => {
  const g = mockdata.generate(jobSchema, { rows: 3 });
  assert.strictEqual(g.Jobs.length, 3);
  assert.strictEqual(g.Jobs[0].Status, 'Open');
  assert.strictEqual(g.Jobs[1].Status, 'Closed');
  assert.strictEqual(typeof g.Jobs[0].Hours, 'number');
  assert.match(g.Jobs[0].Due, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(typeof g.Jobs[0].Done, 'boolean');
});
test('mockdata writeMockModule skips when there is no data convention', () => {
  assert.strictEqual(mockdata.writeMockModule(tmp()).written, false);
});
test('mockdata writeMockModule writes a TS module when the convention exists', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'src', 'data'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'data', 'index.ts'), '//');
  fs.mkdirSync(path.join(d, '.powercodex'), { recursive: true });
  fs.writeFileSync(path.join(d, '.powercodex', 'dataverse-schema.json'), JSON.stringify(jobSchema));
  const w = mockdata.writeMockModule(d);
  assert.strictEqual(w.written, true);
  assert.match(fs.readFileSync(path.join(d, 'src', 'data', 'mock.generated.ts'), 'utf8'), /mockTables[\s\S]*Jobs/);
  fs.rmSync(d, { recursive: true, force: true });
});
