## ADDED Requirements

### Requirement: Accept target app URL
The system SHALL accept a user-provided target app URL for the Playwright attach workflow before attempting app navigation.

#### Scenario: User enters a valid app URL
- **WHEN** the workflow requests a target app URL and the user provides a valid `http` or `https` URL
- **THEN** the system accepts the URL for navigation

#### Scenario: User enters an invalid app URL
- **WHEN** the workflow requests a target app URL and the user provides an empty, malformed, or unsupported URL
- **THEN** the system rejects the value and explains that a valid `http` or `https` URL is required

### Requirement: Navigate attached browser to app URL
The system SHALL navigate an Edge page in the attached Playwright browser session to the accepted target app URL.

#### Scenario: Attached browser has an available context
- **WHEN** Playwright is attached to Edge and a target app URL has been accepted
- **THEN** the system opens or selects a page in the attached browser context and navigates it to the target app URL

#### Scenario: Navigation completes
- **WHEN** the target app URL finishes the configured navigation wait
- **THEN** the system records the final page URL and page title for the smoke-test report

#### Scenario: Navigation fails
- **WHEN** the target app URL cannot be loaded because navigation fails or times out
- **THEN** the system reports the navigation failure with the error message

### Requirement: Report app smoke-test signals
The system SHALL collect and report basic browser-page health signals for the target app page.

#### Scenario: Page emits health signals during navigation
- **WHEN** the system navigates to the target app URL
- **THEN** the smoke-test report includes observed page errors, console errors, and failed network requests

#### Scenario: Smoke run completes without observed health signals
- **WHEN** navigation completes and no page errors, console errors, or failed network requests were observed
- **THEN** the smoke-test report states that no basic browser-page issues were observed

#### Scenario: Smoke run observes health signals
- **WHEN** navigation completes and one or more page errors, console errors, or failed network requests were observed
- **THEN** the smoke-test report includes counts and useful details for each observed signal type