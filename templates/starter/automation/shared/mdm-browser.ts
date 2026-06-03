// Managed-browser bootstrap shared by both engines. Power Platform sits behind
// tenant conditional-access / device-compliance, so we launch a real Microsoft
// Edge channel with a persistent user-data dir, sign in once, and reuse the
// saved session. Aligns to standard Playwright managed-Edge patterns.
import { chromium, type BrowserContext } from '@playwright/test';

export interface MdmContextOptions {
  /** Persistent user-data dir (separate per engine, never shared). */
  profileDir: string;
  /** Saved storageState from auth.setup.ts; omit on first login. */
  storageState?: string;
  /** Conditional-access usually needs a headed browser. */
  headless?: boolean;
}

export async function launchMdmContext(options: MdmContextOptions): Promise<BrowserContext> {
  return chromium.launchPersistentContext(options.profileDir, {
    channel: 'msedge', // real managed Edge, not bundled Chromium
    headless: options.headless ?? false,
    storageState: options.storageState,
    viewport: { width: 1440, height: 900 },
  });
}
