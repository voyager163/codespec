// DataverseDataSource — the published app's real data layer.
//
// This is inert until the app is published. At publish time PowerCodex creates the
// Dataverse tables, registers their logical names, and replaces the bodies below with
// generated @microsoft/power-apps service-class calls. Until then the app runs on the
// local source in preview, so this file only needs to compile — it is never reached
// while VITE_POWERCODEX_LIVE is unset.
import type { DataSource } from "./types"

// Honest failure, in plain language, if this source is ever hit before it is wired.
function notWired(): never {
  throw new Error(
    "This app's Dataverse data source isn't connected yet. Publish it to Power Platform to wire the tables up."
  )
}

export const dataverse: DataSource = {
  list: notWired,
  create: notWired,
  update: notWired,
  remove: notWired,
  reset: notWired,
}
