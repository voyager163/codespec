## ADDED Requirements

### Requirement: Generate user stories from the digest

The system SHALL generate user stories from the repo digest and persist them to `.powercodex/stories/stories.json`, with a readable view at `.powercodex/stories/stories.html`. Each story MUST cite the source file(s) it was derived from.

#### Scenario: Stories are generated with provenance

- **WHEN** a digest exists and the user requests story generation
- **THEN** the system writes `.powercodex/stories/stories.json` containing one or more stories
- **AND** each story includes a non-empty list of source files drawn from the digest
- **AND** a human-readable `.powercodex/stories/stories.html` is produced

#### Scenario: No digest yields no fabricated stories

- **WHEN** no digest exists
- **THEN** the system does not fabricate code-grounded stories from source it has not read

### Requirement: MVP grounded in the digest

MVP generation SHALL accept a digest and produce an MVP from the repository's real surfaces and data. When no digest is present, the system SHALL fall back to the existing goal-keyword MVP without error.

#### Scenario: Digest-grounded MVP

- **WHEN** `proposeMvp` is called with a digest
- **THEN** the generated MVP reflects surfaces present in the digest rather than only goal keywords

#### Scenario: Goal-only fallback preserved

- **WHEN** `proposeMvp` is called without a digest
- **THEN** the system produces an MVP from the goal as it does today

### Requirement: Compliance scoring across stories, code, and MVP

Compliance scoring SHALL extend beyond goal↔MVP to also score stories↔code (whether stories are grounded in the digest) and MVP↔stories (whether the MVP serves the reviewed stories). Each score MUST include an explainable reason.

#### Scenario: Stories grounding score

- **WHEN** stories are scored against a digest
- **THEN** the system returns a grounding score and identifies any stories whose cited sources are absent from the digest

#### Scenario: MVP-against-stories score

- **WHEN** an MVP is scored against the stories
- **THEN** the system returns a coverage score and names story intents the MVP does not cover
