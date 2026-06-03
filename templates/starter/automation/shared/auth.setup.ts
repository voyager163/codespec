// One-time, human-in-the-loop login. Run via `npm run mdm:auth`. Opens the maker
// portal, you complete MFA once, and the session is captured to storageState.
// No credentials are stored in the repo — only the gitignored state file.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchMdmContext } from './mdm-browser';
import { loadEnv } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  mkdirSync(dirname(env.storageStatePath), { recursive: true });

  const context = await launchMdmContext({ profileDir: env.buildProfileDir, headless: false });
  const page = await context.newPage();
  await page.goto(env.makerPortalUrl);

  console.log('Complete sign-in (including MFA) in the opened browser, then return here.');
  // TODO: replace the wait below with a portal-ready assertion for your tenant.
  await page.waitForTimeout(60_000);

  await context.storageState({ path: env.storageStatePath });
  console.log(`Saved session to ${env.storageStatePath}`);
  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
