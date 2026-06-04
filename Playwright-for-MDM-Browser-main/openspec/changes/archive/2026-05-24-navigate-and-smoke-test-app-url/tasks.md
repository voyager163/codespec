## 1. URL Input and Validation

- [x] 1.1 Add a helper that validates target app URLs and accepts only `http` or `https` URLs
- [x] 1.2 Add an interactive prompt for the target app URL after Playwright attaches to Edge
- [x] 1.3 Optionally accept a target app URL from CLI arguments while preserving the interactive prompt fallback

## 2. Browser Navigation and Signal Collection

- [x] 2.1 Add a helper that gets an attached browser context and opens a fresh page for app navigation
- [x] 2.2 Capture page errors, console errors, and failed network requests during navigation
- [x] 2.3 Navigate to the target app URL with a bounded readiness wait and record final URL and title
- [x] 2.4 Return a structured smoke-test result for successful and failed navigation attempts

## 3. CLI Report and Workflow Integration

- [x] 3.1 Integrate URL collection and smoke-test execution after the existing CDP attach step
- [x] 3.2 Print a concise smoke-test report with navigation status, final URL, title, and observed issue counts/details
- [x] 3.3 Preserve existing behavior for attaching to an already-running CDP endpoint and make that session choice visible in output

## 4. Verification and Documentation

- [x] 4.1 Add focused tests for URL validation and smoke-test result formatting
- [x] 4.2 Add focused tests for signal collection behavior using mocked page-like objects where practical
- [x] 4.3 Update project documentation with the new app URL navigation and smoke-test workflow
- [x] 4.4 Run `npm test` and `openspec validate --strict`