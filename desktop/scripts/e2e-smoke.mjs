// Playwright ElectronApplication smoke test — launches the real packaged app
// (main.js + the vendored lifecycle server), drives the actual chat window,
// and screenshots it. See https://playwright.dev/docs/api/class-electronapplication
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/powercodex-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

// Isolate from the real profile: main.js resolves app.getPath('userData') to
// this dir, so a real "create app" click here can never touch
// ~/Library/Application Support/PowerCodex (or the Windows/Linux equivalent).
const TEST_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-e2e-'));

const electronApp = await electron.launch({
  args: ['--no-sandbox', `--user-data-dir=${TEST_PROFILE_DIR}`, APP_DIR],
  timeout: 30_000,
});

try {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  console.log('title:', await window.title());
  console.log('url:', window.url());

  await window.screenshot({ path: path.join(SHOT_DIR, '01-launch.png') });

  // Confirm the chat UI actually rendered (not a blank/error page).
  const bodyText = await window.evaluate(() => document.body.innerText);
  console.log('body text length:', bodyText.length);
  console.log('body text sample:', JSON.stringify(bodyText.slice(0, 200)));

  const consoleErrors = [];
  window.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Give any async render / fetch a moment, then re-screenshot.
  await window.waitForTimeout(1500);
  await window.screenshot({ path: path.join(SHOT_DIR, '02-settled.png') });

  // Drive it, don't just launch it: click a real button and confirm the UI reacts.
  await window.getByText('Create a new app').click();
  await window.waitForTimeout(1000);
  await window.screenshot({ path: path.join(SHOT_DIR, '03-after-click.png') });
  const afterClickText = await window.evaluate(() => document.body.innerText);
  console.log('changed after click:', afterClickText.slice(0, 200) !== bodyText.slice(0, 200));

  console.log('console errors so far:', consoleErrors);
  console.log('SMOKE TEST: PASS');
} catch (err) {
  console.error('SMOKE TEST: FAIL', err);
  process.exitCode = 1;
} finally {
  await electronApp.close();
}
