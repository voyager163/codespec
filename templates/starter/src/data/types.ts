// The data seam. Screens import ONLY from `@/data` and never know whether they are
// talking to the local preview store or Dataverse — the two sources implement the same
// interface, so a screen built and tested in preview behaves identically after publish.
//
// `Item` is the default record shape. When PowerCodex generates an app for your domain
// it reshapes the seed data (src/data/seed.json) to match; the field set here stays a
// safe, strict-typed default so every generated screen compiles.

export type ItemStatus = "Open" | "Done"

export type Item = {
  id: number
  title: string
  owner: string
  due: string
  status: ItemStatus
}

// A record being created does not have a server-assigned id yet.
export type NewItem = Omit<Item, "id">

// The one interface both sources honour. It is async on purpose: Dataverse is a network
// call, so preview is async too and screens need no changes when the source switches.
export interface DataSource {
  list(): Promise<Item[]>
  create(input: NewItem): Promise<Item>
  update(id: number, patch: Partial<NewItem>): Promise<Item | null>
  remove(id: number): Promise<void>
  // Restore the seed rows (the preview's "Reset sample data" affordance).
  reset(): Promise<Item[]>
}
