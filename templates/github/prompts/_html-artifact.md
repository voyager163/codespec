---
description: Shared convention for the HTML review artifact (preview.html) every change produces
---

# HTML review artifact (`preview.html`)

This is the shared convention referenced by `/opsx:explore`, `/opsx:propose`, and the other OPSX prompts. Markdown artifacts stay **canonical** (OpenSpec tooling reads them); the HTML is the **generated review surface** beside them.

## Where it lives

Write it to `openspec/changes/<name>/preview.html`. Keep generating the markdown artifacts (`proposal.md`, `design.md`, `tasks.md`, spec deltas) — the HTML is added on top, never a replacement.

## What it must contain

A self-contained HTML file (inline CSS + JS, no external assets, no network) with:

1. **Now → After** — a side-by-side comparison of the current state and the proposed state for any UI or behavior delta. A draggable `clip-path` slider is the preferred pattern; a static two-column layout is acceptable when there is no visual delta.
2. **A stated recommendation** — the workflow always takes a position, with the recommended option marked, followed by **pros & cons** for each option as cards so the reader can overrule it with full information.
3. **One-shot questions** — gather *every* open question and present them together, once, each with a suggested answer pre-filled so answering is editing, not authoring. Mark the rare question that has no safe default as "needs your input".
4. **A suggested proposal** — a concrete draft so the reader is approving/adjusting, never staring at a blank page.
5. **The readiness line** — render this exact sentence, and only once every question is resolved and a proposal + Now/After are present:

   > "I am completely ready, I have no more questions to ask."

## Design-engineering pass (required)

Apply the `/emil-design-eng` philosophy to every HTML artifact:

- Custom easings (e.g. `cubic-bezier(0.23, 1, 0.32, 1)`), not the weak built-ins.
- Scale-on-press for interactive controls; subtle staggered entrance.
- Respect `prefers-reduced-motion` — disable animation and transitions under it.
- Dark, modern surface; readable type; nothing static or template-looking.

## After writing it

- Tell the user the path and that it can be opened in a browser.
- If a live dashboard server is running (`npm run lifecycle:serve`), the observer/planner may also surface the artifact there.
- End the turn on the readiness line **only** when it is genuinely true.
