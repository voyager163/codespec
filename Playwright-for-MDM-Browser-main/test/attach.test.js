import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  discoverEdgeProfiles,
  formatSmokeTestReport,
  formatProfileLabel,
  runAppSmokeTest,
  selectTargetAppUrl,
  validateProfileSelection,
  validateTargetAppUrl,
} from '../attach.js';

test('discovers Edge profiles from Local State info_cache metadata', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'edge-profiles-'));
  const localStatePath = path.join(userDataDir, 'Local State');

  await writeFile(
    localStatePath,
    JSON.stringify({
      profile: {
        info_cache: {
          Default: {
            name: 'Work',
            user_name: 'person@example.com',
          },
          'Profile 2': {
            shortcut_name: 'Personal',
          },
        },
      },
    }),
    'utf8',
  );

  assert.deepEqual(await discoverEdgeProfiles(localStatePath), [
    {
      directory: 'Default',
      displayName: 'Work',
      username: 'person@example.com',
    },
    {
      directory: 'Profile 2',
      displayName: 'Personal',
      username: '',
    },
  ]);
});

test('formats profile labels with directory and identity fallbacks', () => {
  assert.equal(
    formatProfileLabel({
      directory: 'Default',
      displayName: 'Work',
      username: 'person@example.com',
    }),
    'Default - Work (person@example.com)',
  );

  assert.equal(
    formatProfileLabel({ directory: 'Profile 7', displayName: '', username: '' }),
    'Profile 7 - Profile 7',
  );
});

test('validates profile selections by one-based list number', () => {
  const profiles = [
    { directory: 'Default', displayName: 'Work', username: 'person@example.com' },
    { directory: 'Profile 2', displayName: 'Personal', username: '' },
  ];

  assert.equal(validateProfileSelection('2', profiles), profiles[1]);
  assert.throws(() => validateProfileSelection('', profiles), /Enter a profile number/);
  assert.throws(() => validateProfileSelection('3', profiles), /Choose a number from 1 to 2/);
  assert.throws(() => validateProfileSelection('abc', profiles), /Choose a number from 1 to 2/);
});

test('validates target app URLs as http or https URLs', () => {
  assert.equal(validateTargetAppUrl(' https://example.com/app '), 'https://example.com/app');
  assert.equal(validateTargetAppUrl('http://localhost:3000/path'), 'http://localhost:3000/path');

  assert.throws(() => validateTargetAppUrl(''), /valid http or https URL/);
  assert.throws(() => validateTargetAppUrl('not a url'), /valid http or https URL/);
  assert.throws(() => validateTargetAppUrl('file:///C:/temp/app.html'), /valid http or https URL/);
});

test('prompts until a valid target app URL is entered', async () => {
  const input = new PassThrough();
  const output = writableOutput();
  const selectedUrlPromise = selectTargetAppUrl(input, output);

  input.write('not a url\n');
  await new Promise((resolve) => setImmediate(resolve));
  input.write('https://example.com/app\n');

  assert.equal(await selectedUrlPromise, 'https://example.com/app');
  input.end();
  assert.match(output.text, /Enter a valid http or https URL/);
});

test('runs app smoke test and captures browser health signals', async () => {
  const page = createMockPage({
    title: 'Example App',
    url: 'https://example.com/app/home',
    onGoto() {
      page.emit('console', {
        type: () => 'error',
        text: () => 'client-side failure',
      });
      page.emit('pageerror', new Error('uncaught failure'));
      page.emit('requestfailed', {
        url: () => 'https://example.com/api/data',
        failure: () => ({ errorText: 'net::ERR_FAILED' }),
      });
    },
  });
  const context = { newPage: async () => page };

  assert.deepEqual(await runAppSmokeTest(context, 'https://example.com/app'), {
    ok: true,
    targetUrl: 'https://example.com/app',
    finalUrl: 'https://example.com/app/home',
    title: 'Example App',
    pageErrors: ['uncaught failure'],
    consoleErrors: ['client-side failure'],
    failedRequests: [
      {
        url: 'https://example.com/api/data',
        errorText: 'net::ERR_FAILED',
      },
    ],
  });
  assert.deepEqual(page.gotoCalls, [
    {
      url: 'https://example.com/app',
      options: { waitUntil: 'domcontentloaded', timeout: 30000 },
    },
  ]);
});

test('returns structured smoke test failure when navigation fails', async () => {
  const page = createMockPage({ gotoError: new Error('navigation timeout') });
  const context = { newPage: async () => page };

  assert.deepEqual(await runAppSmokeTest(context, 'https://example.com/app'), {
    ok: false,
    targetUrl: 'https://example.com/app',
    finalUrl: 'about:blank',
    title: '',
    error: 'navigation timeout',
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
  });
});

test('formats smoke test reports with useful success and issue details', () => {
  assert.deepEqual(
    formatSmokeTestReport({
      ok: true,
      targetUrl: 'https://example.com/app',
      finalUrl: 'https://example.com/app/home',
      title: 'Example App',
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
    }),
    [
      'App smoke test report:',
      'Status: navigation completed',
      'Target URL: https://example.com/app',
      'Final URL: https://example.com/app/home',
      'Title: Example App',
      'Page errors: 0',
      'Console errors: 0',
      'Failed requests: 0',
      'No basic browser-page issues were observed.',
    ],
  );

  assert.deepEqual(
    formatSmokeTestReport({
      ok: false,
      targetUrl: 'https://example.com/app',
      finalUrl: 'about:blank',
      title: '',
      error: 'navigation timeout',
      pageErrors: ['uncaught failure'],
      consoleErrors: ['client-side failure'],
      failedRequests: [{ url: 'https://example.com/api/data', errorText: 'net::ERR_FAILED' }],
    }),
    [
      'App smoke test report:',
      'Status: navigation failed',
      'Target URL: https://example.com/app',
      'Final URL: about:blank',
      'Title: (untitled)',
      'Navigation error: navigation timeout',
      'Page errors: 1',
      '  1. uncaught failure',
      'Console errors: 1',
      '  1. client-side failure',
      'Failed requests: 1',
      '  1. https://example.com/api/data - net::ERR_FAILED',
    ],
  );
});

function writableOutput() {
  return {
    text: '',
    write(chunk) {
      this.text += chunk;
    },
  };
}

function createMockPage({ title = '', url = 'about:blank', gotoError, onGoto } = {}) {
  const handlers = new Map();

  return {
    gotoCalls: [],
    on(eventName, handler) {
      if (!handlers.has(eventName)) {
        handlers.set(eventName, []);
      }
      handlers.get(eventName).push(handler);
    },
    emit(eventName, payload) {
      for (const handler of handlers.get(eventName) ?? []) {
        handler(payload);
      }
    },
    async goto(targetUrl, options) {
      this.gotoCalls.push({ url: targetUrl, options });
      onGoto?.();
      if (gotoError) {
        throw gotoError;
      }
    },
    async waitForLoadState() {},
    async title() {
      return title;
    },
    url() {
      return url;
    },
  };
}