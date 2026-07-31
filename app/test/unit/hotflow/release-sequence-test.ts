import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  deriveReleaseSequence,
  formatReleaseSequence,
  isValidReleaseSequence,
  parseReleaseSequence,
  resolveReleaseSequence,
} from '../../../src/lib/hotflow/release-sequence'
import { parseReleaseVersion } from '../../../src/lib/hotflow/version'
import { IReleaseVersion } from '../../../src/models/hotflow'

function version(raw: string): IReleaseVersion {
  const parsed = parseReleaseVersion(raw)
  assert.ok(parsed !== null, `expected ${raw} to parse`)
  return parsed
}

describe('hotflow/release-sequence', () => {
  describe('formatReleaseSequence', () => {
    it('concatenates year and cycle, zero padding the cycle', () => {
      assert.strictEqual(formatReleaseSequence(2026, 17), 202617)
      assert.strictEqual(formatReleaseSequence(2026, 9), 202609)
      assert.strictEqual(formatReleaseSequence(2026, 1), 202601)
    })
  })

  describe('parseReleaseSequence', () => {
    it('splits a sequence into year and cycle', () => {
      assert.deepStrictEqual(parseReleaseSequence(202617), {
        year: 2026,
        cycle: 17,
      })
    })

    it('accepts the six-digit strings the old confirm step stored', () => {
      assert.deepStrictEqual(parseReleaseSequence('202617'), {
        year: 2026,
        cycle: 17,
      })
      assert.deepStrictEqual(parseReleaseSequence(' 202609 '), {
        year: 2026,
        cycle: 9,
      })
    })

    it('rejects a cycle of zero or above 53', () => {
      assert.strictEqual(parseReleaseSequence(202600), null)
      assert.strictEqual(parseReleaseSequence(202654), null)
      assert.deepStrictEqual(parseReleaseSequence(202653), {
        year: 2026,
        cycle: 53,
      })
    })

    it('rejects an implausible year', () => {
      assert.strictEqual(parseReleaseSequence(199917), null)
      assert.strictEqual(parseReleaseSequence(210117), null)
    })

    it('rejects anything that is not six digits', () => {
      assert.strictEqual(parseReleaseSequence('2026'), null)
      assert.strictEqual(parseReleaseSequence('20261'), null)
      assert.strictEqual(parseReleaseSequence('2026170'), null)
      assert.strictEqual(parseReleaseSequence('1.2026.17'), null)
      assert.strictEqual(parseReleaseSequence(''), null)
      assert.strictEqual(parseReleaseSequence(202617.5), null)
    })
  })

  describe('isValidReleaseSequence', () => {
    it('agrees with the parser', () => {
      assert.strictEqual(isValidReleaseSequence(202617), true)
      assert.strictEqual(isValidReleaseSequence(202600), false)
    })
  })

  describe('deriveReleaseSequence', () => {
    it('reads the number straight off a release version', () => {
      assert.strictEqual(deriveReleaseSequence(version('1.2026.17')), 202617)
      assert.strictEqual(deriveReleaseSequence(version('1.2026.9')), 202609)
    })

    it('takes the segment after the year, so a hotfix keeps its cycle', () => {
      // 1.2026.16.1 belongs to cycle 16, not cycle 1. Reading the last segment
      // would query 202601 and reconcile against a release from January.
      assert.strictEqual(deriveReleaseSequence(version('1.2026.16.1')), 202616)
    })

    it('returns null when the version has no plausible year', () => {
      assert.strictEqual(deriveReleaseSequence(version('1.2.3')), null)
    })

    it('returns null when the cycle segment is out of range', () => {
      assert.strictEqual(deriveReleaseSequence(version('1.2026.99')), null)
      assert.strictEqual(deriveReleaseSequence(version('1.2026.0')), null)
    })
  })

  describe('resolveReleaseSequence', () => {
    const v = version('1.2026.17')

    it('derives from the version when nothing is stored', () => {
      assert.deepStrictEqual(
        resolveReleaseSequence('release/1.2026.17', v, undefined),
        {
          value: 202617,
          isOverridden: false,
        }
      )
    })

    it('prefers a stored value and marks it overridden', () => {
      const overrides = new Map([['release/1.2026.17', 202618]])

      assert.deepStrictEqual(
        resolveReleaseSequence('release/1.2026.17', v, overrides),
        { value: 202618, isOverridden: true }
      )
    })

    it('does not call a stored value that matches the derivation an override', () => {
      // This is what the old confirm-the-cycle step wrote: the derived number,
      // stored to say "yes, that one". Flagging it as edited would be a lie.
      const overrides = new Map([['release/1.2026.17', 202617]])

      assert.deepStrictEqual(
        resolveReleaseSequence('release/1.2026.17', v, overrides),
        { value: 202617, isOverridden: false }
      )
    })

    it('is keyed per branch', () => {
      const overrides = new Map([['release/1.2026.16', 202699]])

      assert.deepStrictEqual(
        resolveReleaseSequence('release/1.2026.17', v, overrides),
        { value: 202617, isOverridden: false }
      )
    })

    it('falls through to the derivation when a stored value is corrupt', () => {
      const overrides = new Map([['release/1.2026.17', 42]])

      assert.deepStrictEqual(
        resolveReleaseSequence('release/1.2026.17', v, overrides),
        { value: 202617, isOverridden: false }
      )
    })

    it('returns null when neither a store nor the version can supply one', () => {
      assert.strictEqual(
        resolveReleaseSequence('release/1.2.3', version('1.2.3'), undefined),
        null
      )
    })

    it('still honours an override when the version derives nothing', () => {
      const overrides = new Map([['release/1.2.3', 202617]])

      assert.deepStrictEqual(
        resolveReleaseSequence('release/1.2.3', version('1.2.3'), overrides),
        { value: 202617, isOverridden: true }
      )
    })
  })
})
