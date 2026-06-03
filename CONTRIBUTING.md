# Contributing to PowerCodex

Thanks for helping improve PowerCodex. This project exists to make spec-driven development practical for Power Apps Code Apps, and contributions are welcome from people using, testing, documenting, and maintaining that workflow.

By participating in this project, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are released under the terms of the [MIT license](LICENSE).

## What Helps

Useful contributions include:

- improving the Code Apps starter template;
- refining OPSX prompts and OpenSpec skills;
- improving the fixed OpenSpec configuration for Power Apps Code Apps;
- adding focused verification coverage;
- improving README, contribution, and maintainer documentation;
- documenting real Code Apps development patterns;
- evaluating future spec-driven development frameworks that could fit PowerCodex better than the current OpenSpec setup.

Keep changes focused. If you have several unrelated ideas, open separate issues or pull requests so each one can be reviewed clearly.

## Local Setup

Install the required tools:

- Node.js 20.19.0 or newer
- npm
- git
- OpenSpec
- Power Platform CLI if you are validating generated Code Apps with `pac code init`

Clone the repository and install dependencies for generated-project verification when needed:

```bash
git clone https://github.com/voyager163/powercodex.git
cd powercodex
npm install
```

If OpenSpec is not available locally, install it with:

```bash
npm install -g @fission-ai/openspec@latest
```

## Development Workflow

1. Create a branch for your change.
2. Use the OpenSpec workflow for meaningful behavior or documentation changes.
3. Keep edits scoped to the files and behavior described by the change.
4. Update documentation when user-facing behavior, setup, verification, or project positioning changes.
5. Run the relevant verification commands before opening a pull request.

For changes to the starter template, edit files under `templates/starter/`. Do not make the initializer fetch the Microsoft starter during project creation; PowerCodex intentionally uses the local customized starter snapshot.

For changes to OPSX prompts or skills, keep the template copy under `templates/github/` synchronized with the live `.github/` files when appropriate.

## Verification

Run the smoke verification script before submitting changes that affect the CLI, templates, OpenSpec setup, or generated project shape:

```bash
npm run verify
```

Before publishing or handing off a change, also run:

```bash
node --check bin/create-powercodex.js
node --check scripts/verify-generated-project.js
npm pack --dry-run
```

For documentation-only changes, review links, badges, headings, and rendered Markdown. If the documentation references package contents or generated project files, run the verification commands that prove those references are still accurate.

## Pull Request Expectations

Pull requests are easier to review when they include:

- a concise description of the problem and solution;
- links to any related issue or OpenSpec change;
- a summary of files changed;
- verification commands run and their results;
- screenshots or rendered Markdown checks for visible documentation changes;
- notes about any follow-up work that is intentionally out of scope.

Large changes that affect CLI behavior, generated project structure, OpenSpec workflows, or public project direction should be discussed before implementation.

## AI-Assisted Contributions

AI tools are welcome when contributing to PowerCodex, but contributors must understand, test, and take responsibility for their changes.

If you use AI assistance for code, documentation, issue analysis, pull request descriptions, or review responses, disclose that in the issue or pull request and briefly describe how it was used.

Examples:

```text
This PR was drafted with help from GitHub Copilot. I reviewed and tested the final changes.
```

```text
I used an AI assistant to explore the codebase, but the implementation and verification were completed manually.
```

Trivial spelling, grammar, or formatting assistance does not need a detailed disclosure when it is limited to small text edits.

## Resources

- [README.md](README.md)
- [OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [Power Apps Code Apps documentation](https://learn.microsoft.com/power-apps/developer/code-apps/overview)
- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)