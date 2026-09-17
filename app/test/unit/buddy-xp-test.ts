import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  CommitBaseXp,
  levelForXp,
  levelProgress,
  MaxCommitXp,
  MaxLevel,
  xpForCommit,
  xpForLevel,
} from '../../src/lib/buddy/xp'

describe('buddy/xp', () => {
  describe('xpForCommit', () => {
    it('pays something for a commit that changed nothing', () => {
      assert.equal(xpForCommit(0), CommitBaseXp)
    })

    it('pays for the lines it touched', () => {
      assert.equal(xpForCommit(50), CommitBaseXp + 50)
    })

    /**
     * The cap is the point. Without it one vendored dependency finishes the
     * grind in an afternoon, which rewards exactly the commit nobody wants.
     */
    it('caps a huge commit', () => {
      assert.equal(xpForCommit(5000), MaxCommitXp)
      assert.equal(xpForCommit(112), MaxCommitXp)
      assert.equal(xpForCommit(1000000), MaxCommitXp)
    })

    it('treats a nonsense line count as nothing rather than going backwards', () => {
      assert.equal(xpForCommit(-40), CommitBaseXp)
    })
  })

  describe('levels', () => {
    it('starts at one, with nothing earned', () => {
      assert.equal(levelForXp(0), 1)
      assert.equal(xpForLevel(1), 0)
    })

    it('rises, never falls', () => {
      for (let level = 2; level <= MaxLevel; level++) {
        assert.ok(
          xpForLevel(level) > xpForLevel(level - 1),
          `level ${level} costs no more than ${level - 1}`
        )
      }
    })

    it('stops at the top', () => {
      assert.equal(levelForXp(xpForLevel(MaxLevel)), MaxLevel)
      assert.equal(levelForXp(xpForLevel(MaxLevel) * 10), MaxLevel)
      assert.equal(xpForLevel(MaxLevel + 5), xpForLevel(MaxLevel))
    })

    it('puts a total in the level it belongs to', () => {
      for (let level = 1; level < MaxLevel; level++) {
        const floor = xpForLevel(level)

        assert.equal(levelForXp(floor), level, `at the floor of ${level}`)
        assert.equal(levelForXp(floor + 1), level, `just inside ${level}`)
        assert.equal(
          levelForXp(xpForLevel(level + 1) - 1),
          level,
          `just below ${level + 1}`
        )
      }
    })

    /**
     * The promise in the request: it should take a long time. At roughly 60 XP
     * for an ordinary commit this is about 360 of them — the better part of a
     * year at ten a week. If somebody flattens the curve later, this is what
     * notices.
     */
    it('takes hundreds of commits to max out', () => {
      const perOrdinaryCommit = xpForCommit(50)
      const commits = Math.ceil(xpForLevel(MaxLevel) / perOrdinaryCommit)

      assert.ok(
        commits > 300,
        `only ${commits} ordinary commits to max, which is too easy`
      )
      assert.ok(
        commits < 600,
        `${commits} ordinary commits is a grind nobody finishes`
      )
    })
  })

  describe('levelProgress', () => {
    it('reads as empty at the start of a level', () => {
      const progress = levelProgress(xpForLevel(5))

      assert.equal(progress.level, 5)
      assert.equal(progress.into, 0)
      assert.equal(progress.fraction, 0)
      assert.equal(progress.isMax, false)
    })

    it('reads as half way in the middle', () => {
      const floor = xpForLevel(5)
      const needed = xpForLevel(6) - floor
      const progress = levelProgress(floor + needed / 2)

      assert.equal(progress.level, 5)
      assert.equal(progress.fraction, 0.5)
    })

    /** Full rather than empty at the top, so a maxed bar looks finished. */
    it('is full and flagged at the top', () => {
      const progress = levelProgress(xpForLevel(MaxLevel))

      assert.equal(progress.level, MaxLevel)
      assert.equal(progress.fraction, 1)
      assert.equal(progress.isMax, true)
      assert.equal(progress.needed, 0)
    })

    it('never leaves the bar outside its track', () => {
      for (let xp = 0; xp < 30000; xp += 137) {
        const { fraction } = levelProgress(xp)

        assert.ok(
          fraction >= 0 && fraction <= 1,
          `fraction ${fraction} at ${xp}`
        )
      }
    })
  })
})
