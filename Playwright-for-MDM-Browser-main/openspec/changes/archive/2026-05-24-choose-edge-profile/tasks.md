## 1. Profile Discovery

- [x] 1.1 Add Edge profile metadata discovery from the local `Local State` file
- [x] 1.2 Format discovered profiles with directory, display name, and username fallbacks

## 2. Workflow CLI

- [x] 2.1 Add terminal selection for choosing an Edge profile
- [x] 2.2 Validate invalid or empty profile selections with clear errors
- [x] 2.3 Launch Edge with `--remote-debugging-port=9222` and the selected `--profile-directory`

## 3. Playwright Attach

- [x] 3.1 Preserve attachment to an existing CDP endpoint when one is already available
- [x] 3.2 Report useful attached page information after Playwright connects
- [x] 3.3 Report clear guidance when CDP is unavailable after launch

## 4. Project Entry Point and Verification

- [x] 4.1 Add an `npm start` script for the selectable profile workflow
- [x] 4.2 Update documentation with the new profile-selection workflow
- [x] 4.3 Add focused tests for profile discovery, formatting, and selection validation