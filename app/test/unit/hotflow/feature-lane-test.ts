import { describe, it } from 'node:test'
import assert from 'node:assert'
import { sortFeatureLane } from '../../../src/lib/hotflow/feature-lane'
import { IFeatureLaneEntry } from '../../../src/models/hotflow'

function entry(
  branchName: string,
  vso: number | null,
  pullRequestNumber: number | null = null
): IFeatureLaneEntry {
  return {
    branchName,
    vso,
    pullRequestNumber,
    isRemoteOnly: false,
    isLocalOnly: false,
  }
}

function names(entries: ReadonlyArray<IFeatureLaneEntry>) {
  return entries.map(e => e.branchName)
}

describe('hotflow/feature-lane', () => {
  describe('sortFeatureLane', () => {
    it('orders by VSO ascending', () => {
      const lane = [
        entry('feature/107091-c', 107091),
        entry('feature/96552-a', 96552),
        entry('feature/104155-b', 104155),
      ]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/96552-a',
        'feature/104155-b',
        'feature/107091-c',
      ])
    })

    it('sorts numerically, not as text', () => {
      // '96552' > '104155' as strings, which is what the old name sort did.
      const lane = [
        entry('feature/104155-b', 104155),
        entry('feature/96552-a', 96552),
      ]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/96552-a',
        'feature/104155-b',
      ])
    })

    it('keeps branches with a pull request ahead of those without', () => {
      // The lane draws these with solid connectors and the rest dashed, so
      // interleaving them would alternate the two styles down the column.
      const lane = [
        entry('feature/100000-idle', 100000),
        entry('feature/107091-open', 107091, 35),
      ]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/107091-open',
        'feature/100000-idle',
      ])
    })

    it('orders by VSO within each pull request group', () => {
      const lane = [
        entry('feature/300-idle', 300),
        entry('feature/200-open', 200, 2),
        entry('feature/100-idle', 100),
        entry('feature/400-open', 400, 4),
      ]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/200-open',
        'feature/400-open',
        'feature/100-idle',
        'feature/300-idle',
      ])
    })

    it('puts a branch with no VSO last', () => {
      const lane = [
        entry('feature/no-number', null),
        entry('feature/107091-b', 107091),
        entry('feature/96552-a', 96552),
      ]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/96552-a',
        'feature/107091-b',
        'feature/no-number',
      ])
    })

    it('sorts a missing VSO last rather than as zero', () => {
      // Null isn't the lowest-numbered work, it's work we can't place.
      const lane = [entry('feature/no-number', null), entry('feature/1-a', 1)]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/1-a',
        'feature/no-number',
      ])
    })

    it('still groups by pull request when neither has a VSO', () => {
      const lane = [entry('zzz-idle', null), entry('aaa-open', null, 7)]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'aaa-open',
        'zzz-idle',
      ])
    })

    it('falls back to the branch name when a VSO is split across branches', () => {
      const lane = [
        entry('feature/96552-part-b', 96552),
        entry('feature/96552-part-a', 96552),
      ]

      assert.deepStrictEqual(names(sortFeatureLane(lane)), [
        'feature/96552-part-a',
        'feature/96552-part-b',
      ])
    })

    it('does not mutate the input', () => {
      const lane = [entry('feature/2-b', 2), entry('feature/1-a', 1)]
      const before = names(lane)

      sortFeatureLane(lane)

      assert.deepStrictEqual(names(lane), before)
    })

    it('handles an empty lane', () => {
      assert.deepStrictEqual(sortFeatureLane([]), [])
    })
  })
})
