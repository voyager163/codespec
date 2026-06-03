# PowerCodex Automation (Playwright-for-MDM)

Two engines that share one managed-browser bootstrap. **Engine 1** builds real Power Platform assets in the maker portal; **Engine 2** tests the running app and self-heals via OpenSpec. Both honor the `Approved_rights/` gate.

```
automation/
├── shared/            # used by BOTH engines
│   ├── mdm-browser.ts     # launch managed Edge, persistent context
│   ├── auth.setup.ts      # one-time login → saves storageState
│   ├── portal-selectors.ts# maker-portal locators (versioned)
│   ├── env.ts             # env URL, tenant, app id, secrets via .env
│   └── approved-rights.ts  # reads Approved_rights/approval.json gate
├── build-executor/    # Engine 1 — cowork / build
│   ├── playwright.build.config.ts
│   ├── run-task.ts        # reads a task contract → runs the action
│   ├── actions/          # reusable portal operations
│   └── tasks/            # *.task.json contracts dropped by the AI
└── e2e-suite/         # Engine 2 — testing + self-heal
    ├── playwright.e2e.config.ts
    ├── specs/            # app e2e specs (mirror the approved MVP)
    └── loop/
        ├── orchestrator.ts      # the test → fix → retest loop
        └── failure-to-change.ts # failure → OpenSpec change scaffold
```

## Status

This is a **scaffold**. The files compile against `@playwright/test` (already a dev dependency) but the portal selectors and tenant calls are marked `TODO` — wire them to your environment. The PowerCodex Lifecycle tool (`tools/lifecycle/`) drives these engines; until they are wired it runs them in **simulation**.

## First run

```bash
npm run mdm:auth          # one-time: sign in once, session saved to storageState
npm run build:task <file> # Engine 1: execute a task contract in the maker portal
npm run e2e:loop          # Engine 2: test the app, self-heal until green
```

Authentication is human-in-the-loop once (MFA), then unattended until the session expires. No credentials are stored in the repo — only the gitignored `storageState`.
