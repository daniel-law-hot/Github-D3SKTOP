import { describe, it } from 'node:test'
import assert from 'node:assert'
import { planReleaseSequenceAssignment } from '../../../src/lib/hotflow/ado-client'

const Sequence = 202618

function current(
  entries: ReadonlyArray<[number, number | null]>
): ReadonlyMap<number, number | null> {
  return new Map(entries)
}

describe('hotflow/assignReleaseSequence', () => {
  describe('planReleaseSequenceAssignment', () => {
    it('writes to a work item with no sequence', () => {
      const plan = planReleaseSequenceAssignment(
        [1],
        Sequence,
        current([[1, null]])
      )

      assert.deepStrictEqual(plan.write, [1])
      assert.strictEqual(plan.skip.length, 0)
    })

    it('leaves a work item already assigned to this release alone', () => {
      const plan = planReleaseSequenceAssignment(
        [1],
        Sequence,
        current([[1, Sequence]])
      )

      assert.deepStrictEqual(plan.write, [])
      assert.strictEqual(plan.skip.length, 1)
      assert.strictEqual(plan.skip[0].outcome, 'already')
    })

    /**
     * The case that decides whether this feature is safe to have. A work item
     * merged here but planned for another cycle must not be quietly moved into
     * this one — that would be HotFlow rewriting someone else's release.
     */
    it('refuses to overwrite another release, and says which', () => {
      const plan = planReleaseSequenceAssignment(
        [1],
        Sequence,
        current([[1, 202620]])
      )

      assert.deepStrictEqual(plan.write, [])
      assert.strictEqual(plan.skip[0].outcome, 'conflict')
      assert.strictEqual(plan.skip[0].existingSequence, 202620)
    })

    it('attempts an id it knows nothing about', () => {
      const plan = planReleaseSequenceAssignment([7], Sequence, current([]))

      assert.deepStrictEqual(plan.write, [7])
    })

    it('sorts each id into exactly one outcome', () => {
      const plan = planReleaseSequenceAssignment(
        [1, 2, 3, 4],
        Sequence,
        current([
          [1, null],
          [2, Sequence],
          [3, 202601],
        ])
      )

      assert.deepStrictEqual(
        [...plan.write].sort((a, b) => a - b),
        [1, 4]
      )
      assert.deepStrictEqual(
        plan.skip.map(s => [s.id, s.outcome]),
        [
          [2, 'already'],
          [3, 'conflict'],
        ]
      )
    })

    it('counts a repeated id once', () => {
      const plan = planReleaseSequenceAssignment(
        [5, 5, 5],
        Sequence,
        current([[5, null]])
      )

      assert.deepStrictEqual(plan.write, [5])
    })

    /**
     * The override the dialog's checkbox turns on. Deliberately separate tests
     * from the default: the skip is the safety property of the whole feature, and
     * a change that quietly made overwriting the default would pass every test
     * above this one.
     */
    it('overwrites another release when told to', () => {
      const plan = planReleaseSequenceAssignment(
        [1],
        Sequence,
        current([[1, 202620]]),
        true
      )

      assert.deepStrictEqual(plan.write, [1])
      assert.strictEqual(plan.skip.length, 0)
    })

    it('still skips one already on this release when overwriting', () => {
      const plan = planReleaseSequenceAssignment(
        [1, 2],
        Sequence,
        current([
          [1, Sequence],
          [2, 202620],
        ]),
        true
      )

      assert.deepStrictEqual(plan.write, [2])
      assert.strictEqual(plan.skip.length, 1)
      assert.strictEqual(plan.skip[0].outcome, 'already')
    })

    it('does not overwrite by default', () => {
      const plan = planReleaseSequenceAssignment(
        [1],
        Sequence,
        current([[1, 202620]])
      )

      assert.deepStrictEqual(plan.write, [])
    })

    it('has nothing to do with an empty list', () => {
      const plan = planReleaseSequenceAssignment([], Sequence, current([]))

      assert.deepStrictEqual(plan.write, [])
      assert.deepStrictEqual(plan.skip, [])
    })
  })
})
