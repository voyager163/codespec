# PowerCodex — Ship Runbook (the human-only steps)

_Last updated: 2026-07-16_

Everything in this file needs credentials, a tenant, an MFA prompt, or a decision only
you can make. The code/security work is done and verified offline (see
[readiness-gaps.md](./readiness-gaps.md)); this is the remainder to actually ship
**PowerCodex the tool** and, optionally, validate against a live tenant.

Status of the automated pass (2026-07-16):
- ✅ Generated project `npm install` + `npm run build` green, **0 vulnerabilities**.
- ✅ Starter `uuid` vuln pinned via `overrides`.
- ✅ Repo security gate wired (`.github/workflows/ghas.yml` CodeQL + dependency-review, `.github/dependabot.yml`).
- ✅ PR #16 opened against `main`; Dependabot config validated; CodeQL run triggered.
- ⚠️ **PR #16 conflicts with `main`** — see step 1.

---

## 1. Reconcile the branch with `main` (decide first)

`claude/production-readiness-check-y17af8` is ~38 commits ahead but was cut from an older
`main`. `main` has since gained 8 commits it doesn't have, incl. **Release v0.3.0** and
**"Require init command for project creation"** — these conflict (initializer semantics +
openspec specs).

Decide the strategy:
- **Rebase onto main** (`git rebase origin/main`) — replays your 38 commits on top of the
  v0.3.0 release. Cleanest history; resolve the init-command conflict deliberately (main's
  "require init command" likely wins for the CLI dispatch).
- **Merge main in** (`git merge origin/main`) — one merge commit; same conflicts to resolve.

Key conflict to get right: the initializer command dispatch (`bin/create-powercodex.js` /
the "require init command" change). Resolving it wrong ships a broken CLI — verify with
`node scripts/verify-generated-project.js` after.

Then push and confirm PR #16 goes `MERGEABLE`.

## 1b. Residual CodeQL alerts (3 xss-through-dom) — need DOM-flow review

26 of 29 alerts are fixed + locally verified (6 path-injection in server.js via the
`within()` boundary check; 20 HTML-escaping via completed `esc()` + tag-strip hardening).
Three `xss-through-dom` remain — DOM text flowing to an `innerHTML` sink, which needs the
code-flow to fix correctly (don't guess — it can break the chat rendering):
- `tools/lifecycle/assets/chat.html:655` and its mirror `templates/starter/.../chat.html:655`
  (the maker chat UI, localhost-only). Trace the flagged source→sink in GitHub's alert
  detail; switch the sink from `.innerHTML =` to `.textContent =` if the value is plain
  text, or `esc()` the interpolated value before insertion.
- `docs/plans/intake-and-live-dashboard-redesign.html:371` — a static doc artifact, **not
  shipped** in the npm package (`files` excludes `docs/`); lowest priority, or dismiss.

Confirm on the next completed CodeQL run (the alert DB lagged behind the last pushes).

## 2. Let the security gate finish, then merge (Rule 2)

- Wait for **CodeQL** (`Analyze (javascript-typescript)`) + **dependency-review** to go green on PR #16.
- Fix anything flagged (any severity) before merging.
- Merge only when clean.

## 3. Publish the npm package

- `npm login` (as the `@elfredseow` owner).
- `npm publish --dry-run` one more time (already clean: 238 files, 331 kB).
- `npm publish` (publishConfig.access is already `public`).

## 4. Sign + notarize the desktop app (needs certs)

Absent in this environment — you supply:
- Windows/macOS signing: set `CSC_LINK` + `CSC_KEY_PASSWORD`.
- macOS notarization: `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, and
  `npm i -D @electron/notarize`.
- Real app icons: `desktop/build/icon.ico` and `icon.icns`.
- Optional auto-update: stand up a feed, set `POWERCODEX_UPDATE_FEED`, bundle `electron-updater`.
- Build the signed installer and confirm Gatekeeper/SmartScreen accept it.

## 5. (Optional) Live-tenant validation — Rules 1 & 3

Only if you want to prove the tenant paths end to end. **Use a non-production / sandbox
environment** — do not first-run these against a live production tenant. `pac` is already
authed on this machine; pick the profile deliberately (`pac auth list` / `pac auth select`).

- **Rule 1 (Dataverse):** in the chosen browser profile, create required tables via the
  make.powerapps.com UI (clear MFA yourself), copy the logical names, register them with
  `/codeapps:dataverse-specialist`.
- **Publish:** `pac code init` → `pac code push`; capture the live URL. **Check the
  URL-capture regex** in `tools/lifecycle/lib/publish.js` `extractAppUrl` against your real
  `pac code push` output.
- **Rule 3 (e2e):** `npm i -D playwright`, run the element-level e2e against the live URL,
  drive the heal loop until green.
