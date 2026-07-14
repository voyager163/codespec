# honest-loop-reporting Specification

## Purpose
TBD - created by archiving change remove-demo-theater. Update Purpose after archive.

## Requirements

### Requirement: The loop never fabricates a test failure

The lifecycle loop SHALL report a spec as failed only when the underlying tester actually observed that spec fail. The system SHALL NOT inject, script, or otherwise manufacture a failure in order to demonstrate the self-heal machinery.

#### Scenario: A run where nothing is wrong stays green

- **WHEN** the loop runs against a target where every spec passes
- **THEN** every rotation reports those specs as passing
- **AND** no rotation reports a failure, a self-heal attempt, or a repair

#### Scenario: No scripted defect on the first rotation

- **WHEN** the loop reaches its first rotation with self-heal enabled
- **THEN** it does not mark any spec as failed unless the tester genuinely returned that spec as failed
- **AND** the presence or absence of a failure does not depend on the rotation number

### Requirement: The loop never fabricates an observation

The lifecycle loop SHALL emit an "authored a spec from observation" event only when a real observation source produced that observation. The system SHALL NOT emit hardcoded observation cards selected by rotation number.

#### Scenario: No canned observations are emitted

- **WHEN** the loop runs with no real observation source available
- **THEN** the observer step emits no observation events
- **AND** the run does not present any gap/improvement/defect card that was not derived from a real signal

#### Scenario: Real observations still flow through

- **WHEN** a real observation source produces an observation for a rotation
- **THEN** the observer emits that observation with its true signal and confidence
- **AND** consent-gated auto-apply behavior is unchanged for genuinely-derived defects

### Requirement: The honest simulate seam is preserved

Removing the theater SHALL NOT remove the loop's ability to run end to end in simulate mode. The simulated engine bundle SHALL remain available and clearly labeled as simulated, and the real self-heal, fix-mode, and observe machinery SHALL remain intact and reachable when real results warrant it.

#### Scenario: Simulate-mode run completes honestly

- **WHEN** the loop runs in simulate mode with no browser or tenant
- **THEN** it completes every stage and is labeled "simulated"
- **AND** it reports honest pass/fail from the specs it was given without any fabricated drama

#### Scenario: Self-heal still triggers on a real failure

- **WHEN** the tester returns a genuinely failing spec
- **THEN** the self-heal / fix-mode path runs exactly as before
- **AND** the loop escalates or re-runs based on the true test outcome
