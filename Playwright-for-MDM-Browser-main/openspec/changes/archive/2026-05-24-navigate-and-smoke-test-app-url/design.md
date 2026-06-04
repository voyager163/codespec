## Context

The project currently runs a Node CLI through `npm start`. The workflow discovers installed Microsoft Edge profiles, lets the user choose the signed-in profile to use, launches Edge with a localhost CDP endpoint when needed, and attaches Playwright to the browser. After attachment, the CLI only reports existing browser/page state, so the user must still navigate manually before any app testing can happen.

The next useful step is a small browser-DOM smoke workflow that runs inside the same selected or already-running Edge session. This should preserve the user's profile-based authentication state while avoiding any attempt to automate Microsoft login or Windows-level UI.

## Goals / Non-Goals

**Goals:**
- Accept a target app URL after CDP attachment, with room for a CLI argument later if useful.
- Navigate an attached Edge page to the target URL using Playwright.
- Collect basic page health signals: final URL, title, page errors, console errors, and failed network requests.
- Print a concise report that helps the user decide whether the app opened cleanly enough for deeper testing.
- Keep the implementation small and testable with focused helper functions.

**Non-Goals:**
- Automating Microsoft, Power Platform, or organizational login flows.
- Building a generic test runner, assertion DSL, or long-running service.
- Controlling native Windows UI outside the browser DOM.
- Making app-specific assertions before the user defines the app behavior to test.

## Decisions

1. Prompt for the target URL in the CLI after Playwright attaches.

   This keeps `npm start` interactive in the same style as profile selection and lets the user paste a Power Apps or MDM app link after selecting the correct profile. A positional CLI argument can be added as a convenience without changing the core behavior, but the prompt is the primary path because it is easy to discover.

2. Use the attached browser's existing default context and open a fresh page for navigation.

   A fresh page avoids replacing whatever tab the user already has open while still using the selected Edge profile's cookies, sessions, and browser state. Reusing the first existing page would be simpler, but it could disrupt the user's current browser state and make test output harder to reason about.

3. Treat this as a smoke report, not a full pass/fail test suite.

   Navigation failure should be reported as a failed smoke run because the app did not open. Console errors, page errors, and failed network requests should be collected and shown as health signals; some enterprise apps may emit benign console noise, so the first version should avoid overclaiming app correctness.

4. Keep app-specific actions out of scope for this change.

   Once the URL navigation and smoke report are reliable, future changes can add configurable steps such as clicking controls, filling forms, or asserting page content. Starting with generic signals keeps this follow-on change small and useful.

## Risks / Trade-offs

- Existing CDP endpoint may belong to a different Edge profile -> Reuse the current behavior but continue printing when an existing endpoint is detected so the user understands which browser session is being used.
- Some apps produce expected console errors or failed requests -> Report details without treating every signal as a hard failure in the first version.
- Pages may continue loading background requests for a long time -> Use a bounded navigation/readiness wait and then report what was observed instead of waiting indefinitely.
- The pasted URL may be malformed -> Validate the URL before navigation and explain how to provide a valid `http` or `https` URL.