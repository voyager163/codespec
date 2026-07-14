## ADDED Requirements

### Requirement: The starter lifecycle tree is generated, not hand-maintained

`templates/starter/tools/lifecycle/` SHALL be produced by copying `tools/lifecycle/` through a sync script, excluding only runtime/generated directories (`node_modules`, `.powercodex`, `.profiles`, `.git`, `dist`). Direct hand-edits to files inside `templates/starter/tools/lifecycle/` SHALL NOT be the source of truth — a re-run of the sync SHALL overwrite them with the dev copy's content.

#### Scenario: A fresh sync reproduces the starter tree byte-for-byte

- **WHEN** the sync script runs against the current `tools/lifecycle/`
- **THEN** every source file under `templates/starter/tools/lifecycle/` matches its `tools/lifecycle/` counterpart exactly
- **AND** only runtime/generated directories are skipped

#### Scenario: A feature added to the dev copy reaches the starter via sync

- **WHEN** a new file or an updated function is added to `tools/lifecycle/`
- **AND** the sync script is run
- **THEN** the same file/function appears in `templates/starter/tools/lifecycle/` with identical content
- **AND** no manual porting step was required

### Requirement: Starter drift is caught automatically

The system SHALL provide a check that fails when `templates/starter/tools/lifecycle/` differs from what a fresh sync of `tools/lifecycle/` would produce. This check SHALL run as part of the existing lifecycle self-test suite so drift is caught in normal development, not discovered by manual comparison.

#### Scenario: Drift is detected

- **WHEN** a file under `templates/starter/tools/lifecycle/` is hand-edited in a way the sync would overwrite
- **AND** the drift-guard check runs
- **THEN** it fails, naming the file(s) that differ from a fresh sync

#### Scenario: A synced tree passes clean

- **WHEN** `templates/starter/tools/lifecycle/` was produced by the sync script and nothing has hand-edited it since
- **AND** the drift-guard check runs
- **THEN** it passes

### Requirement: Dev-only content self-skips at runtime; the sync excludes no source

The sync SHALL copy every source file wholesale, with no content-level exclusion list. Content that cannot function inside an already-scaffolded app — for example, dev/desktop-only test blocks that resolve `templates/starter` itself (which does not exist inside a scaffolded project) — SHALL be guarded at runtime (e.g. `if (starterDir())`) so the identical file is correct in both the dev tree and the synced starter tree. This keeps every file byte-for-byte in sync (which the drift guard requires) without any sync-time surgery that would silently drop real features.

#### Scenario: A dev-only test block self-skips instead of crashing the starter

- **WHEN** the selftest contains a check that requires scaffolding a new project from `templates/starter` (a dev/desktop-only concern)
- **THEN** that check is wrapped in a runtime guard that is false inside a scaffolded app
- **AND** the starter's selftest runs to completion without requiring modules or paths that only exist in the dev repo, using the same file as dev

#### Scenario: A real feature is never accidentally excluded

- **WHEN** a file implements a feature usable inside a generated app (e.g. live preview, Code App registration, self-heal fix-modes)
- **THEN** that file is copied verbatim by the sync
- **AND** the starter ships that feature after the next sync
