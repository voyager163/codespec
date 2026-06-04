## ADDED Requirements

### Requirement: User edits are preserved and drive refinement

The system SHALL let the user edit generated stories and MVP, and SHALL refine from those edits rather than regenerating from scratch. The user's edits MUST be preserved through a refine cycle.

#### Scenario: Refine preserves user edits

- **WHEN** a user edits a story or the MVP and triggers refine
- **THEN** the system passes the difference between its prior version and the user's edited version to the refinement step
- **AND** the resulting refined artifact retains the user's edits

#### Scenario: Offline refine is deterministic

- **WHEN** refine runs with the simulated provider (no external AI)
- **THEN** the system performs a deterministic merge that keeps user edits and completes without error

### Requirement: Approve & Freeze locks an artifact

The system SHALL provide an Approve & Freeze action that sets `status: "frozen"` on a stories or MVP artifact. While frozen, the lifecycle loop MUST read the artifact but MUST NOT regenerate or overwrite it.

#### Scenario: Frozen artifact is not rewritten by the loop

- **WHEN** an artifact has `status: "frozen"` and the lifecycle loop runs
- **THEN** the loop uses the artifact as its benchmark
- **AND** does not modify or regenerate it

#### Scenario: Freeze is recorded

- **WHEN** a user freezes an artifact
- **THEN** the freeze is emitted to the status bus so the dashboard reflects the frozen state

### Requirement: Unlock for major change reopens an artifact

The system SHALL provide an Unlock for major change action that returns a frozen artifact to `status: "draft"`, and this SHALL be the only path that reopens a frozen artifact for regeneration.

#### Scenario: Unlock reopens for refinement

- **WHEN** a user unlocks a frozen artifact
- **THEN** its status returns to `draft`
- **AND** the artifact may again be refined or regenerated

#### Scenario: Loop cannot unilaterally unlock

- **WHEN** the lifecycle loop runs against a frozen artifact
- **THEN** the loop has no path to change the status from `frozen` to `draft`
