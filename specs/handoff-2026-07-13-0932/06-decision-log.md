# 06 · Decision Log

Numbered, binding unless overturned by Manfred. Each entry: decision, rationale, rejected alternative(s). Executors append here when a task forces a deviation.

**D1 — Preview = real vite dev server in the Canvas iframe, spawned by a new `preview.js`.**
Rationale: Manfred's requirement verbatim ("show the code or the end product in localhost with local data"); vite is already the generated stack, HMR is free; the Canvas iframe plumbing already exists.
Rejected: static build + file serve (no HMR, slower loop); embedding a bundler in the desktop app (heavy, duplicates the project's own toolchain); reusing `/api/file` wrapping (documents, not a running app).

**D2 — Publish mechanism is `pac code init` + `pac code push`, even though the original ask said `npx power-apps push`.**
Rationale: the repo just migrated its own strings from `npx power-apps push` to `pac code push` (uncommitted diff, selftest updated); pac is the current Microsoft-supported CLI for Code Apps and owns the config schema. The *intent* (one-click push to Power Platform) is honored; the *mechanism* follows the platform. If Manfred specifically wants the npx wrapper, it shells to the same place — one-line change in `pushCodeApp`.
Rejected: hand-authoring `power.config.json` (pac owns the schema — per the existing ponytail note in loop.js).

**D3 — Local/Dataverse data seam via a generated `src/data` adapter with a build-time env switch.**
Rationale: satisfies "preview with local data not connected to dataverse" while keeping screens identical in both modes; mirrors the Lovable/Supabase pattern the persona already understands; testable without a tenant.
Rejected: runtime toggle in-app (citizen developer shouldn't see a data-source switch); mocking the Power Apps SDK network layer (fragile, undocumented); Dataverse-only with a local emulator (no such emulator exists).

**D4 — Kill demo theater in real mode (injected defect, unlabeled revert-as-fix); keep it only under `simulate`.**
Rationale: the engine's own honesty contract ("never a fabricated success") is violated by its demo script; a production user watching a fake defect get "healed" — or a custom screen silently reverted to a generic table — loses exactly the trust the product sells.
Rejected: keeping theater behind a flag in real mode (flags leak; trust doesn't recover).

**D5 — Desktop scaffold unifies on `templates/starter/`, not `scaffold.js`'s generic template.**
Rationale: one scaffold to maintain; desktop projects get the harness, tests, and (after 2.1) the data seam from birth; `verify-generated-project.js` already guards this shape.
Rejected: three coexisting scaffolds (drift guaranteed); teaching `scaffold.js` the starter's contents by copy (that *is* the drift).

**D6 — Vendor Playwright with the desktop app.**
Rationale: Rule 3 (full e2e loop) is non-negotiable and currently physically impossible in the packaged app; "zero dependencies" is a virtue of the library engine, not the shipped product.
Rejected: on-demand `npm i playwright` into user projects (slow first-run surprise, offline-hostile); keeping e2e optional (violates Rule 3).

**D7 — Publish is gated on a green generated-suite e2e run.**
Rationale: Rule 3 says do not report completion until the loop is clean; wiring the gate into the Publish button makes the rule structural instead of behavioral.
Rejected: advisory warning on red (citizen developers click through warnings).

**D8 — V1 ships unsigned (documented Gatekeeper/SmartScreen path); signing is a fast-follow, not a blocker.**
Rationale: internal top-down distribution (spec: pushed by IT/CoE, who can whitelist); certificates are an org/procurement decision Manfred must make, not a code task. ⛔ blocked-honest: needs Manfred's org context.
Rejected: blocking V1 on cert procurement.

**D9 — Handoff package lives in `specs/handoff-<timestamp>/`; the reflective skill lives in `.claude/skills/reflective-mentor/`.**
Rationale: Manfred: "the context of this project should all be in the @specs folder" → documents go there; a skill must live where the harness discovers skills, so it sits in `.claude/skills/` and *points* at specs/.
Rejected: skill content duplicated into specs/ (two sources of truth).

**D10 — Chat persistence reuses the append-and-replay pattern (`.powercodex/chat.json`), not a database.**
Rationale: the bus already proves the pattern; single-user desktop scope (spec non-goal: multi-tenant).
Rejected: SQLite/electron-store (new dependency for a solved problem).

**D11 — Order of build: preview (Ph1) before data seam (Ph2) before publish (Ph3).**
Rationale: preview is the product's heartbeat and unblocks the e2e loop; the data seam makes publish meaningful (an app with hardcoded samples isn't worth pushing); publish last because it has the most human-gated surface (tenant, auth, Rule 1).
Rejected: publish-first (impressive demo, hollow product — and it's the path most gated on human access).

**D12 — Existing engine patterns are canonical for new code: `_pac`-style injected boundaries for anything spawning processes, bus `emit` for progress, honest-degrade returns (`{ok:false, message}` in plain language) for every failure.**
Rationale: consistency is what makes the codebase reviewable by smaller models; these patterns are already selftested.
Rejected: per-executor stylistic freedom.

**D13 — The preview's "local db" is an in-browser persisted store: `LocalDataSource` seeds from `seed.json` on first run, then serves full CRUD out of localStorage (per-entity keys).**
Rationale: Manfred's requirement verbatim (2026-07-13: "the actual app in a local host on a local db of the app so the user have a more interactive view where they can see how the app works"); read-only seed mocks fail this — interactions must persist across reloads to feel like a working app. localStorage is zero-dependency, synchronous, survives reloads, and gets per-app isolation for free because each vite preview port is a distinct browser origin. The `DataSource` interface stays identical to the Dataverse source, so screens don't know which mode they're in (D3 preserved). A "Reset sample data" affordance restores `seed.json`.
Rejected: read-only `seed.json` reads (not interactive — the original Phase 2 wording); a spawned DB sidecar such as json-server or SQLite (new process + dependency to babysit for single-user sample data, and a second server the honest-degrade contract would have to cover); IndexedDB (async ceremony and schema versioning for data measured in kilobytes; revisit only if an app's sample data outgrows localStorage's ~5MB).
