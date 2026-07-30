import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  gitOnlyReconciliation,
  reconcileWorkItems,
} from '../../../src/lib/hotflow/reconcile'
import { IWorkItem } from '../../../src/models/hotflow'

function workItem(id: number, title: string): IWorkItem {
  return {
    id,
    title,
    workItemType: 'Bug',
    state: 'Resolved',
    assignedTo: null,
    tags: [],
    releaseSequence: 202609,
    linkedCommitShas: [],
  }
}

const details = new Map<number, IWorkItem>([
  [1, workItem(1, 'In release and tagged')],
  [2, workItem(2, 'Tagged but not merged')],
  [3, workItem(3, 'In release, untagged')],
])

describe('hotflow/reconcile', () => {
  describe('reconcileWorkItems', () => {
    it('classifies all three cases', () => {
      const result = reconcileWorkItems([1, 3], [1, 2], details, false)

      assert.strictEqual(result.inReleaseTaggedCount, 1)
      assert.strictEqual(result.missingCount, 1)
      assert.strictEqual(result.untaggedCount, 1)

      const byId = new Map(result.items.map(i => [i.id, i.presence]))
      assert.strictEqual(byId.get(1), 'in-release-tagged')
      assert.strictEqual(byId.get(2), 'missing-from-release')
      assert.strictEqual(byId.get(3), 'in-release-untagged')
    })

    it('surfaces missing items first', () => {
      // Missing items are the reason the panel exists; they must not be buried.
      const result = reconcileWorkItems([1, 3], [1, 2], details, false)

      assert.strictEqual(result.items[0].presence, 'missing-from-release')
    })

    it('orders stably within a group', () => {
      const result = reconcileWorkItems([5, 1, 3], [], new Map(), false)

      assert.deepStrictEqual(
        result.items.map(i => i.id),
        [1, 3, 5]
      )
    })

    it('attaches detail when available and tolerates its absence', () => {
      const result = reconcileWorkItems([1, 99], [], details, false)

      const byId = new Map(result.items.map(i => [i.id, i.workItem]))
      assert.strictEqual(byId.get(1)?.title, 'In release and tagged')
      assert.strictEqual(byId.get(99), null)
    })

    it('carries the provisional flag through', () => {
      assert.strictEqual(
        reconcileWorkItems([1], [1], details, true).provisional,
        true
      )
      assert.strictEqual(
        reconcileWorkItems([1], [1], details, false).provisional,
        false
      )
    })

    it('reports nothing missing when the release covers the cycle', () => {
      const result = reconcileWorkItems([1, 2], [1, 2], details, false)

      assert.strictEqual(result.missingCount, 0)
      assert.strictEqual(result.inReleaseTaggedCount, 2)
    })

    it('deduplicates repeated ids', () => {
      const result = reconcileWorkItems([1, 1, 1], [1], details, false)

      assert.strictEqual(result.items.length, 1)
      assert.strictEqual(result.inReleaseTaggedCount, 1)
    })

    it('handles both sides being empty', () => {
      const result = reconcileWorkItems([], [], new Map(), false)

      assert.deepStrictEqual(result.items, [])
      assert.strictEqual(result.missingCount, 0)
    })

    it('reports every tagged item as missing when the release is empty', () => {
      const result = reconcileWorkItems([], [1, 2], details, false)

      assert.strictEqual(result.missingCount, 2)
      assert.strictEqual(result.inReleaseTaggedCount, 0)
    })
  })

  describe('gitOnlyReconciliation', () => {
    it('treats every found VSO as present with nothing missing', () => {
      const result = gitOnlyReconciliation([3, 1, 2])

      assert.deepStrictEqual(
        result.items.map(i => i.id),
        [1, 2, 3]
      )
      assert.ok(result.items.every(i => i.presence === 'in-release-tagged'))
      assert.strictEqual(result.missingCount, 0)
    })

    it('is never provisional', () => {
      // Without ADO there is no cycle claim to be provisional about.
      assert.strictEqual(gitOnlyReconciliation([1]).provisional, false)
    })

    it('carries no work item detail', () => {
      assert.ok(
        gitOnlyReconciliation([1]).items.every(i => i.workItem === null)
      )
    })
  })
})
