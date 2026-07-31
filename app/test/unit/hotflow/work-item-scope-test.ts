import { describe, it } from 'node:test'
import assert from 'node:assert'
import { scopeToRepository } from '../../../src/lib/hotflow/work-item-scope'

describe('hotflow/work-item-scope', () => {
  describe('scopeToRepository', () => {
    it('keeps a work item with a feature branch in this repository', () => {
      assert.deepStrictEqual(
        scopeToRepository([104402], new Set([104402]), new Set()),
        [104402]
      )
    })

    it("drops another repository's work item", () => {
      // The real case: NimbleObt's release/1.2026.15 listed "Expedia: Margin
      // Manager", "CO Itinerary v2" and "StubaWebApi - Automated saving" as work it
      // was missing. Sequence 202615 carries twenty work items across a dozen
      // repositories and NimbleObt has a branch for none of them.
      const assigned = [99289, 104600, 104894]

      assert.deepStrictEqual(
        scopeToRepository(assigned, new Set([106500, 106501]), new Set()),
        []
      )
    })

    it('keeps a work item the release already contains, with no branch', () => {
      // Being in `production..release` is proof beyond argument, and branches get
      // deleted once they merge. Without this clause a tidied-up branch would move
      // an item from "in release and assigned" to "in release, not assigned".
      assert.deepStrictEqual(
        scopeToRepository([104402], new Set(), new Set([104402])),
        [104402]
      )
    })

    it('keeps an item that qualifies both ways only once', () => {
      assert.deepStrictEqual(
        scopeToRepository([104402], new Set([104402]), new Set([104402])),
        [104402]
      )
    })

    it('drops an item with neither a branch nor a place in the release', () => {
      assert.deepStrictEqual(
        scopeToRepository([99289], new Set([104402]), new Set([106884])),
        []
      )
    })

    it('keeps input order', () => {
      const owned = new Set([300, 100])

      assert.deepStrictEqual(
        scopeToRepository([300, 200, 100], owned, new Set()),
        [300, 100]
      )
    })

    it('handles an empty assigned list', () => {
      assert.deepStrictEqual(
        scopeToRepository([], new Set([104402]), new Set([104402])),
        []
      )
    })

    it('drops everything when the repository owns nothing', () => {
      assert.deepStrictEqual(
        scopeToRepository([1, 2, 3], new Set(), new Set()),
        []
      )
    })

    it('does not mutate the input', () => {
      const assigned = [3, 1, 2]

      scopeToRepository(assigned, new Set([1]), new Set())

      assert.deepStrictEqual(assigned, [3, 1, 2])
    })
  })
})
