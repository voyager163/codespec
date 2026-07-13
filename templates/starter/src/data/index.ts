// The single entry point every screen imports: `import { data } from "@/data"`.
//
// Preview runs on the local store; publish builds with VITE_POWERCODEX_LIVE=1 to swap in
// Dataverse. Screens are identical in both modes — they only ever see `data`.
import type { DataSource } from "./types"
import { local } from "./local"
import { dataverse } from "./dataverse"

export type { Item, NewItem, ItemStatus, DataSource } from "./types"

export const data: DataSource =
  import.meta.env.VITE_POWERCODEX_LIVE === "1" ? dataverse : local
