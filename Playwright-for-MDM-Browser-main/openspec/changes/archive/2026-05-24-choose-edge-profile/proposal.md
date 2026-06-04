## Why

The current Playwright attach workflow assumes the wrong Edge profile, so it can connect to a debug browser but not necessarily the signed-in profile the user wants to test. This blocks reliable Power Platform testing because the target profile may contain the required account, session, and browser state.

## What Changes

- Add a way to choose an installed Microsoft Edge profile before launching or attaching to the CDP-enabled browser.
- Make `npm start` a useful entry point for the profile-selection attach workflow instead of the current placeholder failure.
- Preserve the existing ability to attach to an already-running CDP endpoint on `127.0.0.1:9222`.
- Show enough profile information for the user to pick the correct Edge profile without needing to know internal directory names.

## Capabilities

### New Capabilities
- `edge-profile-selection`: Selecting an Edge profile for the Playwright CDP attach workflow.

### Modified Capabilities

## Impact

- Affected files: `attach.js`, `package.json`, and project documentation.
- Adds Node-based workflow logic for reading local Edge profile metadata and launching Edge with remote debugging.
- No new external service dependencies are expected.