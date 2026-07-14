## Context

`tools/lifecycle/lib/codegen.js` currently hardcodes a single record shape. `entityFrom(goal, displayName)` ([codegen.js:247](../../../tools/lifecycle/lib/codegen.js#L247)) returns only a noun; `generateScreen(...)` ([:69](../../../tools/lifecycle/lib/codegen.js#L69)) renders a fixed `id/title/owner/due/status` table; `ensureDataSeam(...)` ([:262](../../../tools/lifecycle/lib/codegen.js#L262)) emits `type Item = { id, title, owner, due, status }` ([:298](../../../tools/lifecycle/lib/codegen.js#L298)); `seedFor(entity)` ([:278](../../../tools/lifecycle/lib/codegen.js#L278)) fills that shape with domain-flavored rows. The data seam mechanism (local + Dataverse adapters, `seed.json`) already exists and works — only the *shape* it carries is static. Constraints: zero runtime dependencies, deterministic honest fallback (never theater), and the AI-authoring path (`aiAuthor`) stays optional on top of a deterministic floor.

## Goals / Non-Goals

**Goals:**
- Introduce one internal **schema object** that is the single source of truth for the screen, the emitted TS type, the adapters, and the seed.
- Derive that schema from the approved intake **deterministically** (no provider required for the floor), enriched by the provider when available.
- Thread the schema through `generateScreen`, `ensureDataSeam`, `seedFor`, and `aiAuthor` so two different intakes yield genuinely different apps.
- Keep the emitted seam files valid TypeScript and keep `seed.json` conformant to the emitted type.

**Non-Goals:**
- Multiple related entities, joins, or foreign keys (single entity per app in this change).
- Migrations or schema evolution across rebuilds.
- Any Dataverse maker-portal automation (explicitly cut).
- Replacing the deterministic path with an LLM-only path.

## Decisions

**1. One schema object, derived once, passed everywhere.**
Introduce `deriveSchema({ goal, displayName, tasks, provider? })` returning: an `entity` (lower singular noun), a `typeName` (PascalCase), a `fields` array of `{ name, type, values? }`, and a `fallback` boolean. `entityFrom` is absorbed into this (it already extracts the noun). Field types are limited to the closed set `string | number | date | choice | boolean | currency`; `choice` carries a `values` array.

**2. Deterministic derivation is the floor; the provider only enriches.**
The deterministic pass extracts candidate fields from the goal/tasks via keyword heuristics (e.g. "due"/"deadline" → `date`, "amount"/"cost"/"$" → `currency`, "status"/"state"/"approve" → `choice`, "count"/"quantity" → `number`, yes/no phrasing → `boolean`; everything else → `string`). If fewer than one non-key field is found, set `fallback: true`, emit a minimal `{ name (string), note (string), status (choice) }`, and *report* the fallback. When a provider is present, `aiAuthor` may propose additional fields, but every proposed field is validated against the allowed type set and dropped if unknown — the schema never contains a type the generators can't emit.

**3. Type emission is a pure map from field type → TS.**
`string→string`, `number→number`, `currency→number`, `date→string` (ISO `YYYY-MM-DD`), `boolean→boolean`, `choice→` a string-literal union of its `values`. `ensureDataSeam` builds the `type <TypeName>` block, the local adapter, and the Dataverse adapter from this map. Every record keeps a synthetic `id: number` primary key (unchanged).

**4. Seed generation conforms to the schema.**
`seedFor(schema)` produces N rows where each field is filled by type (string → domain-flavored sample, date → near-future ISO, currency/number → plausible values, choice → cycled through `values`, boolean → alternating). Because it reads the same schema the type is emitted from, rows validate by construction.

**5. Screen renders from `schema.fields`.**
`generateScreen({ ..., schema })` iterates `schema.fields` for columns and form inputs; `choice` fields render as pills, `boolean` as a checkbox/toggle, `date`/`currency` formatted. Capability flags bind to field names present in the schema (e.g. `highlight` targets a value of the first `choice` field). No field list is hardcoded.

**6. `aiAuthor` receives the schema as grounding and is validated against it.**
The task context passed to the provider includes the derived schema; authored TSX that references fields not in the schema fails validation (extend `validateTsx`) and the deterministic screen is used instead — preserving the honest fallback.

## Risks / Trade-offs

- **Heuristic derivation quality.** Without an LLM, field extraction from free text is coarse; it may miss or mislabel fields. Mitigation: the provider-enriched path improves it, and the deterministic floor is honest about being a floor (`fallback` flag surfaced), never fabricating.
- **Choice-value extraction is the hardest case** — enumerated values are rarely stated explicitly. Trade-off: when values can't be extracted, degrade the field to `string` rather than invent a value set.
- **Selftest churn.** Existing self-tests assume the `Item` shape; they must be updated to assert *variation* between two intakes instead of a fixed shape. This is intended — the old assertions encoded the bug.
- **Single-entity limit** may feel restrictive for apps that clearly want two tables; accepted for this change to keep the seam and screen generation tractable, with multi-entity deferred.
- **Backward compatibility:** apps previously generated as `Item` are not migrated; this change affects newly generated apps only.
