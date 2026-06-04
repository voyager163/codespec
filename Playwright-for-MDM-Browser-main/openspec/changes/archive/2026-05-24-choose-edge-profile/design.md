## Context

The project currently has a single `attach.js` script that connects Playwright to `http://127.0.0.1:9222`. Manual testing showed that the CDP connection works when Edge is launched with remote debugging, but the default profile can be the wrong signed-in browser profile for the user's Power Platform session. The local Edge profile metadata is available in `%LOCALAPPDATA%\Microsoft\Edge\User Data\Local State`, and the browser executable is installed at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` on this machine.

## Goals / Non-Goals

**Goals:**
- Let the user choose from installed Edge profiles before starting the Playwright attach workflow.
- Make `npm start` run the selectable-profile workflow.
- Keep the existing CDP attach behavior simple and observable from terminal output.
- Avoid requiring the user to memorize Edge profile directory names such as `Default` or `Profile 17`.

**Non-Goals:**
- Automating Microsoft login or bypassing any browser/account policy.
- Managing Windows-level UI outside the browser DOM.
- Replacing Playwright's CDP attach model with a different automation framework.
- Creating a long-running service or GUI application.

## Decisions

1. Use a Node CLI workflow rather than a separate PowerShell script.

   This keeps the project cross-file logic in JavaScript alongside Playwright and allows `npm start` to be the main entry point. A PowerShell-only launcher would be shorter for Windows process launching, but it would split the automation between two languages and make testing profile parsing harder.

2. Read Edge profile display metadata from `Local State` and present a numbered picker.

   The `Local State` `profile.info_cache` object maps profile directories to user-facing names and usernames. This gives the user enough context to choose the right browser without exposing only internal directory names. If metadata is incomplete, the directory name remains a reliable fallback.

3. Launch Edge with `--remote-debugging-port=9222` and `--profile-directory=<selected>`.

   The workflow should use the selected profile's directory name and avoid fragile unquoted `--user-data-dir` handling unless a custom user data directory is explicitly introduced later. Existing normal Edge windows may prevent a clean CDP launch for the same profile, so the CLI should detect an unavailable CDP endpoint and provide a clear message to close Edge and retry.

4. Preserve direct attachment to an already-running CDP endpoint.

   If port `9222` is already available, the script should attach and report visible pages rather than forcing a relaunch. This keeps the current successful path intact for manually launched debug Edge sessions.

## Risks / Trade-offs

- Existing Edge processes can absorb launch arguments and prevent CDP from opening -> The workflow should verify `http://127.0.0.1:9222/json/version` after launch and tell the user to close Edge if the endpoint is unavailable.
- Profile metadata can contain personal or organizational account identifiers -> The picker should display enough information to choose correctly but avoid logging more than necessary.
- Launching the real profile with remote debugging exposes a local debugging endpoint -> Bind to localhost only and keep the workflow local to the user's machine.
- A selected profile may still require manual sign-in or navigation -> The workflow should launch/attach only; the user remains responsible for browser login state and choosing the target page.