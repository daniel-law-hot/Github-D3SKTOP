import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IReleaseChoice,
  isShipped,
  pickCurrentRelease,
} from '../../../src/lib/hotflow/pick-release'
import { parseReleaseVersion } from '../../../src/lib/hotflow/version'
import { IReleaseVersion } from '../../../src/models/hotflow'

function version(raw: string): IReleaseVersion {
  const parsed = parseReleaseVersion(raw)
  assert.ok(parsed !== null, `expected ${raw} to parse`)
  return parsed
}

function release(raw: string, isMergedIntoProduction = false): IReleaseChoice {
  return {
    version: version(raw),
    isMergedIntoProduction,
    branchName: `release/${raw}`,
  }
}

function versions(raws: ReadonlyArray<string>) {
  return raws.map(version)
}

function picked(selection: { current: IReleaseChoice | null }) {
  return selection.current?.version.raw ?? null
}

describe('hotflow/pick-release', () => {
  describe('isShipped', () => {
    it('treats a branch fully merged into production as shipped', () => {
      assert.strictEqual(isShipped(release('1.2026.5', true), []), true)
    })

    it('treats a tagged version as shipped even with the branch unmerged', () => {
      // HOTWebsites 1.2026.7: tagged on main in July, branch still 31 commits
      // ahead of it. Merged-only checking called this the next release to ship.
      assert.strictEqual(
        isShipped(release('1.2026.7'), versions(['1.2026.7'])),
        true
      )
    })

    it('treats an unmerged, untagged release as open', () => {
      assert.strictEqual(
        isShipped(release('1.2026.17'), versions(['1.2026.11'])),
        false
      )
    })

    it('compares versions rather than tag strings', () => {
      // 1.2026.07 and 1.2026.7 are the same release.
      assert.strictEqual(
        isShipped(release('1.2026.7'), versions(['1.2026.07'])),
        true
      )
    })

    it('does not confuse a hotfix with its parent release', () => {
      assert.strictEqual(
        isShipped(release('1.2026.16.1'), versions(['1.2026.16'])),
        false
      )
    })
  })

  describe('pickCurrentRelease', () => {
    // The real HOTWebsites shape: sixteen release branches, nine shipped, and
    // several open at once for three different products.
    const hotWebsites = [
      release('1.2026.2', true),
      release('1.2026.5', true),
      release('1.2026.6', true),
      release('1.2026.7'),
      release('1.2026.11', true),
      release('1.2026.12'),
      release('1.2026.13'),
      release('1.2026.14'),
      release('1.2026.15'),
      release('1.2026.16'),
      release('1.2026.17'),
    ]

    const shippedTags = versions([
      '1.2026.3',
      '1.2026.4',
      '1.2026.5',
      '1.2026.6',
      '1.2026.7',
      '1.2026.8',
      '1.2026.9',
      '1.2026.10',
      '1.2026.11',
    ])

    it('honours the checked-out release branch', () => {
      const selection = pickCurrentRelease(
        hotWebsites,
        shippedTags,
        'release/1.2026.17'
      )

      assert.strictEqual(picked(selection), '1.2026.17')
    })

    it('honours a checked-out release that is not the highest', () => {
      // 1.2026.15 is a different product's release, finished and awaiting
      // go-live. Standing on it must show it, not the highest version.
      const selection = pickCurrentRelease(
        hotWebsites,
        shippedTags,
        'release/1.2026.15'
      )

      assert.strictEqual(picked(selection), '1.2026.15')
    })

    it('shows a deliberately checked-out shipped release', () => {
      const selection = pickCurrentRelease(
        hotWebsites,
        shippedTags,
        'release/1.2026.7'
      )

      assert.strictEqual(picked(selection), '1.2026.7')
    })

    it('falls back to the highest open release off a release branch', () => {
      const selection = pickCurrentRelease(hotWebsites, shippedTags, 'develop')

      assert.strictEqual(picked(selection), '1.2026.17')
    })

    it('never falls back to a shipped-but-unmerged release', () => {
      // The reported bug: 1.2026.7 chosen over ten later releases.
      const selection = pickCurrentRelease(hotWebsites, shippedTags, null)

      assert.notStrictEqual(picked(selection), '1.2026.7')
      assert.strictEqual(picked(selection), '1.2026.17')
    })

    it('lists every other open release, highest first', () => {
      const selection = pickCurrentRelease(
        hotWebsites,
        shippedTags,
        'release/1.2026.17'
      )

      // The other products' releases. 1.2026.7 is absent — it shipped.
      assert.deepStrictEqual(
        selection.others.map(o => o.version.raw),
        ['1.2026.16', '1.2026.15', '1.2026.14', '1.2026.13', '1.2026.12']
      )
    })

    it('excludes the checked-out release from the others', () => {
      const selection = pickCurrentRelease(
        hotWebsites,
        shippedTags,
        'release/1.2026.15'
      )

      assert.ok(!selection.others.some(o => o.version.raw === '1.2026.15'))
    })

    it('lists nothing else when only one release is open', () => {
      const selection = pickCurrentRelease(
        [release('1.2026.5', true), release('1.2026.17')],
        versions(['1.2026.5']),
        null
      )

      assert.strictEqual(picked(selection), '1.2026.17')
      assert.deepStrictEqual(selection.others, [])
    })

    it('returns null when every release has shipped', () => {
      const selection = pickCurrentRelease(
        [release('1.2026.5', true), release('1.2026.6')],
        versions(['1.2026.6']),
        null
      )

      assert.strictEqual(picked(selection), null)
      assert.deepStrictEqual(selection.others, [])
    })

    it('returns null when there are no release branches at all', () => {
      const selection = pickCurrentRelease([], [], null)

      assert.strictEqual(picked(selection), null)
    })

    it('ignores a checked-out branch that is not a release branch', () => {
      const selection = pickCurrentRelease(
        hotWebsites,
        shippedTags,
        'feature/12345-something'
      )

      assert.strictEqual(picked(selection), '1.2026.17')
    })

    it('does not mutate the candidates', () => {
      const candidates = [release('1.2026.5'), release('1.2026.17')]
      const before = candidates.map(c => c.version.raw)

      pickCurrentRelease(candidates, [], null)

      assert.deepStrictEqual(
        candidates.map(c => c.version.raw),
        before
      )
    })
  })
})
