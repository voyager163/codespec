'use strict';
// electron-builder afterSign hook — notarize the macOS app when credentials are present.
//
// Deliberately a no-op unless BOTH @electron/notarize is installed AND Apple credentials
// are in the environment, so local/unsigned builds keep working with zero setup. To
// enable notarization on a release machine:
//   npm i -D @electron/notarize
//   export APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx APPLE_TEAM_ID=TEAMID
// (electron-builder picks up CSC_LINK/CSC_KEY_PASSWORD for the signing identity itself.)
module.exports = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Apple credentials not set — skipping (unsigned local build).');
    return;
  }

  let notarizeFn;
  try {
    notarizeFn = require('@electron/notarize').notarize;
  } catch {
    console.log('[notarize] @electron/notarize not installed — skipping. Run: npm i -D @electron/notarize');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] Notarizing ${appName}.app …`);
  await notarizeFn({
    appBundleId: 'com.powercodex.desktop',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[notarize] Done.');
};
