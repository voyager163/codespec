## ADDED Requirements

### Requirement: Generated Lifecycle Tool

The initializer SHALL generate projects that include the PowerCodex Lifecycle tool under `tools/lifecycle/`, providing the autonomous app-lifecycle loop and a live monitoring dashboard with no runtime dependencies.

#### Scenario: Lifecycle tool is generated

- **WHEN** a developer creates a project with the initializer
- **THEN** the generated project SHALL contain `tools/lifecycle/bin/powercodex-lifecycle.js`
- **AND** it SHALL contain `tools/lifecycle/lib/` modules for the status bus, rights gate, engines, loop, state, dashboard, server, and control
- **AND** it SHALL contain `tools/lifecycle/assets/dashboard.html`
- **AND** `tools/lifecycle/package.json` SHALL declare `"type": "commonjs"` so the tool runs inside the ESM starter.

#### Scenario: Lifecycle scripts are available

- **WHEN** the generated `package.json` is inspected
- **THEN** it SHALL define a `lifecycle` script, a `lifecycle:serve` script, and a `lifecycle:selftest` script
- **AND** each SHALL invoke `tools/lifecycle/bin/powercodex-lifecycle.js`.

### Requirement: Live Monitoring Dashboard

The generated lifecycle tool SHALL serve a live dashboard that monitors and controls the loop, reading all state from an append-only status bus.

#### Scenario: Status bus records events

- **WHEN** the loop runs
- **THEN** each agent SHALL append a newline-delimited JSON event to `.powercodex/live/status.json`
- **AND** past events SHALL NOT be mutated.

#### Scenario: Dashboard server answers state and control requests

- **WHEN** the dashboard server is running
- **THEN** `GET /api/state` SHALL return a JSON snapshot derived from the status bus, rights gate, and `Learning_Experience`
- **AND** `POST /api/action` SHALL apply intake, rights-toggle, start, pause, resume, approve, and reset actions
- **AND** `POST /api/emit` SHALL append an external progress event so any process can report to the board.

#### Scenario: Dashboard reflects the whole system

- **WHEN** a developer opens the dashboard
- **THEN** it SHALL display the goal/MVP intake and compliance, the `Approved_rights/` flags, the seven lifecycle stages with the current one highlighted, per-agent progress, a live activity feed, test/MVP coverage, observations authored, and `Learning_Experience` lessons.

### Requirement: Consent-Gated Autonomy

The lifecycle loop SHALL read `Approved_rights/` before build and push and SHALL stop rather than act when a required flag is false.

#### Scenario: Build is blocked without rights in real mode

- **WHEN** the loop runs with real (non-simulated) engines and `allowBuild` is false
- **THEN** the loop SHALL stop at the build stage and escalate instead of mutating the tenant.

#### Scenario: Simulation does not require a tenant

- **WHEN** the loop runs in simulation mode
- **THEN** the build and e2e engines SHALL emit the real event stream with simulated outcomes
- **AND** the loop SHALL complete without contacting a Power Platform tenant.
