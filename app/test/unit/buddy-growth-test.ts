import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GrowingStats,
  grownStat,
  growStats,
  StatCeiling,
} from '../../src/lib/buddy/growth'
import { MaxLevel } from '../../src/lib/buddy/xp'

const stats = { focus: 20, stamina: 45, luck: 8, mischief: 69 }

describe('buddy/growth', () => {
  describe('grownStat', () => {
    it('leaves a level one buddy exactly as it rolled', () => {
      for (let base = 0; base <= 99; base++) {
        assert.equal(grownStat(base, 1), base)
      }
    })

    /** The point of the grind: everything gets there in the end. */
    it('reaches the ceiling at max level, whatever it rolled', () => {
      for (const base of [5, 20, 45, 70, 99]) {
        assert.equal(grownStat(base, MaxLevel), StatCeiling)
      }
    })

    it('never overshoots the ceiling', () => {
      for (let level = 1; level <= MaxLevel; level++) {
        for (const base of [5, 45, 88, 99]) {
          assert.ok(
            grownStat(base, level) <= StatCeiling,
            `base ${base} at level ${level} went past ${StatCeiling}`
          )
        }
      }
    })

    it('only ever goes up', () => {
      for (const base of [5, 45, 88]) {
        for (let level = 2; level <= MaxLevel; level++) {
          assert.ok(
            grownStat(base, level) >= grownStat(base, level - 1),
            `base ${base} went backwards at level ${level}`
          )
        }
      }
    })

    /**
     * A low roll gains more than a high one, because both are closing the same
     * gap — which is what stops a common buddy feeling like a write-off.
     */
    it('gives the bigger climb to the worse roll', () => {
      const low = grownStat(10, 10) - 10
      const high = grownStat(80, 10) - 80

      assert.ok(low > high, `low gained ${low}, high gained ${high}`)
    })

    it('copes with a level outside the range', () => {
      assert.equal(grownStat(30, 0), 30)
      assert.equal(grownStat(30, -5), 30)
      assert.equal(grownStat(30, MaxLevel + 100), StatCeiling)
    })
  })

  describe('growStats', () => {
    it('grows focus, stamina and luck', () => {
      const grown = growStats(stats, MaxLevel)

      assert.equal(grown.focus, StatCeiling)
      assert.equal(grown.stamina, StatCeiling)
      assert.equal(grown.luck, StatCeiling)
    })

    /**
     * Mischief decides what the buddy sounds like. If it climbed, a placid
     * companion would turn snarky somewhere around level twelve and stop being
     * the one its owner met.
     */
    it('never touches mischief', () => {
      for (let level = 1; level <= MaxLevel; level++) {
        assert.equal(growStats(stats, level).mischief, stats.mischief)
      }
    })

    it('says which stats move, and mischief is not among them', () => {
      assert.deepStrictEqual([...GrowingStats], ['focus', 'stamina', 'luck'])
      assert.ok(!GrowingStats.includes('mischief'))
    })

    it('changes nothing at all at level one', () => {
      assert.deepStrictEqual(growStats(stats, 1), stats)
    })
  })
})
