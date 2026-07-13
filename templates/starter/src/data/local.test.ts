import { beforeEach, describe, expect, it } from "vitest"
import { local } from "./local"
import seed from "./seed.json"

const SEED_COUNT = (seed as unknown[]).length

describe("LocalDataSource (the preview's local db)", () => {
  beforeEach(() => localStorage.clear())

  it("seeds from seed.json on first read", async () => {
    const rows = await local.list()
    expect(rows).toHaveLength(SEED_COUNT)
  })

  it("creates a row, persists it across a fresh read, and assigns a new id", async () => {
    const before = await local.list()
    const created = await local.create({
      title: "New row",
      owner: "you",
      due: "2026-08-01",
      status: "Open",
    })
    expect(created.id).toBeGreaterThan(0)

    const after = await local.list() // fresh read = reload simulation
    expect(after).toHaveLength(before.length + 1)
    expect(
      after.some((r) => r.id === created.id && r.title === "New row")
    ).toBe(true)
  })

  it("updates a row and the change survives a re-read", async () => {
    const [first] = await local.list()
    const flipped = first.status === "Done" ? "Open" : "Done"
    const updated = await local.update(first.id, { status: flipped })
    expect(updated?.status).toBe(flipped)

    const reread = (await local.list()).find((r) => r.id === first.id)
    expect(reread?.status).toBe(flipped)
  })

  it("returns null when updating a row that does not exist", async () => {
    expect(await local.update(999999, { title: "nope" })).toBeNull()
  })

  it("removes a row", async () => {
    const before = await local.list()
    await local.remove(before[0].id)
    const after = await local.list()
    expect(after).toHaveLength(before.length - 1)
    expect(after.some((r) => r.id === before[0].id)).toBe(false)
  })

  it("reset restores the seed rows after edits", async () => {
    await local.create({
      title: "Temp",
      owner: "you",
      due: "2026-08-01",
      status: "Open",
    })
    await local.remove((await local.list())[0].id)

    const reset = await local.reset()
    expect(reset).toHaveLength(SEED_COUNT)
    expect(await local.list()).toHaveLength(SEED_COUNT)
  })
})
