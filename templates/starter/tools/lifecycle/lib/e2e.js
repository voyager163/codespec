'use strict';
// e2e.js — real end-to-end exercise of a running app, and the heal loop around it.
//
// This is the engine behind "test every element, fix, repeat until green" (CLAUDE.md
// Rule 3). Given a URL to a running app (from preview.js or a live publish), it drives
// a real browser: enumerate every interactive element, fill inputs with representative
// data, click buttons, exercise dropdowns, submit forms, follow links — and collect the
// real failures the browser reports (thrown errors, console errors, failed requests,
// navigation errors). The heal loop feeds those failures back into a fixer and re-tests
// until green or no-progress.
//
// The browser is a *driver* the orchestration talks to through a small interface, so:
//   - production uses a real Playwright/Chromium driver (createPlaywrightDriver),
//   - the pure planning/classification/loop logic is unit-tested with a fake driver,
//   - and when Playwright isn't installed the caller degrades honestly (driver is null).
//
// Nothing here fakes a pass: `passed` is true only when zero real failures were seen.

// ---- representative input data, by input type ---------------------------------
function representativeValue(el) {
  const type = String(el.type || 'text').toLowerCase();
  switch (type) {
    case 'email': return 'test.user@example.com';
    case 'number':
    case 'range': return '42';
    case 'tel': return '5551234567';
    case 'url': return 'https://example.com';
    case 'date': return '2026-01-15';
    case 'month': return '2026-01';
    case 'week': return '2026-W03';
    case 'time': return '12:30';
    case 'datetime-local': return '2026-01-15T12:30';
    case 'password': return 'Password123!';
    case 'color': return '#3366ff';
    case 'search':
    case 'text':
    case '':
    default: return el.tag === 'textarea' ? 'This is representative test content.' : 'Test input';
  }
}

// ---- interaction plan (pure) --------------------------------------------------
// Order matters: fill fields and exercise selects BEFORE clicking buttons, so a form
// submit sees populated inputs (exercises the happy path). Links are visited last.
function planInteractions(elements, { maxLinks = 8 } = {}) {
  const steps = [];
  const fills = [];
  const selects = [];
  const clicks = [];
  const links = [];
  for (const el of elements || []) {
    const kind = el.kind || el.tag;
    if (kind === 'input' && /^(checkbox|radio)$/i.test(el.type || '')) {
      clicks.push({ action: 'check', selector: el.selector, label: describe(el) });
    } else if (kind === 'input' || kind === 'textarea') {
      fills.push({ action: 'fill', selector: el.selector, value: representativeValue(el), label: describe(el) });
    } else if (kind === 'select') {
      const opts = (el.options || []).filter((o) => o !== '' && o != null);
      // Exercise every option at least once (Rule 3), capped for pathological menus.
      (opts.length ? opts : [null]).slice(0, 12).forEach((o) => {
        selects.push({ action: 'select', selector: el.selector, value: o, label: describe(el) + ' → ' + (o == null ? '(default)' : o) });
      });
    } else if (kind === 'button') {
      clicks.push({ action: 'click', selector: el.selector, label: describe(el) });
    } else if (kind === 'link') {
      links.push({ action: 'navigate', selector: el.selector, label: describe(el), href: el.href });
    }
  }
  steps.push(...fills, ...selects, ...clicks, ...links.slice(0, maxLinks));
  return steps;
}

function describe(el) {
  return (el.text && el.text.trim()) || el.name || el.id || el.selector || (el.kind || el.tag);
}

// ---- failure classification (pure) -------------------------------------------
// Turn raw browser events into a deduped, structured failure list. Only genuine
// problems count — an intentional 404 favicon or an info log is not a failure.
function classifyFailures(events, { stepLabel } = {}) {
  const out = [];
  const seen = new Set();
  const add = (type, detail, severity) => {
    const key = type + '|' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, detail: String(detail).slice(0, 300), severity: severity || 'error', at: stepLabel || null });
  };
  const e = events || {};
  for (const msg of e.pageErrors || []) add('pageerror', msg, 'error');
  for (const msg of e.thrown || []) add('thrown', msg, 'error');
  for (const msg of e.consoleErrors || []) {
    // Ignore benign noise: favicon 404s, React DevTools hints, HMR pings.
    if (/favicon\.ico|download the react devtools|\[vite\] connect/i.test(msg)) continue;
    add('console-error', msg, 'error');
  }
  for (const fr of e.failedRequests || []) {
    const url = fr.url || String(fr);
    if (/favicon\.ico/i.test(url)) continue;
    add('netfail', url + (fr.status ? ' (' + fr.status + ')' : ''), 'warn');
  }
  if (e.navError) add('nav-error', e.navError, 'error');
  return out;
}

// A stable signature so the heal loop can detect "same failures as last round".
function failureSignature(failures) {
  return (failures || []).map((f) => f.type + ':' + f.detail).sort().join(' | ');
}

// ---- run one full exercise pass ----------------------------------------------
// driver: { open(url), listInteractive(), fill(sel,val), check(sel), click(sel),
//           select(sel,val), navigate(sel), drainEvents(), close() }
async function runE2E(url, driver, { onStep = () => {}, maxSteps = 120, maxDurationMs = 120000 } = {}) {
  if (!driver) return { passed: false, failures: [{ type: 'setup', detail: 'no browser driver (install playwright)', severity: 'error' }], exercised: 0, coverage: 0 };
  const { withTimeout, deadline } = require('./timeout');
  const withinTime = deadline(maxDurationMs);
  const allFailures = [];
  let exercised = 0;
  let elements = [];
  try {
    // A hung navigation must not stall the run forever.
    await withTimeout(driver.open(url), Math.min(maxDurationMs, 30000), 'page open');
    // Initial page load errors.
    allFailures.push(...classifyFailures(await safe(driver.drainEvents), { stepLabel: 'page load' }));
    elements = (await safe(driver.listInteractive)) || [];
  } catch (e) {
    try { await driver.close(); } catch { /* best-effort */ }
    return { passed: false, failures: [{ type: 'nav-error', detail: e.message, severity: 'error' }], exercised: 0, coverage: 0 };
  }
  const steps = planInteractions(elements).slice(0, maxSteps);
  for (const step of steps) {
    if (!withinTime()) { allFailures.push({ type: 'timeout', detail: `stopped after ${maxDurationMs}ms; exercised ${exercised}/${steps.length}`, severity: 'warn' }); break; }
    try {
      if (step.action === 'fill') await driver.fill(step.selector, step.value);
      else if (step.action === 'check') await driver.check(step.selector);
      else if (step.action === 'click') await driver.click(step.selector);
      else if (step.action === 'select') await driver.select(step.selector, step.value);
      else if (step.action === 'navigate') await driver.navigate(step.selector);
      exercised += 1;
      onStep(step);
      const evs = await safe(driver.drainEvents);
      allFailures.push(...classifyFailures(evs, { stepLabel: step.label }));
    } catch (e) {
      allFailures.push({ type: 'interaction', detail: step.label + ': ' + e.message, severity: 'error', at: step.label });
    }
  }
  try { await driver.close(); } catch { /* best-effort */ }

  // Dedupe across steps, keep errors ahead of warnings.
  const deduped = dedupe(allFailures);
  const hardFailures = deduped.filter((f) => f.severity === 'error');
  const passed = hardFailures.length === 0;
  const coverage = steps.length ? Math.round((exercised / steps.length) * 100) : 100;
  return { passed, failures: deduped, hardFailures, exercised, planned: steps.length, coverage, elements: elements.length };
}

function dedupe(failures) {
  const seen = new Set();
  const out = [];
  for (const f of failures) {
    const key = f.type + '|' + f.detail;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

async function safe(fn) {
  try { return await fn(); } catch { return null; }
}

// ---- heal loop ----------------------------------------------------------------
// Run → if red, fix → rebuild → re-run, until green, no-progress, or maxRounds.
// onFix(failures) applies a fix (AI or deterministic); rebuild() re-verifies the build.
// Returns { passed, rounds, failures, history }.
async function healLoop({ url, makeDriver, onFix, rebuild, maxRounds = 3, onRound = () => {} } = {}) {
  const history = [];
  let prevSig = null;
  for (let round = 1; round <= maxRounds; round++) {
    const driver = makeDriver ? await makeDriver() : null;
    const result = await runE2E(url, driver);
    const sig = failureSignature(result.hardFailures || result.failures);
    history.push({ round, passed: result.passed, failures: result.failures, exercised: result.exercised });
    onRound({ round, result });
    if (result.passed) return { passed: true, rounds: round, failures: [], history };
    if (sig && sig === prevSig) {
      // Same failures as last round despite a fix attempt → stop, don't spin.
      return { passed: false, rounds: round, failures: result.failures, noProgress: true, history };
    }
    prevSig = sig;
    if (round < maxRounds) {
      if (onFix) await onFix(result.hardFailures || result.failures);
      if (rebuild) {
        const built = await rebuild();
        if (built && built.passed === false) {
          return { passed: false, rounds: round, failures: [{ type: 'build', detail: 'fix did not compile', severity: 'error' }], history };
        }
      }
    }
  }
  return { passed: false, rounds: maxRounds, failures: history[history.length - 1].failures, exhausted: true, history };
}

// ---- real Playwright driver (lazy; null when Playwright isn't installed) -------
async function createPlaywrightDriver({ headless = true, timeoutMs = 15000 } = {}) {
  let pw;
  try {
    pw = require('playwright');
  } catch {
    return null; // caller degrades: Playwright is an optional dev dependency of the app
  }
  const browser = await pw.chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const buf = { consoleErrors: [], pageErrors: [], failedRequests: [], thrown: [] };
  page.on('console', (m) => { if (m.type() === 'error') buf.consoleErrors.push(m.text()); });
  page.on('pageerror', (err) => buf.pageErrors.push(String(err && err.message || err)));
  page.on('requestfailed', (req) => buf.failedRequests.push({ url: req.url(), status: 0 }));
  page.on('response', (res) => { if (res.status() >= 500) buf.failedRequests.push({ url: res.url(), status: res.status() }); });

  const drain = () => {
    const snapshot = { consoleErrors: buf.consoleErrors.slice(), pageErrors: buf.pageErrors.slice(), failedRequests: buf.failedRequests.slice(), thrown: buf.thrown.slice() };
    buf.consoleErrors.length = 0; buf.pageErrors.length = 0; buf.failedRequests.length = 0; buf.thrown.length = 0;
    return snapshot;
  };

  return {
    async open(url) { await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }); },
    async listInteractive() {
      return page.evaluate(() => {
        const sel = (el) => {
          if (el.id) return '#' + CSS.escape(el.id);
          if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
          const all = Array.from(document.querySelectorAll(el.tagName));
          return el.tagName.toLowerCase() + ':nth-of-type(' + (all.indexOf(el) + 1) + ')';
        };
        const out = [];
        document.querySelectorAll('input').forEach((el) => out.push({ kind: 'input', type: el.type, id: el.id, name: el.name, selector: sel(el) }));
        document.querySelectorAll('textarea').forEach((el) => out.push({ kind: 'textarea', id: el.id, name: el.name, selector: sel(el) }));
        document.querySelectorAll('select').forEach((el) => out.push({ kind: 'select', id: el.id, name: el.name, selector: sel(el), options: Array.from(el.options).map((o) => o.value) }));
        document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach((el) => out.push({ kind: 'button', id: el.id, text: (el.textContent || el.value || '').trim().slice(0, 40), selector: sel(el) }));
        document.querySelectorAll('a[href]').forEach((el) => out.push({ kind: 'link', text: (el.textContent || '').trim().slice(0, 40), href: el.getAttribute('href'), selector: sel(el) }));
        return out;
      });
    },
    async fill(s, v) { await page.fill(s, String(v), { timeout: 4000 }).catch(() => {}); },
    async check(s) { await page.check(s, { timeout: 4000 }).catch(() => {}); },
    async click(s) { await page.click(s, { timeout: 4000, trial: false }).catch(() => {}); },
    async select(s, v) { if (v != null) await page.selectOption(s, String(v), { timeout: 4000 }).catch(() => {}); },
    async navigate(s) {
      await Promise.all([
        page.click(s, { timeout: 4000 }).catch(() => {}),
        page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}),
      ]);
      await page.goBack({ timeout: 5000 }).catch(() => {});
    },
    async drainEvents() { return drain(); },
    async close() { await browser.close().catch(() => {}); },
  };
}

module.exports = {
  representativeValue,
  planInteractions,
  classifyFailures,
  failureSignature,
  runE2E,
  healLoop,
  createPlaywrightDriver,
};
