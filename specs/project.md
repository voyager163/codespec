# Section 1: Lean Canvas

**Problem**
- Citizen developers inside the organization have product ideas but cannot code, and have no time to learn to code.
- The organization's IT policy permits only PowerApps / Power Platform as an application platform — no general-purpose web/mobile stack is allowed.
- Existing "vibe coding" tools (Lovable, Bolt, Replit Agent) let non-coders prompt their way to an app, but none of them output PowerApps Code Apps — so citizen developers have no compliant self-serve path today.

**Solution**
An agentic coding desktop app: the user describes what they want in natural language ("vibe coding"), and an underlying agent harness plans, builds, and tests the app on their behalf — targeting the PowerApps Code Apps architecture so the output is automatically compliant with the org's platform policy.

**Key Metrics**
- Time from prompt to a working, testable app.
- % of generated apps that pass automated testing without manual code edits.
- Weekly active citizen developers / apps shipped per user.

**UVP**
The only agentic vibe-coding tool that builds directly on the PowerApps Code Apps architecture — so it is usable inside organizations where PowerApps is the only sanctioned platform, unlike generic competitors (Lovable, Bolt, Replit Agent) that target generic web stacks.

**Channels**
- Top-down rollout: pushed to citizen developers by IT / the Power Platform center of excellence, not discovered bottom-up.

**Cost**
- LLM/agent inference cost is carried by each individual user's own Claude Code license — not a shared, centrally metered org budget.
- Desktop app packaging/distribution and Power Platform environment/licensing costs.

**Revenue**
- Internal tool: cost-center funded, value measured in developer time saved (no direct revenue in V1).

---

# Section 2: Target User Personas

**Persona: The Busy Citizen Developer**
- Works inside an organization where PowerApps/Power Platform is the only approved app platform.
- Role-agnostic: every role/department is expected to build their own app for their own needs — this is not targeted at one department.
- Has a constant backlog of product/app ideas but cannot write code and has no time to learn to.
- Daily frustration: an idea stays an idea because turning it into a working app normally requires either learning to code or waiting on a scarce pro-dev/IT resource.
- Needs to go from idea → working app → tested app with as little manual effort and learning curve as possible; tolerance for a steep learning curve or complex tooling is very low.
- When something goes wrong, they'd rather work it out together with the AI than immediately escalate to a human — human help is a fallback, not the first move.
- Success looks like: describing what they want in plain language and getting back something they can try, test, and refine without touching code directly.

---

# Section 3: Product Requirement Document (PRD)

**Objectives**
- Let a non-technical user describe an app idea in natural language and receive a working PowerApps Code Apps application.
- Let that user test the resulting app without needing to read or write code.
- Ensure every generated app conforms to the organization's PowerApps-only platform policy by construction.

**User Stories**
- As a citizen developer, I want to describe my app idea in plain language, so that I don't need to learn to code to get started.
- As a citizen developer, I want the tool to handle the technical details of building the app for me, so that I can focus on what the app should do rather than how it's built.
- As a citizen developer, I want to test the app it builds for me, so that I can confirm it works before relying on it.
- As a citizen developer, I want the app it builds to run on PowerApps, so that it's automatically allowed under my organization's IT policy.
- As a citizen developer, I want the experience to require no prior training, so that I can start being productive immediately.
- As a citizen developer, when something goes wrong, I want the AI to explain the problem in plain, layman's terms and troubleshoot it together with me, so that I can decide how to steer the fix rather than being handed a raw error or a silent auto-fix.
- As a citizen developer, I want to import a prototype I already built elsewhere (e.g. Lovable, Replit), so that the AI can analyze it and start the conversation from what I already have instead of from scratch.
- As a citizen developer, I want my PRD to update automatically whenever the product changes, so that my spec stays aligned with what's actually been built and the project doesn't drift off track.

**Out of Scope / Non-Goals (Version 1)**
- Multi-tenant / enterprise administration: no org-wide admin console, role-based access control, or multi-tenant management. V1 supports a single citizen-developer working session, not fleet/organization administration.

---

# Section 4: Functional Specification Document (FSD)

**Data Models**
- **App Idea Prompt**: the user's natural-language description of the desired app (raw text, submission timestamp, owning user).
- **Generated App**: the produced PowerApps Code Apps application (source artifacts, target platform = PowerApps Code Apps, build status, last-tested status).
- **Test Result**: outcome of running automated tests against a Generated App (pass/fail, timestamp, linked Generated App, and the history of troubleshooting attempts made against it, so the AI can reference what's already been tried instead of repeating itself).
- **User Session**: a citizen developer's working session (user identity, active App Idea Prompt, active Generated App).
- **Environment Readiness Check**: the state of the local prerequisites needed to build (Claude Code signed in or not, VS Code installed or not, PowerPlatform VS Code extension installed or not, Power Platform CLI signed in or not), checked at onboarding.
- **Imported Prototype**: an existing prototype the user brings in from an external tool (e.g. Lovable, Replit) — which may range from a simple static HTML mockup to a full multi-file TypeScript application — plus the AI's analysis summary of it, used to seed the conversation and the resulting Generated App instead of starting blank.
- **Project PRD**: the living product requirements doc generated at project kickoff (objectives, user stories, non-goals) for a given Generated App, revision-tracked so it can be updated as the product changes.

**Required Third-Party API Endpoints**
- Power Platform / Dataverse APIs for provisioning and deploying PowerApps Code Apps.
- An LLM/agent provider API for turning natural-language prompts into build and test actions.

**System Behaviors**
- On receiving an App Idea Prompt, the system produces a Generated App targeting the PowerApps Code Apps architecture — never any other output platform, since PowerApps is the only platform the organization permits.
- On request, the system runs tests against the current Generated App and reports a Test Result the user can understand without reading code.
- The system surfaces build or test failures in plain language, not as raw code or stack traces, consistent with the non-technical persona.
- When a test or build fails, the system first attempts to auto-fix and re-test it; only if it cannot resolve the failure itself does it explain the problem in layman's terms and troubleshoot it together with the user, referencing what's already been tried and letting the user decide how to steer the next attempt.
- If the user provides a prototype they already built elsewhere (e.g. Lovable, Replit), the system analyzes it before anything else and starts the conversation from that analysis, instead of starting from a blank App Idea Prompt.
- The underlying build/fix/troubleshoot pipeline is composed from PowerCodex's existing skill set (the Code Apps specialist skills, the pre-build spec orchestrator, and the build/fix/audit harness modes) rather than a new bespoke pipeline, so improvements to those skills carry through automatically.
- Every step of the experience — onboarding, describing an idea, building, testing, and troubleshooting — is guided entirely through plain-language prompts and questions, with no separate manual, tutorial, or training step required before a first-time user can be productive.
- Whenever the Generated App changes (a new build, a troubleshooting fix, or a new prompt that alters direction), the system updates the Project PRD to reflect what changed, so the user's spec never silently drifts out of sync with the actual product.

**Onboarding / Environment Setup**
- On first use, the system runs an Environment Readiness Check and walks the user through fixing anything missing, in this order:
  - Checks whether the user is signed in to Claude Code; if not, prompts them to sign in.
  - Checks whether VS Code is installed; if not, asks the user to install VS Code first, since the PowerPlatform extension depends on it.
  - Checks whether the PowerPlatform extension for VS Code is installed; if VS Code is present but the extension is not, the system installs it automatically.
  - Checks whether the user is signed in to the Power Platform CLI; if not, the system signs them in.

**Resilience**
- **Invalid data inputs**: if the App Idea Prompt is empty, contradictory, or too vague to act on, the system asks the user a clarifying question rather than guessing or generating a broken app.
- **Network timeouts**: if the Power Platform/Dataverse API or the LLM/agent provider API times out during build or test, the system tells the user the attempt failed and offers a retry, without losing the user's original prompt — and since inference cost is billed against the user's own Claude Code license, the system makes clear that retrying consumes their own usage/quota.
- **Offline/empty states**: if there is no Generated App yet (first run, or after a failed build with no prior success), the interface clearly shows an empty/"nothing built yet" state and guides the user to submit a prompt, rather than showing a blank or broken screen.

---

# Section 5: User Journey Map

```mermaid
flowchart TD
    A0[User opens desktop app for the first time] --> A1[System runs Environment Readiness Check]
    A1 --> A2{Signed in to Claude Code?}
    A2 -- No --> A3[Prompt user to sign in to Claude Code]
    A3 --> A2
    A2 -- Yes --> A4{VS Code installed?}
    A4 -- No --> A5[Ask user to install VS Code first]
    A5 --> A4
    A4 -- Yes --> A6{PowerPlatform VS Code extension installed?}
    A6 -- No --> A7[System auto-installs the PowerPlatform extension]
    A7 --> A8
    A6 -- Yes --> A8{Signed in to Power Platform CLI?}
    A8 -- No --> A9[System signs the user in to Power Platform CLI]
    A9 --> P0
    A8 -- Yes --> P0{Does the user already have a prototype to import (e.g. Lovable, Replit)?}
    P0 -- Yes --> P1[User imports the existing prototype]
    P1 --> P2[AI analyzes the prototype]
    P2 --> A
    P0 -- No --> A[Citizen developer describes app idea in plain language]

    A --> B{Prompt clear enough to act on?}
    B -- No --> C[System asks a clarifying question]
    C --> A
    B -- Yes --> D[Agent harness builds PowerApps Code Apps app]
    D --> E{Build succeeded?}
    E -- No --> F[Plain-language failure message + retry option]
    F --> D
    E -- Yes --> G[User tests the generated app]
    G --> H{Tests pass?}
    H -- Yes --> I[User has a working, compliant PowerApps Code Apps application]
    H -- No --> J{Can the AI auto-fix the failure itself?}
    J -- Yes --> K[AI auto-fixes and re-runs the test]
    K --> G
    J -- No --> L[AI explains the failure in layman's terms and troubleshoots together with the user]
    L --> M[User decides how to steer the next attempt]
    M --> D
```
