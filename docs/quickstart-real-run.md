# Quickstart — running PowerCodex for real against your app

This is the exact order of operations to take a **pre-existing app** through PowerCodex with the **real** engines (managed Edge → Power Platform). Everything before "Go real" works without Playwright; the real run needs it.

> Today's reality: **intake is fully real** (stories + MVP from your code, reviewed and frozen). **Engine 1 enters Power Platform for real** (navigates the maker surfaces) but does not yet author assets — those DOM steps are grown per-app as you build. **Engine 2 (e2e smoke test) is real.**

---

## 0. One-time machine setup
- **Node ≥ 20.19** (you're on v24 — fine).
- **Microsoft Edge**, with a profile **already signed in to your tenant**.
- For the real engines only: in your app, `npm i -D playwright`.

## 1. Add PowerCodex to your app & read the code
```bash
cd <your-app>
npm run lifecycle -- import --analyze
```
Writes `.powercodex/digest.json` (routes, components, data calls — each citing its source file). Read-only; never touches your source.

## 2. Derive, review, and freeze the spec
```bash
npm run lifecycle -- stories            # user stories grounded in your code
npm run lifecycle:serve -- --open       # Studio → Plan step
```
In the Studio: edit any story → **Refine from my edits** → **Approve & freeze**. A frozen spec (`.powercodex/freeze.json`) is the benchmark the loop builds against and **never rewrites** until you **Unlock for major change**.

## 3. Pick the Edge profile the real engines will always use
```bash
npm run lifecycle -- profiles                 # lists your signed-in Edge profiles + emails
npm run lifecycle -- profiles use <email|number|directory>
```
Example: `npm run lifecycle -- profiles use you@tenant.com`. This persists `browserProfile` into `Approved_rights/approval.json`, so **every** `--real` run (build entry + e2e runner) attaches to that profile. ★ marks the selected one.

## 4. Grant rights (the consent gate)
Edit `Approved_rights/approval.json` and set the flags you want **on** (they default to `false` on purpose):
- `allowBuild` — let Engine 1 enter Power Platform.
- `allowPush` — let the runner push the app.

## 5. Go real
**Close all normal Edge windows first** (the engine launches Edge with remote-debugging on port 9222; an already-open Edge blocks the attach).
```bash
npm run lifecycle -- loop --real --app-url https://<your-app> --env <environmentId>
```
- `--app-url` — the live app the e2e engine smoke-tests (a Power Apps play URL, or a local dev server).
- `--env` — your Power Platform environment, so Engine 1 lands directly in that environment's Tables/Flows.

Watch it live: keep `npm run lifecycle:serve` open in another terminal — the dashboard follows along, including the engine banner and the loop strip.

---

## What "real" means today (no surprises)
| Step | Real? |
| --- | --- |
| Read your code → stories/MVP, review → freeze | ✅ real |
| Pick & persist the Edge profile | ✅ real |
| Engine 1 — **enter** Power Platform (navigate maker surfaces, verify loaded) | ✅ real |
| Engine 1 — **author** the table/column/flow (DOM steps) | ⏳ built per-app as you go |
| Engine 2 — e2e smoke test of the live app | ✅ real |

## If something goes wrong
- **"CDP endpoint never came up"** → an Edge window was already open; fully close Edge and retry.
- **Lands on a login page in the maker portal** → the chosen profile isn't signed in to that tenant; re-run `profiles use` with the right email.
- **"Real e2e needs a live app URL"** → pass `--app-url`.
- **Build stops with "allowBuild=false"** → grant the right in `Approved_rights/approval.json` (step 4).
