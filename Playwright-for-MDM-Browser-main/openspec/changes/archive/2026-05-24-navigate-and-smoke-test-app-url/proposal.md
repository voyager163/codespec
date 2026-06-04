## Why

The current workflow stops after attaching Playwright to Edge, so the user still has to navigate manually before any app testing can begin. Letting the CLI accept a target app URL and run a small smoke report makes `npm start` useful as the first repeatable test step after choosing the correct signed-in Edge profile.

## What Changes

- Add a workflow step for entering or passing a target app URL after Playwright attaches to Edge.
- Navigate an attached Edge page to the provided URL using the selected or already-running CDP browser session.
- Run basic smoke checks for the loaded app page, including page title, final URL, page errors, console errors, and failed network requests.
- Print a concise terminal report so the user can see whether the app opened cleanly before deeper manual or scripted testing.
- Keep Microsoft sign-in and browser profile state manual/profile-based; do not automate login.

## Capabilities

### New Capabilities
- `app-url-smoke-testing`: Navigating to a user-provided app URL in the attached Edge browser and reporting basic page health signals.

### Modified Capabilities

## Impact

- Affected files: `attach.js`, `test/attach.test.js`, and project documentation.
- Extends the Node CLI workflow that currently handles Edge profile selection and CDP attachment.
- No new external service dependencies are expected.