# app-code-generation Specification

## Purpose
TBD - created by archiving change schema-driven-codegen. Update Purpose after archive.

## Requirements

### Requirement: Derive a typed schema from the approved intake

The system SHALL derive a data schema — an entity name plus a set of named, typed fields (from the field types: string, number, date, choice, boolean, currency) — from the approved intake, rather than emitting a fixed record shape. The derived schema SHALL be the single source of truth that the screen, the data seam type, and the seed data are all generated from.

#### Scenario: Distinct intents produce distinct schemas

- **WHEN** one intake describes an "equipment loan tracker" and another describes a "customer feedback log"
- **THEN** the two generated apps have different entity names and different field sets
- **AND** neither reuses the legacy fixed `id/title/owner/due/status` shape unless the intake actually implies those fields

#### Scenario: Fields carry types, not just names

- **WHEN** an intake implies a due date, an amount, and a status with a fixed set of values
- **THEN** the derived schema types them as `date`, `currency`, and `choice` (with the enumerated values) respectively
- **AND** the generated TypeScript type reflects those types

#### Scenario: Thin intake degrades honestly

- **WHEN** the intake is too sparse to derive multiple fields
- **THEN** the system falls back to a single reasonable entity with a minimal field set
- **AND** it reports that a fallback shape was used, rather than fabricating fields the user never implied

### Requirement: Generate screens that render the derived schema

The system SHALL generate the app screen so that its columns, form inputs, and any status/choice affordances are produced from the derived schema's fields — not from a hardcoded field list. Capability flags (filter, sort, highlight) SHALL operate against the derived fields.

#### Scenario: Screen reflects the schema's fields

- **WHEN** a schema defines fields `borrower (string)`, `item (string)`, `dueDate (date)`, `returned (boolean)`
- **THEN** the generated screen shows those fields as its columns and form inputs
- **AND** does not show fields absent from the schema

#### Scenario: Choice field renders as selectable states

- **WHEN** the schema includes a `choice` field with enumerated values
- **THEN** the generated screen renders those values as pills/options
- **AND** a capability flag such as `highlight` targets a value that exists in that field

### Requirement: Emit a data seam that conforms to the derived schema

The system SHALL emit the data seam (the generated TypeScript type, the local adapter, the Dataverse adapter, and `seed.json`) so that every emitted artifact matches the derived schema. The existing local↔Dataverse seam mechanism SHALL be reused; only the shape it carries becomes dynamic.

#### Scenario: Emitted type matches the schema

- **WHEN** a schema is derived
- **THEN** the emitted TypeScript record type has exactly the schema's fields with matching types
- **AND** the local and Dataverse adapters are generated against that same type

#### Scenario: Seed rows validate against the emitted type

- **WHEN** seed data is generated for the derived schema
- **THEN** every seed row conforms to the emitted type (correct fields, correct value types)
- **AND** the preview renders the seeded rows without shape mismatches

### Requirement: Ground AI authoring in the derived schema with an honest fallback

When a provider is available, the system SHALL pass the derived schema to the AI-authoring path so any richer generated screen stays consistent with the data model. When the provider is unavailable or returns invalid output, the system SHALL fall back to the deterministic schema-driven screen and report that it did so, never presenting fabricated or simulated success as real output.

#### Scenario: Provider available, output consistent with schema

- **WHEN** a provider authors a screen and the schema defines a given field set
- **THEN** the accepted authored screen references only fields present in the derived schema
- **AND** authored output that references unknown fields is rejected in favor of the deterministic screen

#### Scenario: Provider unavailable, honest deterministic fallback

- **WHEN** no provider is available or the authored output fails validation
- **THEN** the system generates the deterministic schema-driven screen
- **AND** reports the fallback honestly (no fabricated success, consistent with the "never theater" contract)
