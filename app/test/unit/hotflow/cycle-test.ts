import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  formatCycleTag,
  guessCycle,
  parseCycleTag,
  resolveCycle,
} from '../../../src/lib/hotflow/cycle'
import { parseReleaseVersion } from '../../../src/lib/hotflow/version'

function version(raw: string) {
  const parsed = parseReleaseVersion(raw)
  assert.notStrictEqual(parsed, null)
  return parsed!
}

describe('hotflow/cycle', () => {
  describe('formatCycleTag', () => {
    it('zero-pads the cycle number', () => {
      assert.strictEqual(formatCycleTag(2026, 9), '202609')
      assert.strictEqual(formatCycleTag(2026, 11), '202611')
    })
  })

  describe('parseCycleTag', () => {
    it('round-trips a formatted tag', () => {
      assert.deepStrictEqual(parseCycleTag('202609'), { year: 2026, cycle: 9 })
    })

    it('rejects malformed tags', () => {
      assert.strictEqual(parseCycleTag('2026'), null)
      assert.strictEqual(parseCycleTag('20260'), null)
      assert.strictEqual(parseCycleTag('2026099'), null)
      assert.strictEqual(parseCycleTag('abcdef'), null)
    })

    it('rejects out-of-range values', () => {
      assert.strictEqual(parseCycleTag('202600'), null, 'cycle 0')
      assert.strictEqual(parseCycleTag('202654'), null, 'cycle 54')
      assert.strictEqual(parseCycleTag('199901'), null, 'year 1999')
    })
  })

  describe('guessCycle', () => {
    it('infers an unconfirmed cycle from the version', () => {
      const guess = guessCycle(version('1.2026.9'))

      assert.deepStrictEqual(guess, {
        tag: '202609',
        cycle: 9,
        year: 2026,
        confirmed: false,
      })
    })

    it('never returns a confirmed guess', () => {
      // The whole design rests on a guess being distinguishable from a fact.
      assert.strictEqual(guessCycle(version('1.2026.9'))?.confirmed, false)
    })

    it('returns null without a year', () => {
      assert.strictEqual(guessCycle(version('1.9')), null)
    })

    it('returns null when the cycle segment cannot be a cycle', () => {
      assert.strictEqual(guessCycle(version('1.2026.99')), null)
    })

    it('returns null for a version that is only a year', () => {
      assert.strictEqual(guessCycle(version('2026')), null)
    })

    it('derives the cycle tag for a hotfix version', () => {
      // `1.2026.16.1` is cycle 16, so the tag must be 202616. Deriving 202601
      // from the trailing segment would match no work items at all.
      assert.strictEqual(guessCycle(version('1.2026.16.1'))?.tag, '202616')
    })

    it('pads single-digit cycles', () => {
      assert.strictEqual(guessCycle(version('1.2026.9'))?.tag, '202609')
      assert.strictEqual(guessCycle(version('1.2026.17'))?.tag, '202617')
    })
  })

  describe('resolveCycle', () => {
    it('prefers a stored confirmed tag over the guess', () => {
      const stored = new Map([['release/1.2026.9', '202611']])

      const resolved = resolveCycle(
        'release/1.2026.9',
        version('1.2026.9'),
        stored
      )

      // The version says cycle 9; the user said 11. The user wins.
      assert.deepStrictEqual(resolved, {
        tag: '202611',
        cycle: 11,
        year: 2026,
        confirmed: true,
      })
    })

    it('falls back to the guess when nothing is stored', () => {
      const resolved = resolveCycle(
        'release/1.2026.9',
        version('1.2026.9'),
        new Map()
      )

      assert.strictEqual(resolved?.tag, '202609')
      assert.strictEqual(resolved?.confirmed, false)
    })

    it('ignores a stored value for a different branch', () => {
      const stored = new Map([['release/1.2026.8', '202608']])

      const resolved = resolveCycle(
        'release/1.2026.9',
        version('1.2026.9'),
        stored
      )

      assert.strictEqual(resolved?.tag, '202609')
      assert.strictEqual(resolved?.confirmed, false)
    })

    it('falls back to the guess when the stored value is corrupt', () => {
      const stored = new Map([['release/1.2026.9', 'not-a-tag']])

      const resolved = resolveCycle(
        'release/1.2026.9',
        version('1.2026.9'),
        stored
      )

      assert.strictEqual(resolved?.confirmed, false)
      assert.strictEqual(resolved?.tag, '202609')
    })

    it('handles an absent store', () => {
      const resolved = resolveCycle(
        'release/1.2026.9',
        version('1.2026.9'),
        undefined
      )

      assert.strictEqual(resolved?.tag, '202609')
    })
  })
})
