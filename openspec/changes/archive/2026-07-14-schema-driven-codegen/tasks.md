## 1. Schema derivation

- [x] 1.1 Add `deriveSchema({ goal, displayName, tasks, provider? })` to `codegen.js` returning `{ entity, typeName, fields[], fallback }`; absorb `entityFrom`'s noun extraction into it.
- [x] 1.2 Implement the deterministic keyword→type heuristics (date / currency / choice / number / boolean / string) over goal + tasks text.
- [x] 1.3 Implement the honest thin-intake fallback (minimal `{ name, note, status }`, `fallback: true`) and surface the fallback in the emitted event stream.
- [x] 1.4 Constrain fields to the closed type set; drop any field with an unknown type.

## 2. Data seam emission

- [x] 2.1 Rewrite `ensureDataSeam` to take the schema and emit `type <TypeName>` from the field→TS map (string/number/currency→number/date→ISO string/boolean/choice→literal union), keeping synthetic `id: number`.
- [x] 2.2 Generate the local and Dataverse adapters against the emitted type (reuse the existing seam mechanism; only the shape changes).

## 3. Seed generation

- [x] 3.1 Change `seedFor(entity)` → `seedFor(schema)`; fill each field by type so rows conform to the emitted type by construction.
- [x] 3.2 Ensure `seed.json` validates against the emitted type (no extra/missing fields, correct value types).

## 4. Screen generation

- [x] 4.1 Rewrite `generateScreen` to iterate `schema.fields` for columns and form inputs (no hardcoded field list).
- [x] 4.2 Render `choice` as pills, `boolean` as toggle, format `date`/`currency`.
- [x] 4.3 Bind capability flags (filter/sort/highlight) to field names present in the schema.

## 5. AI-author grounding

- [x] 5.1 Pass the derived schema into the `aiAuthor` task context.
- [x] 5.2 Extend `validateTsx` to reject authored output that references fields absent from the schema; fall back to the deterministic screen and report honestly.

## 6. Wiring

- [x] 6.1 Thread the schema through `buildCodeTasks` so derivation happens once and screen + seam + seed all consume the same object.
- [x] 6.2 Update `module.exports` for any renamed/added functions.

## 7. Tests

- [x] 7.1 Update `selftest.js`: replace fixed-`Item` assertions with assertions that two different intakes produce different schemas/screens.
- [x] 7.2 Add a check that every `seed.json` row conforms to the emitted type.
- [x] 7.3 Add a check that the deterministic fallback fires and is reported when the intake is thin.

## 8. Verification

- [x] 8.1 `npm run lifecycle:selftest` green.
- [x] 8.2 Generate two apps from two distinct prompts and confirm — via the live preview — they render different fields, then `tsc --noEmit` passes on both.
