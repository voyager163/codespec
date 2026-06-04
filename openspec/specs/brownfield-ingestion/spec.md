# brownfield-ingestion Specification

## Purpose
TBD - created by archiving change add-brownfield-ingestion. Update Purpose after archive.
## Requirements
### Requirement: Read-only repo analysis via `import --analyze`

The system SHALL provide an `import --analyze` flag that walks a pre-existing repository and writes a structured repo digest to `.powercodex/digest.json`. The analysis SHALL be read-only with respect to the user's source tree: it MUST NOT create, modify, or delete any file outside `.powercodex/`.

#### Scenario: Analyze produces a digest

- **WHEN** a user runs `import --analyze` in a repository containing `src/`
- **THEN** the system writes `.powercodex/digest.json`
- **AND** makes no changes to any file under `src/` or elsewhere outside `.powercodex/`

#### Scenario: Default import is unchanged

- **WHEN** a user runs `import` without `--analyze`
- **THEN** no digest is produced and the existing structural scaffold behaviour is unchanged

### Requirement: Digest captures app structure

The repo digest SHALL record the application's surfaces and entry points discovered during the walk, including routes/pages, components, connector or data-access calls, and npm scripts. Each recorded surface MUST reference the source file path it was derived from.

#### Scenario: Routes and components are captured with provenance

- **WHEN** the repository defines routes and components under `src/`
- **THEN** the digest lists those routes and components
- **AND** each entry includes the source file path it came from

#### Scenario: Data access is captured

- **WHEN** the repository contains connector or data-access calls
- **THEN** the digest records them so downstream stories can reference real data surfaces

### Requirement: Stack auto-detection

The analysis SHALL auto-detect the project stack and record a `mode` in the digest distinguishing a Power Platform ("tenant") project from a plain web app ("local-run"), without requiring the user to specify which they have.

#### Scenario: Power Platform project detected

- **WHEN** the repository contains Power Platform markers (e.g. `.power`, `power.config.json`, or `@microsoft/power` dependencies)
- **THEN** the digest records `mode: "tenant"`

#### Scenario: Plain web app detected

- **WHEN** the repository has no Power Platform markers but has a dev runner
- **THEN** the digest records `mode: "local-run"`

### Requirement: Bounded, resilient walk

The walk SHALL exclude `node_modules`, build output, and dotfolders, and SHALL bound the work it does. When limits are reached or files cannot be parsed, it MUST still produce a valid digest and record a `truncated` or coverage indicator rather than failing.

#### Scenario: Large or partially unreadable repo still yields a digest

- **WHEN** the repository exceeds the walk's file or size limits, or contains files that cannot be parsed
- **THEN** the system writes a valid `.powercodex/digest.json`
- **AND** records that coverage was partial

