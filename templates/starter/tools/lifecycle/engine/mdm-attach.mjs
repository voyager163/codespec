// Vendored from the Playwright-for-MDM-Browser project (attach.js).
// This is the real automation engine: it discovers managed-Edge profiles, launches
// Edge with remote debugging, attaches over CDP, and runs an app smoke test that
// reports real page errors, console errors, and failed network requests.
//
// PowerCodex loads this with a dynamic import() from lib/engines.real.js. It is ESM
// and imports `playwright`, which is an OPTIONAL dependency — the lifecycle loop only
// reaches this file when Playwright is installed and real mode is requested. Kept as a
// faithful vendored copy so upstream fixes can be re-vendored cleanly; the CLI block at
// the bottom stays inert unless this file is run directly.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const CDP_ENDPOINT = 'http://127.0.0.1:9222';
const CDP_VERSION_URL = `${CDP_ENDPOINT}/json/version`;
const DEFAULT_EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function getDefaultLocalStatePath(env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Local State');
}

export async function discoverEdgeProfiles(localStatePath = getDefaultLocalStatePath()) {
  const localState = JSON.parse(await readFile(localStatePath, 'utf8'));
  const infoCache = localState?.profile?.info_cache;

  if (!infoCache || typeof infoCache !== 'object') {
    return [];
  }

  return Object.entries(infoCache).map(([directory, metadata]) => {
    const profileMetadata = metadata && typeof metadata === 'object' ? metadata : {};

    return {
      directory,
      displayName: firstString(profileMetadata.name, profileMetadata.shortcut_name, directory),
      username: firstString(profileMetadata.user_name, profileMetadata.gaia_name, ''),
    };
  });
}

export function formatProfileLabel(profile) {
  const displayName = firstString(profile.displayName, profile.directory);
  const username = firstString(profile.username, '');
  const identity = username ? `${displayName} (${username})` : displayName;

  return `${profile.directory} - ${identity}`;
}

export function validateProfileSelection(selection, profiles) {
  const trimmedSelection = selection.trim();

  if (!trimmedSelection) {
    throw new Error('Enter a profile number to continue.');
  }

  const selectedNumber = Number(trimmedSelection);

  if (!Number.isInteger(selectedNumber) || selectedNumber < 1 || selectedNumber > profiles.length) {
    throw new Error(`Choose a number from 1 to ${profiles.length}.`);
  }

  return profiles[selectedNumber - 1];
}

export function validateTargetAppUrl(value) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error('Enter a valid http or https URL.');
  }

  try {
    const url = new URL(trimmedValue);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }

    return url.href;
  } catch {
    throw new Error('Enter a valid http or https URL.');
  }
}

export function getEdgeExecutablePath() {
  const edgePath = DEFAULT_EDGE_PATHS.find((candidate) => existsSync(candidate));

  if (!edgePath) {
    throw new Error(`Microsoft Edge was not found. Checked: ${DEFAULT_EDGE_PATHS.join(', ')}`);
  }

  return edgePath;
}

export function buildEdgeLaunchArgs(profileDirectory) {
  return [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222',
    `--profile-directory=${profileDirectory}`,
  ];
}

export async function isCdpEndpointAvailable() {
  try {
    const response = await fetch(CDP_VERSION_URL);
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForCdpEndpoint({ attempts = 20, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isCdpEndpointAvailable()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}

export function launchEdgeWithProfile(profileDirectory) {
  const edgePath = getEdgeExecutablePath();
  const edgeProcess = spawn(edgePath, buildEdgeLaunchArgs(profileDirectory), {
    detached: true,
    stdio: 'ignore',
  });

  edgeProcess.unref();
}

export async function attachToEdge() {
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());

  console.log('Successfully attached to Edge.');
  console.log(`Browser contexts: ${contexts.length}`);
  console.log(`Open pages: ${pages.length}`);

  if (pages.length === 0) {
    console.log('No open pages were reported by the CDP endpoint.');
    return { browser, contexts, pages };
  }

  for (const [index, page] of pages.entries()) {
    const title = await page.title();
    console.log(`${index + 1}. ${title || '(untitled)'} - ${page.url()}`);
  }

  return { browser, contexts, pages };
}

export function getAttachedBrowserContext(browser) {
  const [context] = browser.contexts();

  if (!context) {
    throw new Error('No browser context is available from the attached Edge session.');
  }

  return context;
}

export async function runAppSmokeTest(context, targetUrl, { timeout = 30000 } = {}) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error?.message ?? String(error));
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? 'Request failed',
    });
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });

    if (page.waitForLoadState) {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }

    return {
      ok: true,
      targetUrl,
      finalUrl: page.url(),
      title: await page.title(),
      pageErrors,
      consoleErrors,
      failedRequests,
    };
  } catch (error) {
    return {
      ok: false,
      targetUrl,
      finalUrl: page.url(),
      title: await safePageTitle(page),
      error: error.message,
      pageErrors,
      consoleErrors,
      failedRequests,
    };
  }
}

// Capture a screenshot of a URL into outPath (PNG). Best-effort: returns { ok, outPath }
// or { ok:false, error } so callers can degrade to a mockup. Used for the plan's
// "Now vs After" visuals when a live app + managed-Edge session are available.
export async function captureScreenshot(context, targetUrl, outPath, { timeout = 30000, fullPage = false } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
    if (page.waitForLoadState) {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    await page.screenshot({ path: outPath, fullPage });
    return { ok: true, outPath, finalUrl: page.url() };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---- Power Platform portal automation -----------------------------------------

// Extract the Dataverse logical name from a maker-portal URL.
// The portal uses two URL patterns depending on the surface:
//   /environments/{envId}/entities/{logicalName}/...
//   /environments/{envId}/tables/{logicalName}/...
// Falls back to null if neither pattern matches.
function logicalNameFromUrl(url) {
  const m = url.match(/\/(?:entities|tables)\/([a-z0-9_]+)\//i);
  return m ? m[1].toLowerCase() : null;
}

// Read the schema-name (“Name”) field that the table editor shows next to Display Name.
// The portal renders it as a read-only or editable text input labelled “Name” (not
// “Display name”). Returns null when the field is not visible (panel not open, wrong page).
async function readSchemaNameField(page) {
  try {
    // Try the labelled input first (most variants).
    const nameInput = page.getByLabel(/^name$/i).first();
    if (await visible(nameInput, 2000)) {
      const v = await nameInput.inputValue().catch(() => '');
      if (v && /^[a-z0-9_]+$/i.test(v)) return v.toLowerCase();
    }
    // Some portal variants render it as a read-only span near “Display name”.
    const spans = await page.getByText(/^[a-z]{2,6}_[a-z0-9_]+$/i).all();
    for (const s of spans) {
      const t = await s.textContent().catch(() => '');
      if (t && /^[a-z]{2,6}_[a-z0-9_]+$/i.test(t.trim())) return t.trim().toLowerCase();
    }
  } catch {
    /* best-effort — caller falls back to URL extraction */
  }
  return null;
}

// Create a Dataverse table in the make.powerapps.com maker portal via the DOM, then
// verify it exists and capture its logical name. This is the real vertical slice for
// `dataverse.table.create`.
//
// Portal DOM is brittle and Microsoft ships A/B variants, so every step is defensive:
// we try a set of stable, role/text-based locators, wait for the table grid, and ONLY
// report created:true after re-reading the tables list and finding the new row. Any
// uncertainty returns created:false with a reason — never a faked success.
//
// Returns: { created, logicalName, reason, finalUrl, steps }
export async function createDataverseTable(context, { environmentId, displayName, pluralName, primaryColumn } = {}) {
  const name = (displayName || 'New Table').trim();
  const plural = (pluralName || (name.endsWith('s') ? name : name + 's')).trim();
  const base = 'https://make.powerapps.com';
  const tablesUrl = environmentId ? `${base}/environments/${environmentId}/tables` : `${base}/tables`;
  const page = await context.newPage();
  const steps = [];
  const note = (m) => steps.push(m);
  try {
    await page.goto(tablesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    note(`opened ${page.url()}`);

    // If we got bounced to a sign-in page, the caller must clear MFA first.
    if (/login\.microsoftonline\.com|\/signin/i.test(page.url())) {
      return finishTable(false, null, 'sign-in required — clear MFA in the Edge window, then retry', page, steps);
    }

    // “New table” → “New table” (the split-button/menu varies; try a few entry points).
    const newTable = page.getByRole('button', { name: /new table/i }).first();
    if (await visible(newTable)) {
      await newTable.click().catch(() => {});
      // A menu may offer “Start from blank”; click it when present.
      const blank = page.getByRole('menuitem', { name: /blank|start from blank/i }).first();
      if (await visible(blank, 2500)) await blank.click().catch(() => {});
      note('clicked New table');
    } else {
      return finishTable(false, null, 'could not find the “New table” button (portal layout may have changed)', page, steps);
    }

    // The new-table panel: fill the display name. The field is usually labelled
    // “Display name”; fall back to the first visible textbox in the panel.
    const displayField = page.getByLabel(/display name/i).first();
    if (await visible(displayField, 8000)) {
      await displayField.fill(name).catch(() => {});
      note(`filled display name “${name}”`);
    } else {
      const anyBox = page.getByRole('textbox').first();
      if (await visible(anyBox, 3000)) await anyBox.fill(name).catch(() => {});
      else return finishTable(false, null, 'the new-table panel did not open as expected', page, steps);
    }

    // Plural name is sometimes auto-filled; set it if the field is editable & empty.
    const pluralField = page.getByLabel(/plural name/i).first();
    if (await visible(pluralField, 1500)) {
      const cur = await pluralField.inputValue().catch(() => '');
      if (!cur) await pluralField.fill(plural).catch(() => {});
    }

    // Primary column display name, when the panel exposes it (optional).
    if (primaryColumn) {
      const primary = page.getByLabel(/primary column.*display name|primary column/i).first();
      if (await visible(primary, 1500)) await primary.fill(String(primaryColumn)).catch(() => {});
    }

    // Save / Create.
    const save = page.getByRole('button', { name: /^(save|create)$/i }).first();
    if (await visible(save, 4000)) {
      await save.click().catch(() => {});
      note('clicked Save');
    } else {
      return finishTable(false, null, 'could not find the Save/Create button on the panel', page, steps);
    }

    // Saving a Dataverse table can take a while; wait for the editor or list to settle.
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // --- Logical name capture (attempt 1): read from the post-save URL.
    // After saving, the portal typically navigates to the table editor whose URL
    // contains the logical name: /entities/{logicalName}/ or /tables/{logicalName}/
    let logicalName = logicalNameFromUrl(page.url());
    note(`post-save URL: ${page.url()} → logicalName: ${logicalName || '(not in URL)'}`);

    // --- Logical name capture (attempt 2): read the “Name” field in the editor DOM.
    if (!logicalName) {
      logicalName = await readSchemaNameField(page);
      if (logicalName) note(`read logical name from DOM schema-name field: ${logicalName}`);
    }

    // Verify: go back to the tables list and look for the new display name.
    await page.goto(tablesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const found = await page.getByText(name, { exact: false }).first().isVisible().catch(() => false);

    // --- Logical name capture (attempt 3): scan table list for a link/href containing
    // the logical name pattern adjacent to the display name row we just created.
    if (!logicalName && found) {
      try {
        const row = page.getByText(name, { exact: false }).first();
        const parent = row.locator('xpath=ancestor::tr[1]|ancestor::div[contains(@class,”row”)][1]').first();
        const links = await parent.locator('a[href]').all();
        for (const link of links) {
          const href = await link.getAttribute('href').catch(() => '');
          const ln = logicalNameFromUrl(href || '');
          if (ln) { logicalName = ln; break; }
        }
        if (logicalName) note(`read logical name from table list row href: ${logicalName}`);
      } catch {
        /* best-effort */
      }
    }

    return finishTable(
      !!found,
      logicalName,
      found ? '' : 'saved, but the new table was not visible in the list on re-read',
      page,
      steps,
    );
  } catch (error) {
    return finishTable(false, null, error.message, page, steps);
  }
}

// Add a column to an existing Dataverse table via the maker portal.
// Supported types: text, number, date, datetime, boolean, choice, lookup, email, url, phone, currency
//
// Returns: { created, logicalName, reason, finalUrl, steps }
export async function addDataverseColumn(context, {
  environmentId,
  tableLogicalName,
  displayName,
  type = 'text',
  choices = [],
  required = false,
  description = '',
} = {}) {
  if (!tableLogicalName) return { created: false, logicalName: null, reason: 'tableLogicalName is required', finalUrl: '', steps: [] };
  const base = 'https://make.powerapps.com';
  const editorUrl = environmentId
    ? `${base}/environments/${environmentId}/entities/${tableLogicalName}/fields`
    : `${base}/entities/${tableLogicalName}/fields`;
  const page = await context.newPage();
  const steps = [];
  const note = (m) => steps.push(m);

  // Map our simple type names to what the portal calls them in its dropdown.
  const TYPE_LABELS = {
    text: /^text$/i,
    number: /^(number|whole number|decimal number)/i,
    date: /^date only$/i,
    datetime: /^date and time$/i,
    boolean: /^(yes\/no|boolean|two options)/i,
    choice: /^choice$/i,
    lookup: /^lookup$/i,
    email: /^email$/i,
    url: /^url$/i,
    phone: /^phone$/i,
    currency: /^currency$/i,
  };
  const typeLabel = TYPE_LABELS[type.toLowerCase()] || new RegExp(type, 'i');

  try {
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    note(`opened table editor: ${page.url()}`);

    if (/login\.microsoftonline\.com|\/signin/i.test(page.url())) {
      return finishColumn(false, null, 'sign-in required', page, steps);
    }

    // Click “+ New column” (various labels across portal versions).
    const newColBtn = page.getByRole('button', { name: /new column|add column|\+ column/i }).first();
    if (await visible(newColBtn, 8000)) {
      await newColBtn.click().catch(() => {});
      note('clicked New column');
    } else {
      return finishColumn(false, null, 'could not find the “+ New column” button', page, steps);
    }

    // Fill Display name.
    const dispField = page.getByLabel(/display name/i).first();
    if (await visible(dispField, 8000)) {
      await dispField.fill(displayName).catch(() => {});
      note(`filled display name “${displayName}”`);
    } else {
      return finishColumn(false, null, 'column panel did not open (Display name field not found)', page, steps);
    }

    // Select Data type.
    // The dropdown is usually a combobox or a select labelled “Data type”.
    const dtField = page.getByLabel(/data type/i).first();
    if (await visible(dtField, 4000)) {
      // Try clicking to open the dropdown, then pick the option.
      await dtField.click().catch(() => {});
      await page.waitForTimeout(400);
      const option = page.getByRole('option', { name: typeLabel }).first();
      if (await visible(option, 3000)) {
        await option.click().catch(() => {});
        note(`selected data type “${type}”`);
      } else {
        // Fall back: type into the field and pick the first suggestion.
        await dtField.fill(type).catch(() => {});
        const suggestion = page.getByRole('option').first();
        if (await visible(suggestion, 2000)) await suggestion.click().catch(() => {});
        note(`typed data type “${type}” and picked first suggestion`);
      }
    }

    // For Choice type: add each choice value.
    if (/^choice$/i.test(type) && choices.length) {
      for (const choice of choices) {
        const addChoice = page.getByRole('button', { name: /add item|add choice|\+ new choice/i }).first();
        if (await visible(addChoice, 3000)) {
          await addChoice.click().catch(() => {});
          const lastInput = page.getByRole('textbox').last();
          if (await visible(lastInput, 2000)) await lastInput.fill(String(choice)).catch(() => {});
        }
      }
      note(`added ${choices.length} choice(s): ${choices.join(', ')}`);
    }

    // Required toggle (optional).
    if (required) {
      const reqToggle = page.getByLabel(/required/i).first();
      if (await visible(reqToggle, 1500)) await reqToggle.check().catch(() => {});
    }

    // Description (optional).
    if (description) {
      const descField = page.getByLabel(/description/i).first();
      if (await visible(descField, 1500)) await descField.fill(description).catch(() => {});
    }

    // Save the column.
    const saveBtn = page.getByRole('button', { name: /^(save|done|create)$/i }).first();
    if (await visible(saveBtn, 4000)) {
      await saveBtn.click().catch(() => {});
      note('clicked Save');
    } else {
      return finishColumn(false, null, 'could not find Save button on column panel', page, steps);
    }

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Capture the column logical name from URL or the schema-name field.
    let logicalName = logicalNameFromUrl(page.url());
    // The column URL pattern is /entities/{table}/fields/{columnLogicalName}
    const colMatch = page.url().match(/\/fields\/([a-z0-9_]+)/i);
    if (colMatch) logicalName = colMatch[1].toLowerCase();
    if (!logicalName) logicalName = await readSchemaNameField(page);
    note(`column logical name: ${logicalName || '(not captured)'}`);

    // Verify: look for the column display name in the fields list.
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const found = await page.getByText(displayName, { exact: false }).first().isVisible().catch(() => false);

    return finishColumn(
      !!found,
      logicalName,
      found ? '' : 'saved, but column not visible in the fields list on re-read',
      page,
      steps,
    );
  } catch (error) {
    return finishColumn(false, null, error.message, page, steps);
  }
}

async function visible(locator, timeout = 6000) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function finish(created, reason, page, steps) {
  const finalUrl = page ? page.url() : '';
  try {
    if (page) await page.close();
  } catch {
    /* best-effort */
  }
  return { created, reason: reason || '', finalUrl, steps };
}

async function finishTable(created, logicalName, reason, page, steps) {
  const finalUrl = page ? page.url() : '';
  try {
    if (page) await page.close();
  } catch {
    /* best-effort */
  }
  return { created, logicalName: logicalName || null, reason: reason || '', finalUrl, steps };
}

async function finishColumn(created, logicalName, reason, page, steps) {
  const finalUrl = page ? page.url() : '';
  try {
    if (page) await page.close();
  } catch {
    /* best-effort */
  }
  return { created, logicalName: logicalName || null, reason: reason || '', finalUrl, steps };
}

export function formatSmokeTestReport(result) {
  const lines = [
    'App smoke test report:',
    `Status: ${result.ok ? 'navigation completed' : 'navigation failed'}`,
    `Target URL: ${result.targetUrl}`,
    `Final URL: ${result.finalUrl}`,
    `Title: ${result.title || '(untitled)'}`,
  ];

  if (result.error) {
    lines.push(`Navigation error: ${result.error}`);
  }

  appendSignalLines(lines, 'Page errors', result.pageErrors);
  appendSignalLines(lines, 'Console errors', result.consoleErrors);
  appendSignalLines(
    lines,
    'Failed requests',
    result.failedRequests.map((request) => `${request.url} - ${request.errorText}`),
  );

  if (
    result.ok &&
    result.pageErrors.length === 0 &&
    result.consoleErrors.length === 0 &&
    result.failedRequests.length === 0
  ) {
    lines.push('No basic browser-page issues were observed.');
  }

  return lines;
}

export async function selectProfile(profiles, input = process.stdin, output = process.stdout) {
  const prompt = readline.createInterface({ input, output });

  try {
    for (;;) {
      const selection = await prompt.question('Choose an Edge profile number: ');

      try {
        return validateProfileSelection(selection, profiles);
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    prompt.close();
  }
}

export async function selectTargetAppUrl(input = process.stdin, output = process.stdout) {
  const prompt = readline.createInterface({ input, output });

  try {
    for (;;) {
      const value = await prompt.question('Enter target app URL: ');

      try {
        return validateTargetAppUrl(value);
      } catch (error) {
        output.write(`${error.message}\n`);
      }
    }
  } finally {
    prompt.close();
  }
}

export async function resolveTargetAppUrl(args = [], input = process.stdin, output = process.stdout) {
  const [targetUrl] = args;

  if (targetUrl) {
    return validateTargetAppUrl(targetUrl);
  }

  return selectTargetAppUrl(input, output);
}

export async function runAppUrlWorkflow(browser, args = process.argv.slice(2)) {
  const targetUrl = await resolveTargetAppUrl(args);
  const context = getAttachedBrowserContext(browser);
  const result = await runAppSmokeTest(context, targetUrl);

  for (const line of formatSmokeTestReport(result)) {
    console.log(line);
  }

  return result;
}

export async function run() {
  if (await isCdpEndpointAvailable()) {
    console.log(`Existing CDP endpoint detected at ${CDP_ENDPOINT}. Attaching without launching Edge.`);
    const { browser } = await attachToEdge();
    await runAppUrlWorkflow(browser);
    return;
  }

  const localStatePath = getDefaultLocalStatePath();
  const profiles = await discoverEdgeProfiles(localStatePath);

  if (profiles.length === 0) {
    throw new Error(`No Edge profiles were found in ${localStatePath}.`);
  }

  console.log('Available Microsoft Edge profiles:');
  profiles.forEach((profile, index) => {
    console.log(`${index + 1}. ${formatProfileLabel(profile)}`);
  });

  const selectedProfile = await selectProfile(profiles);

  console.log(`Launching Edge with profile directory: ${selectedProfile.directory}`);
  launchEdgeWithProfile(selectedProfile.directory);

  if (!(await waitForCdpEndpoint())) {
    throw new Error(
      `Edge launched, but ${CDP_ENDPOINT} did not become available. Fully close Edge, then run npm start again so Edge can relaunch with remote debugging enabled.`,
    );
  }

  const { browser } = await attachToEdge();
  await runAppUrlWorkflow(browser);
}

async function safePageTitle(page) {
  try {
    return await page.title();
  } catch {
    return '';
  }
}

function appendSignalLines(lines, label, signals) {
  lines.push(`${label}: ${signals.length}`);

  signals.forEach((signal, index) => {
    lines.push(`  ${index + 1}. ${signal}`);
  });
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
