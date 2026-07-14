## Why

Today every generated app is the same hardcoded five-field record — `type Item = { id, title, owner, due, status }` ([codegen.js:298](../../../tools/lifecycle/lib/codegen.js#L298)) — and `entityFrom`/`seedFor` only swap the *noun* and the seed rows against that fixed shape ([codegen.js:247](../../../tools/lifecycle/lib/codegen.js#L247), [:278](../../../tools/lifecycle/lib/codegen.js#L278)). This is the top production blocker on the readiness path: a citizen developer who asks for an "equipment loan tracker" and one who asks for a "customer feedback log" receive the identical table with a different label. Until the generated **schema, screen, and seed data are derived from the user's intake**, the product's core promise — describe an app, get *that* app — is not real, and every downstream surface (publish, e2e, packaging) is polishing a generic payload.

## What Changes

- Introduce a **schema model** derived from the approved intake: an entity (or entities) with named, typed fields (string / number / date / choice / boolean / currency) instead of the fixed `Item` shape.
- `generateScreen` renders the **real fields** of the derived schema — columns, form inputs, and status/choice pills come from the schema, not the hardcoded id/title/owner/due/status set.
- `ensureDataSeam` emits a TypeScript type and adapters matching the **derived** schema; `seedFor` produces seed rows that conform to that schema. The existing local↔Dataverse seam mechanism is reused unchanged — only the *shape* it carries becomes dynamic.
- The AI-authoring path (`aiAuthor`) receives the derived schema as grounding so richer screens stay consistent with the data model; the deterministic path remains the honest fallback.
- Capability flags (filter/sort/highlight) continue to work, now expressed against the derived fields.
- **No behavioral change to demo-theater, publish, e2e, or onboarding** — those are separate follow-on changes on the readiness path. This change is codegen-only.
- Preserve the zero-dependency constraint and the "never theater" contract: schema derivation must degrade honestly (fall back to a single reasonable entity) rather than fabricate.

## Capabilities

### New Capabilities
- `app-code-generation`: how the lifecycle engine turns an approved intake into Code App source — deriving a typed schema, generating screens and a data seam that conform to it, and reporting honestly when it cannot.

### Modified Capabilities
<!-- None. code-grounded-intake still supplies the intake unchanged; the data seam mechanism is reused. No existing spec's requirements change. -->

## Impact

- **Code**: `tools/lifecycle/lib/codegen.js` — `generateScreen`, `entityFrom` (becomes schema derivation), `ensureDataSeam`, `seedFor`, `aiAuthor` grounding, `buildCodeTasks` wiring.
- **Templates**: the emitted `types.ts` / `local.ts` / `dataverse.ts` / `seed.json` shape under `templates/starter/src/data/` (the seam files whose *type* is generated).
- **Tests**: `tools/lifecycle/lib/selftest.js` — new assertions that two different intakes yield two different schemas/screens, and that seed rows validate against the emitted type.
- **Dependencies**: none added (zero-dep constraint holds).
- **Out of scope**: relationships/joins across multiple entities beyond a simple parent noun, migrations, and any Dataverse maker-portal automation.
