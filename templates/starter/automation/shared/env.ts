// Environment + tenant config, loaded from .env (never committed).
export interface AutomationEnv {
  makerPortalUrl: string;
  environmentId: string;
  appId: string;
  storageStatePath: string;
  buildProfileDir: string;
  e2eProfileDir: string;
  /** Base URL the e2e suite targets — set to the pushed app link, or local dev. */
  appBaseUrl: string;
}

export function loadEnv(): AutomationEnv {
  const get = (key: string, fallback = '') => process.env[key] ?? fallback;
  return {
    makerPortalUrl: get('PC_MAKER_PORTAL_URL', 'https://make.powerapps.com'),
    environmentId: get('PC_ENVIRONMENT_ID'),
    appId: get('PC_APP_ID'),
    storageStatePath: get('PC_STORAGE_STATE', 'automation/.auth/storageState.json'),
    buildProfileDir: get('PC_BUILD_PROFILE_DIR', 'automation/.profiles/build'),
    e2eProfileDir: get('PC_E2E_PROFILE_DIR', 'automation/.profiles/e2e'),
    appBaseUrl: get('PC_APP_BASE_URL', 'http://127.0.0.1:5173'),
  };
}

/**
 * Decides how the app is run/tested. Once Dataverse is connected the app MUST be
 * reached via the pushed `power-apps` app link — local Vite dev cannot resolve
 * tenant data. Returns the base URL the e2e suite should target.
 */
export function resolveAppTarget(opts: { dataverseConnected: boolean; pushedAppUrl?: string }): string {
  if (opts.dataverseConnected) {
    if (!opts.pushedAppUrl) {
      throw new Error('Dataverse is connected — run `npx power-apps push` and pass the returned app link.');
    }
    return opts.pushedAppUrl;
  }
  return loadEnv().appBaseUrl; // npm run dev is fine when nothing tenant-backed
}
