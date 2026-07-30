import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  compareReleaseVersions,
  parseReleaseVersion,
  suggestNextVersion,
} from '../../../src/lib/hotflow/version'

/** Parses, asserting success — most cases here are about valid input. */
function parse(raw: string) {
  const version = parseReleaseVersion(raw)
  assert.notStrictEqual(version, null, `expected ${raw} to parse`)
  return version!
}

describe('hotflow/version', () => {
  describe('parseReleaseVersion', () => {
    it('parses the House of Travel shape', () => {
      const version = parse('1.2026.9')

      assert.strictEqual(version.raw, '1.2026.9')
      assert.deepStrictEqual(version.segments, [1, 2026, 9])
      assert.strictEqual(version.year, 2026)
      assert.strictEqual(version.cycleSegment, 9)
    })

    it('preserves the raw string verbatim', () => {
      // The raw form is what we match tags against, so it must survive intact.
      assert.strictEqual(parse('  1.2026.9  ').raw, '1.2026.9')
    })

    it('splits on dashes as well as dots', () => {
      const version = parse('1.2026.9-hotfix')

      assert.deepStrictEqual(version.segments, [1, 2026, 9, null])
      assert.strictEqual(version.cycleSegment, 9)
    })

    it('finds the year in any position', () => {
      assert.strictEqual(parse('2026.4').year, 2026)
      assert.strictEqual(parse('1.2026.4').year, 2026)
    })

    it('does not report a lone year as a cycle', () => {
      // `2026` on its own is a year, not "release number 2026".
      assert.strictEqual(parse('2026').cycleSegment, null)
    })

    it('reads the cycle from after the year, not the end', () => {
      // A real hotfix tag from ContentOrchestration. Reading the last segment
      // would say cycle 1, deriving ADO tag 202601 instead of 202616 — which
      // matches nothing and makes every work item look untagged.
      const hotfix = parse('1.2026.16.1')

      assert.strictEqual(hotfix.year, 2026)
      assert.strictEqual(hotfix.cycleSegment, 16)
    })

    it('rejects input with no numeric segment', () => {
      assert.strictEqual(parseReleaseVersion('release-candidate'), null)
      assert.strictEqual(parseReleaseVersion(''), null)
      assert.strictEqual(parseReleaseVersion('   '), null)
    })
  })

  describe('compareReleaseVersions', () => {
    it('orders by numeric segment, not lexically', () => {
      // The bug this guards: '1.2026.10' < '1.2026.9' as strings.
      assert.ok(
        compareReleaseVersions(parse('1.2026.9'), parse('1.2026.10')) < 0
      )
      assert.ok(
        compareReleaseVersions(parse('1.2026.10'), parse('1.2026.9')) > 0
      )
    })

    it('treats identical versions as equal', () => {
      assert.strictEqual(
        compareReleaseVersions(parse('1.2026.9'), parse('1.2026.9')),
        0
      )
    })

    it('orders across years', () => {
      assert.ok(
        compareReleaseVersions(parse('1.2025.12'), parse('1.2026.1')) < 0
      )
    })

    it('sorts a shorter prefix before a longer version', () => {
      assert.ok(compareReleaseVersions(parse('1.2026'), parse('1.2026.1')) < 0)
    })

    it('sorts non-numeric segments after numeric ones', () => {
      assert.ok(
        compareReleaseVersions(parse('1.2026.9'), parse('1.2026.rc')) < 0
      )
    })

    it('sorts a full list the way a release timeline reads', () => {
      const versions = ['1.2026.10', '1.2025.12', '1.2026.9', '1.2026.2'].map(
        parse
      )

      const sorted = [...versions].sort(compareReleaseVersions).map(v => v.raw)

      assert.deepStrictEqual(sorted, [
        '1.2025.12',
        '1.2026.2',
        '1.2026.9',
        '1.2026.10',
      ])
    })
  })

  describe('suggestNextVersion', () => {
    it('increments the trailing segment', () => {
      assert.strictEqual(suggestNextVersion(parse('1.2026.9')), '1.2026.10')
    })

    it('carries past ten without renumbering anything else', () => {
      assert.strictEqual(suggestNextVersion(parse('1.2026.10')), '1.2026.11')
    })

    it('preserves separators', () => {
      assert.strictEqual(suggestNextVersion(parse('1-2026-9')), '1-2026-10')
    })

    it('increments the last numeric part when a suffix follows', () => {
      // `1.2026.9-hotfix` -> the 9 is the last number present.
      assert.strictEqual(
        suggestNextVersion(parse('1.2026.9-hotfix')),
        '1.2026.10-hotfix'
      )
    })
  })
})
