// LocalDataSource — the preview's local database.
//
// It seeds from src/data/seed.json the first time it runs, then serves full CRUD out of
// localStorage. Every change (create/update/delete) persists across reloads, so the
// preview behaves like a real working app you can click through — not a static sample.
// Each Vite preview runs on its own port (its own browser origin), so every generated
// app gets an isolated store for free.
//
// ponytail: localStorage is deliberate — zero deps, synchronous, survives reloads, and
// ~5MB is plenty for demo data. Move to IndexedDB only if sample data outgrows that.
import type { DataSource, Item, NewItem } from "./types"
import seed from "./seed.json"

const KEY = "powercodex.items"

function seedRows(): Item[] {
  return (seed as Item[]).map((r) => ({ ...r }))
}

function load(): Item[] {
  const raw = localStorage.getItem(KEY)
  if (raw == null) {
    const rows = seedRows()
    localStorage.setItem(KEY, JSON.stringify(rows))
    return rows
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Item[]) : []
  } catch {
    // Corrupt store → fall back to the seed rather than crash the screen.
    const rows = seedRows()
    localStorage.setItem(KEY, JSON.stringify(rows))
    return rows
  }
}

function save(rows: Item[]): void {
  localStorage.setItem(KEY, JSON.stringify(rows))
}

function nextId(rows: Item[]): number {
  return rows.reduce((max, r) => (r.id > max ? r.id : max), 0) + 1
}

export const local: DataSource = {
  async list() {
    return load()
  },
  async create(input: NewItem) {
    const rows = load()
    const row: Item = { ...input, id: nextId(rows) }
    save([...rows, row])
    return row
  },
  async update(id: number, patch: Partial<NewItem>) {
    const rows = load()
    let updated: Item | null = null
    const next = rows.map((r) => {
      if (r.id !== id) return r
      updated = { ...r, ...patch }
      return updated
    })
    if (updated) save(next)
    return updated
  },
  async remove(id: number) {
    save(load().filter((r) => r.id !== id))
  },
  async reset() {
    const rows = seedRows()
    save(rows)
    return rows
  },
}
