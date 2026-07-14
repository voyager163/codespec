## 1. Real spec discovery

- [ ] 1.1 In `tools/lifecycle/lib/loop.js`, replace the hardcoded placeholder spec list with real discovery of `*.spec.ts` files under the project's `e2e/` directory.
- [ ] 1.2 Handle the empty case honestly: no spec files → report that no local e2e specs exist, do not fabricate a pass or a failure.

## 2. Local-preview e2e tier

- [ ] 2.1 In `tools/lifecycle/lib/engines.js`'s `makeRealEngine`, add a local-preview e2e step to `e2eTester`: when `hasPlaywright(root)` is true and discovered specs exist, start/reuse `preview.js`'s dev server and run the specs via Playwright's CLI.
- [ ] 2.2 Parse Playwright's results (e.g. JSON reporter) into the existing `{ failures, coverage, passed }` shape so the self-heal/fix-mode path consumes it unchanged.
- [ ] 2.3 Honest degrade: when Playwright isn't installed, or the preview server can't start, or no browser binary is available, report why local e2e didn't run — never fabricate a result.
- [ ] 2.4 Keep this tier independent of the existing MDM `browser.e2eTester` tier — both may run in the same rotation without interfering.

## 3. Generated e2e spec

- [ ] 3.1 In `tools/lifecycle/lib/codegen.js`, add a function that generates a schema-scoped e2e spec (route loads, entity label or first field visible) alongside `generateScreen`/`ensureDataSeam`.
- [ ] 3.2 Wire it into `buildCodeTasks` so a generated screen ships its spec without touching `e2e/home.spec.ts` or any other existing spec file.

## 4. Verify

- [ ] 4.1 Extend `tools/lifecycle/lib/selftest.js`: real spec discovery returns actual `e2e/` filenames (not the old placeholders); the generated spec references the derived schema's route/field; a genuine Playwright failure (inject a deliberately-broken generated screen in a throwaway project) surfaces through `e2eTester`'s failure list and triggers self-heal.
- [ ] 4.2 Run `npm run lifecycle:selftest` and confirm it passes.
- [ ] 4.3 Generate a real throwaway app, run its `npm run e2e` directly, and confirm the generated spec passes against the actual generated screen.
- [ ] 4.4 Run `openspec validate e2e-against-preview` and confirm the change is valid.
