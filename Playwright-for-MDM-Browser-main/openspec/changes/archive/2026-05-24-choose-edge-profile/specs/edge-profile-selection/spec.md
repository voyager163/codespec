## ADDED Requirements

### Requirement: List installed Edge profiles
The system SHALL discover installed Microsoft Edge profiles from the local Edge profile metadata and present selectable entries that include the profile directory and available display identity.

#### Scenario: Profiles are available
- **WHEN** the user starts the profile-selection workflow
- **THEN** the system lists discovered Edge profiles with enough identifying information for the user to choose the intended profile

#### Scenario: Profile metadata is incomplete
- **WHEN** a discovered profile has no display name or username
- **THEN** the system still lists the profile using its profile directory as a fallback identifier

### Requirement: Select profile for CDP launch
The system SHALL allow the user to choose which Edge profile is used when launching Microsoft Edge with remote debugging for Playwright attachment.

#### Scenario: User selects a profile
- **WHEN** the user selects an Edge profile from the workflow prompt
- **THEN** the system launches Microsoft Edge with `--remote-debugging-port=9222` and the selected `--profile-directory` value

#### Scenario: Invalid selection
- **WHEN** the user enters a selection that does not match an available profile
- **THEN** the system rejects the selection and explains how to choose a valid profile

### Requirement: Attach to CDP-enabled Edge
The system SHALL connect Playwright to the local Edge CDP endpoint and report the attached browser/page state after the selected profile is launched or an existing CDP endpoint is detected.

#### Scenario: CDP endpoint is available
- **WHEN** `http://127.0.0.1:9222` exposes a DevTools Protocol endpoint
- **THEN** the system attaches Playwright to that endpoint and reports the current page title or available page information

#### Scenario: CDP endpoint is unavailable after launch
- **WHEN** the system launches Edge for the selected profile but `http://127.0.0.1:9222` is not available
- **THEN** the system reports that Edge may need to be fully closed and relaunched with remote debugging enabled

### Requirement: Provide npm start entry point
The system SHALL provide an `npm start` command that runs the selectable Edge profile attach workflow.

#### Scenario: User runs npm start
- **WHEN** the user runs `npm start` in the project directory
- **THEN** the system starts the Edge profile selection and Playwright attach workflow instead of returning the placeholder missing-script failure