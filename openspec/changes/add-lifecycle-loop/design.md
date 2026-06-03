## Context

The lifecycle loop must be watchable and controllable with no infrastructure: it runs inside a developer's editor, has no messaging gateway, and ships inside a generated project. It also must not depend on a Power Platform tenant to be demonstrated, since the build/test engines drive a managed browser that needs MFA.

## Goals

- Live monitoring of every loop stage with no server framework and no third-party dependencies.
- A single source of truth for state that both the dashboard and any future tooling can read.
- Real control (start/pause/approve, intake, rights) from the dashboard, not just a view.
- A clean seam so simulated engines can be replaced with real Playwright-for-MDM adapters.

## Decisions

### Files-as-state via an append-only bus

Every agent appends newline-delimited JSON to `.powercodex/live/status.json`. Nothing mutates past events, so history stays browsable and auditable in git terms. A `deriveState(root)` function reduces the event log (plus `Approved_rights/approval.json` and `Learning_Experience/`) into one JSON snapshot. This avoids a database and keeps the medium reviewable.

### Polling over sockets

The dashboard is served by Node's built-in `http` module and polls `/api/state` every 1.2s. Polling was chosen over WebSocket/SSE for portability and zero dependencies; it also sidesteps browser `file://` fetch restrictions because the page is served over `http://`.

### Simulation-first engines

`buildExecutor` and `e2eTester` accept an async `emit` and return structured results. In simulation they produce deterministic outcomes (including one injected defect that triggers the self-heal path) while emitting the exact event stream the real adapters would. Swapping the two functions for real managed-Edge Playwright adapters changes nothing else.

### Consent gate as a precondition, not a suggestion

`Approved_rights/approval.json` is read before build and push. In real (non-simulated) mode a false `allowBuild`/`allowPush` flag stops the loop and escalates. Simulation bypasses the tenant but still records the gate.

### CommonJS marker

The starter is `"type": "module"`, so the tool ships with its own `tools/lifecycle/package.json` (`"type": "commonjs"`) to keep its `require`-based modules working when copied into an ESM project.

## Risks / Trade-offs

- Polling adds latency (~1.2s) versus push; acceptable for a human-watched dashboard.
- Simulated engines can drift from real portal behavior; mitigated by keeping the adapter interface narrow and event-driven.
- The status bus grows unbounded within a run; acceptable because runs are short and the file is gitignored, but a future change may add rotation/compaction.

## Migration

No migration. The tool is additive; generated projects gain new scripts and a gitignored runtime directory.
