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
