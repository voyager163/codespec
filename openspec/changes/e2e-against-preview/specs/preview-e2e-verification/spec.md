## ADDED Requirements

### Requirement: The loop runs the project's real e2e specs against the local preview

When Playwright is available and the project has one or more `e2e/*.spec.ts` files, the lifecycle loop SHALL run those specs against a real local preview server and report their genuine pass/fail outcome. This tier SHALL require no tenant sign-in, no MDM/managed-browser session, and no published app — it operates entirely against the maker's own machine.

#### Scenario: Real specs run and report genuinely

- **WHEN** Playwright is installed and `e2e/` contains one or more spec files
- **THEN** the loop starts (or reuses) the local preview server and runs those specs against it
- **AND** the reported pass/fail for each spec reflects what Playwright actually observed, not a scripted or hardcoded outcome

#### Scenario: No fabricated spec names

- **WHEN** the loop reports which specs ran
- **THEN** every reported spec name corresponds to a real file under `e2e/`
- **AND** no hardcoded placeholder spec name is reported that does not exist on disk

#### Scenario: Honest degrade when Playwright or the preview is unavailable

- **WHEN** Playwright is not installed, or the preview server cannot start
- **THEN** the loop does not fabricate a pass or a failure
- **AND** it reports plainly that local e2e verification did not run and why

### Requirement: A generated screen ships its own e2e spec

When `codegen` generates a screen from a derived schema, it SHALL also generate (or offer to generate) an e2e spec that exercises that screen's real route and at least one of its fields — so the verification surface covers what the maker actually asked for, not only the starter's default demo.

#### Scenario: The generated spec targets the generated screen

- **WHEN** a screen is generated for entity `loans` at route `/loans` with a `title` field
- **THEN** the generated e2e spec navigates to `/loans`
- **AND** it asserts on content or controls derived from the schema (e.g. the entity's label, a visible field)

#### Scenario: The starter's own demo spec is left alone

- **WHEN** a screen is generated
- **THEN** the starter's existing `e2e/home.spec.ts` (or equivalent default demo spec) is not modified or removed by this generation step

### Requirement: Real e2e results feed the existing self-heal path unchanged

The self-heal, fix-mode, and no-progress-detector machinery already driven by `e2eTester`'s return shape (`{ failures, coverage, passed }`) SHALL continue to operate exactly as today, now driven by genuine results instead of the honest-but-inert pass-through this change replaces.

#### Scenario: A genuine failure still triggers self-heal

- **WHEN** a real Playwright run reports a failing spec
- **THEN** the loop's self-heal path runs exactly as it does for any other failure source (build gate, MDM smoke test)
- **AND** the failure message identifies the real spec and assertion that failed
