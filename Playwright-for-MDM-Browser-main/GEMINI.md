# Playwright for MDM Browser

This project allows Playwright to control Microsoft Edge via Remote Debugging (CDP), using either an existing debug-enabled Edge instance or a selected installed Edge profile.

## Setup

1. **Close normal Edge windows** if you want the script to launch a profile with remote debugging.
2. **Start the selectable profile workflow:**
   ```bash
   npm start
   ```
3. **Choose an Edge profile** from the numbered list. The list includes the profile directory, display name, and username when Edge has that metadata available.
4. **Enter the target app URL** when prompted, or pass it directly:
   ```bash
   npm start -- https://example.com/app
   ```
5. **Review the smoke-test report** for navigation status, final URL, title, page errors, console errors, and failed network requests.

If `http://127.0.0.1:9222` is already available, the script attaches to that existing CDP endpoint instead of launching a new Edge process.

The target URL opens in a fresh page in the attached Edge browser context, so the selected profile's cookies and sign-in state are preserved. Microsoft or organizational sign-in remains manual/profile-based; the script does not automate login.

If Edge opens but Playwright cannot connect, fully close Edge and run `npm start` again. Existing Edge processes can sometimes absorb the launch arguments before remote debugging is enabled.

## Testing

Run the focused Node test suite with:

```bash
npm test
```

## Development

- `attach.js`: Main script and exported helpers for profile discovery, selection, launch, CDP attachment, app URL navigation, and smoke-test reporting.
- `test/attach.test.js`: Focused tests for profile discovery, profile label formatting, selection validation, URL validation, and smoke-test reporting.
- `package.json`: Configured for ESM (`"type": "module"`) with `npm start` and `npm test` scripts.
