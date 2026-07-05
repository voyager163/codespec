## ADDED Requirements

### Requirement: Self-Contained Harness Preamble

PowerCodex SHALL compose a self-contained system preamble that encodes its
engineering discipline and prepend it to the prompt sent to the connected agent, so
the agent applies that discipline without the end user invoking a skill and without
any skill being installed on the user's machine.

#### Scenario: Harness composes on a substantive turn

- **WHEN** the harness is enabled and a substantive request (plan, act, answer, agent, or build) is processed
- **THEN** `compose` SHALL return a non-empty block delimited by a `POWERCODEX HARNESS` marker
- **AND** the block SHALL be prepended to the existing system prompt rather than replacing it.

#### Scenario: Non-substantive turns are skipped

- **WHEN** the turn is a greeting or acknowledgement (intent `chat`)
- **THEN** `compose` SHALL return an empty string
- **AND** no harness block SHALL be added to the prompt.

#### Scenario: Harness requires nothing installed

- **WHEN** the connected agent runs in a workspace with no PowerCodex skills present
- **THEN** the composed block SHALL still contain the full mode-router guidance as inline rules
- **AND** it SHALL NOT depend on any external skill file being loadable for its core behaviour.

### Requirement: Godmode Mode Routing

The harness SHALL instruct the agent to select exactly one engineering mode — build,
fix, audit, ux-map, or sec-ops (or none for a plain task) — and apply that mode's
discipline, including the principle that the leanest solution which still preserves
validation, error handling, security, and accessibility is the finished one.

#### Scenario: A build request biases to build mode

- **WHEN** the task text describes building a new capability
- **THEN** `detectMode` SHALL return `build`
- **AND** the composed block SHALL include the build-mode discipline (honest MVP, lean, tests green).

#### Scenario: A bug report biases to fix mode

- **WHEN** the task text reports something broken
- **THEN** `detectMode` SHALL return `fix`
- **AND** the composed block SHALL require a failing reproduction test before the fix is claimed done.

#### Scenario: Guardrails are always present

- **WHEN** any harness block is composed
- **THEN** it SHALL forbid overwriting the user's `CLAUDE.md`, cloning-as-setup, file-hiding, and prompt-logging telemetry.

### Requirement: Codeapps Skill Routing

When the task involves Power Platform code apps, the harness SHALL append routing
guidance selecting the single matching codeapps specialist and SHALL direct the agent
to load the full skill file when it is present in the workspace.

#### Scenario: A Dataverse task routes to the dataverse specialist

- **WHEN** the task text concerns Dataverse tables, CRUD, or queries
- **THEN** `pickCodeappsSkill` SHALL return `dataverse-specialist`
- **AND** the composed block SHALL include that skill's condensed guidance.

#### Scenario: A non-Dataverse connector routes to the connector integrator

- **WHEN** the task text concerns an Office 365, SQL, or SharePoint connector
- **THEN** `pickCodeappsSkill` SHALL return `connector-integrator`.

#### Scenario: Full skill file is preferred when present

- **WHEN** a codeapps skill is selected
- **THEN** the block SHALL instruct the agent to load `.powerplatform/<skill>/SKILL.md` for full fidelity when it is readable
- **AND** to fall back to the condensed guidance when it is not.

#### Scenario: Non-Power-Platform tasks omit the codeapps block

- **WHEN** the task text has no Power Platform intent
- **THEN** `detectCodeapps` SHALL return false
- **AND** no codeapps block SHALL be appended.

### Requirement: Consent-Gated Injection

The harness SHALL be governed by an `Approved_rights/harness` flag that defaults to
on, and SHALL inject nothing when the flag is off.

#### Scenario: Enabled by default

- **WHEN** a project has no explicit harness setting
- **THEN** the `harness` right SHALL default to true
- **AND** substantive turns SHALL receive the harness block.

#### Scenario: Disabling stops injection

- **WHEN** `Approved_rights/harness` is false
- **THEN** `compose` SHALL return an empty string for every turn
- **AND** the connected agent SHALL behave exactly as it did before this change.

### Requirement: Injection Across Provider Sites

Every place that assembles a provider prompt SHALL prepend the composed harness so
behaviour is consistent regardless of entry point (chat, agent, cockpit, code
generation, story derivation).

#### Scenario: Chat, agent, and cockpit prompts include the harness

- **WHEN** a substantive request is handled through chat, agent, or the cockpit with the harness enabled
- **THEN** the prompt passed to the provider adapter SHALL contain the harness block.

### Requirement: Safe Degradation and Observability

Harness composition SHALL never break the agent, and SHALL report its routing
decision to the status bus.

#### Scenario: Composition failure degrades silently

- **WHEN** harness composition throws internally
- **THEN** `compose` SHALL return an empty string
- **AND** the turn SHALL proceed with the unmodified prompt.

#### Scenario: Routing decision is emitted

- **WHEN** the harness is composed for a substantive turn
- **THEN** a single status line naming the selected mode and codeapps skill SHALL be appended to the status bus.
