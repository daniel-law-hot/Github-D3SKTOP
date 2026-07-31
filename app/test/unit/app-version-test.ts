import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  isComparableVersion,
  isNewerVersion,
  stripVersionPrefix,
} from '../../src/lib/app-version'

describe('app-version', () => {
  describe('stripVersionPrefix', () => {
    it('drops a leading v, in either case', () => {
      assert.strictEqual(stripVersionPrefix('v1.2026.12'), '1.2026.12')
      assert.strictEqual(stripVersionPrefix('V1.2026.12'), '1.2026.12')
      assert.strictEqual(stripVersionPrefix(' 1.2026.12 '), '1.2026.12')
    })

    it('leaves a bare version alone', () => {
      assert.strictEqual(stripVersionPrefix('1.2026.12'), '1.2026.12')
    })
  })

  describe('isComparableVersion', () => {
    it('accepts one to four numeric segments', () => {
      assert.strictEqual(isComparableVersion('1'), true)
      assert.strictEqual(isComparableVersion('1.2026'), true)
      assert.strictEqual(isComparableVersion('1.2026.12'), true)
      assert.strictEqual(isComparableVersion('1.2026.12.2'), true)
    })

    it('accepts semver prereleases', () => {
      assert.strictEqual(isComparableVersion('1.2026.12-beta.1'), true)
    })

    it('rejects five segments', () => {
      assert.strictEqual(isComparableVersion('1.2026.12.2.1'), false)
    })

    it('rejects anything that is not a version', () => {
      // A release tagged like this should be reported as unusable rather than
      // sorted somewhere arbitrary.
      assert.strictEqual(isComparableVersion('latest'), false)
      assert.strictEqual(isComparableVersion('2026-08-01-hotfix'), false)
      assert.strictEqual(isComparableVersion(''), false)
      assert.strictEqual(isComparableVersion('1.2026.x'), false)
    })
  })

  describe('isNewerVersion', () => {
    it('orders three-segment versions as semver always did', () => {
      assert.strictEqual(isNewerVersion('1.2026.12', '1.2026.11'), true)
      assert.strictEqual(isNewerVersion('1.2026.11', '1.2026.12'), false)
      assert.strictEqual(isNewerVersion('1.2026.11', '1.2026.11'), false)
    })

    it('compares numerically, not as text', () => {
      // '1.2026.9' > '1.2026.11' as strings.
      assert.strictEqual(isNewerVersion('1.2026.11', '1.2026.9'), true)
      assert.strictEqual(isNewerVersion('1.2026.9', '1.2026.11'), false)
    })

    it('treats a fourth segment as newer than none — the migration case', () => {
      // 1.2026.12 ships this code; 1.2026.12.2 is the first four-segment release
      // it must accept. This is the whole point of the change.
      assert.strictEqual(isNewerVersion('1.2026.12.2', '1.2026.12'), true)
      assert.strictEqual(isNewerVersion('1.2026.12', '1.2026.12.2'), false)
    })

    it('orders builds within the same version', () => {
      assert.strictEqual(isNewerVersion('1.2026.12.3', '1.2026.12.2'), true)
      assert.strictEqual(isNewerVersion('1.2026.12.2', '1.2026.12.3'), false)
      assert.strictEqual(isNewerVersion('1.2026.12.2', '1.2026.12.2'), false)
    })

    it('lets a higher version beat a lower one with builds', () => {
      assert.strictEqual(isNewerVersion('1.2026.13', '1.2026.12.9'), true)
      assert.strictEqual(isNewerVersion('1.2026.13.1', '1.2026.12.9'), true)
      assert.strictEqual(isNewerVersion('1.2026.12.9', '1.2026.13'), false)
    })

    it('treats an explicit .0 as the same as no fourth segment', () => {
      assert.strictEqual(isNewerVersion('1.2026.12.0', '1.2026.12'), false)
      assert.strictEqual(isNewerVersion('1.2026.12', '1.2026.12.0'), false)
    })

    it('carries a v prefix on either side', () => {
      assert.strictEqual(isNewerVersion('v1.2026.12.2', '1.2026.12'), true)
      assert.strictEqual(isNewerVersion('1.2026.12.2', 'v1.2026.12'), true)
    })

    it('keeps semver prerelease ordering', () => {
      // A prerelease sorts below the release it precedes, which is semver's rule
      // and worth not breaking for anyone using -beta or -test builds.
      assert.strictEqual(isNewerVersion('1.2026.12-beta.1', '1.2026.12'), false)
      assert.strictEqual(isNewerVersion('1.2026.12', '1.2026.12-beta.1'), true)
      assert.strictEqual(
        isNewerVersion('1.2026.12-beta.2', '1.2026.12-beta.1'),
        true
      )
    })

    it('refuses to order a prerelease against a four-segment build', () => {
      // Semver can't express the four-segment side and the numeric path can't
      // express the prerelease, so there's no sound answer. False means no update
      // is offered, which is the safe direction.
      assert.strictEqual(
        isNewerVersion('1.2026.12.2', '1.2026.12-beta.1'),
        false
      )
    })

    it('never reports an unusable version as newer', () => {
      assert.strictEqual(isNewerVersion('latest', '1.2026.12'), false)
      assert.strictEqual(isNewerVersion('1.2026.12', 'latest'), false)
      assert.strictEqual(isNewerVersion('', '1.2026.12'), false)
      assert.strictEqual(isNewerVersion('1.2026.12.2.1', '1.2026.12'), false)
    })

    it('handles the versions actually shipped so far', () => {
      const shipped = ['1.2026.9', '1.2026.10', '1.2026.11', '1.2026.12']

      for (let i = 1; i < shipped.length; i++) {
        assert.strictEqual(
          isNewerVersion(shipped[i], shipped[i - 1]),
          true,
          `${shipped[i]} should be newer than ${shipped[i - 1]}`
        )
      }
    })
  })
})
