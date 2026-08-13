import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IManifestEntry,
  cycleOfVersion,
  cycleSequence,
  isVersionInCycle,
  parseCycleQuery,
  reconcileCycle,
} from '../../../src/lib/hotflow/cycle'
import { parseReleaseVersion } from '../../../src/lib/hotflow/version'
import { IWorkItem } from '../../../src/models/hotflow'

/** Parses, asserting success — most cases here are about valid input. */
function version(raw: string) {
  const parsed = parseReleaseVersion(raw)
  assert.notStrictEqual(parsed, null, `expected ${raw} to parse`)
  return parsed!
}

function releaseItem(id: number, title: string): IWorkItem {
  return {
    id,
    title,
    workItemType: 'Release',
    state: 'Active',
    assignedTo: null,
    tags: [],
    releaseSequence: 202618,
  }
}

function entry(
  id: number,
  title: string,
  repositoryName: string | null
): IManifestEntry {
  return { releaseItem: releaseItem(id, title), repositoryName }
}

describe('hotflow/cycle', () => {
  describe('parseCycleQuery', () => {
    it('parses a release version', () => {
      assert.deepStrictEqual(parseCycleQuery('1.2026.18'), {
        year: 2026,
        cycle: 18,
      })
    })

    it('parses a hotfix version as the cycle it patches', () => {
      assert.deepStrictEqual(parseCycleQuery('1.2026.18.1'), {
        year: 2026,
        cycle: 18,
      })
    })

    it('parses a bare year and cycle', () => {
      assert.deepStrictEqual(parseCycleQuery('2026.18'), {
        year: 2026,
        cycle: 18,
      })
    })

    it('parses the Azure DevOps sequence number', () => {
      assert.deepStrictEqual(parseCycleQuery('202618'), {
        year: 2026,
        cycle: 18,
      })
    })

    it('parses a single-digit cycle', () => {
      assert.deepStrictEqual(parseCycleQuery('1.2026.9'), {
        year: 2026,
        cycle: 9,
      })
    })

    it('tolerates surrounding whitespace', () => {
      assert.deepStrictEqual(parseCycleQuery('  1.2026.18  '), {
        year: 2026,
        cycle: 18,
      })
    })

    it('rejects an empty query', () => {
      assert.strictEqual(parseCycleQuery(''), null)
      assert.strictEqual(parseCycleQuery('   '), null)
    })

    it('rejects a cycle out of range', () => {
      assert.strictEqual(parseCycleQuery('1.2026.54'), null)
      assert.strictEqual(parseCycleQuery('1.2026.0'), null)
    })

    it('rejects an implausible year', () => {
      assert.strictEqual(parseCycleQuery('1.1999.18'), null)
    })

    it('rejects a version with no year-shaped segment', () => {
      assert.strictEqual(parseCycleQuery('1.26.18'), null)
    })

    it('rejects a year with nothing after it', () => {
      assert.strictEqual(parseCycleQuery('1.2026'), null)
    })

    it('rejects a non-numeric cycle', () => {
      assert.strictEqual(parseCycleQuery('1.2026.beta'), null)
    })
  })

  describe('cycleOfVersion', () => {
    it('reads the cycle from a release version', () => {
      assert.deepStrictEqual(cycleOfVersion(version('1.2026.18')), {
        year: 2026,
        cycle: 18,
      })
    })

    it('reads a hotfix as its parent cycle', () => {
      assert.deepStrictEqual(cycleOfVersion(version('1.2026.18.1')), {
        year: 2026,
        cycle: 18,
      })
    })

    it('returns null when there is no plausible year', () => {
      assert.strictEqual(cycleOfVersion(version('3.7')), null)
    })
  })

  describe('isVersionInCycle', () => {
    const cycle18 = { year: 2026, cycle: 18 }

    it('matches the exact version', () => {
      assert.strictEqual(isVersionInCycle(version('1.2026.18'), cycle18), true)
    })

    it('matches a hotfix of that cycle', () => {
      assert.strictEqual(
        isVersionInCycle(version('1.2026.18.1'), cycle18),
        true
      )
    })

    it('does not match the next cycle', () => {
      assert.strictEqual(isVersionInCycle(version('1.2026.19'), cycle18), false)
    })

    it('does not match the same cycle in another year', () => {
      assert.strictEqual(isVersionInCycle(version('1.2025.18'), cycle18), false)
    })

    it('does not match a version carrying no cycle', () => {
      assert.strictEqual(isVersionInCycle(version('3.7'), cycle18), false)
    })
  })

  describe('cycleSequence', () => {
    it('builds the Azure DevOps release sequence number', () => {
      assert.strictEqual(cycleSequence({ year: 2026, cycle: 18 }), 202618)
    })

    it('pads a single-digit cycle', () => {
      assert.strictEqual(cycleSequence({ year: 2026, cycle: 9 }), 202609)
    })
  })

  describe('reconcileCycle', () => {
    it('pairs a release record with the branch cut for it', () => {
      const rows = reconcileCycle(
        [entry(16578, 'ContentOrchestrationApi', 'ContentOrchestrationApi')],
        ['ContentOrchestrationApi']
      )

      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].presence, 'planned-and-cut')
      assert.strictEqual(rows[0].repositoryName, 'ContentOrchestrationApi')
      assert.strictEqual(rows[0].releaseItem?.id, 16578)
    })

    it('reports a release record with no branch as not cut', () => {
      const rows = reconcileCycle(
        [entry(16610, 'CO Notification Service', 'CONotificationService')],
        ['ContentOrchestrationApi']
      )

      const notCut = rows.find(r => r.presence === 'not-cut')

      assert.notStrictEqual(notCut, undefined)
      assert.strictEqual(notCut!.releaseItem?.id, 16610)
    })

    it('reports a branch with no release record as unplanned', () => {
      const rows = reconcileCycle([], ['StubaWebAPI'])

      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].presence, 'unplanned')
      assert.strictEqual(rows[0].repositoryName, 'StubaWebAPI')
      assert.strictEqual(rows[0].releaseItem, null)
    })

    it('matches repository names case-insensitively', () => {
      const rows = reconcileCycle(
        [entry(16579, 'AmadeusWebApi', 'amadeuswebapi')],
        ['AmadeusWebApi']
      )

      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].presence, 'planned-and-cut')
    })

    it("prefers git's spelling of the repository name", () => {
      const rows = reconcileCycle(
        [entry(16579, 'AmadeusWebApi', 'AMADEUSWEBAPI')],
        ['AmadeusWebApi']
      )

      assert.strictEqual(rows[0].repositoryName, 'AmadeusWebApi')
    })

    it('keeps an unresolved release record as its own row', () => {
      const rows = reconcileCycle(
        [entry(16585, 'CO Config Portal', null)],
        ['ContentOrchestrationApi']
      )

      const unresolved = rows.find(r => r.releaseItem?.id === 16585)

      assert.notStrictEqual(unresolved, undefined)
      assert.strictEqual(unresolved!.repositoryName, null)
      assert.strictEqual(unresolved!.presence, 'not-cut')

      // The repository it couldn't be matched to must not be swallowed by it —
      // it still needs to appear, as unplanned.
      assert.strictEqual(
        rows.some(
          r =>
            r.presence === 'unplanned' &&
            r.repositoryName === 'ContentOrchestrationApi'
        ),
        true
      )
    })

    it('handles the whole CO stack', () => {
      const rows = reconcileCycle(
        [
          entry(16578, 'ContentOrchestrationApi', 'ContentOrchestrationApi'),
          entry(16585, 'CO Config Portal', 'COConfigPortal'),
          entry(16579, 'AmadeusWebApi', 'AmadeusWebApi'),
          entry(16602, 'DotWWebAPI', 'DotWWebAPI'),
          entry(16586, 'StubaWebAPI', 'StubaWebAPI'),
          entry(16587, 'Jetstar WebAPI', 'JetstarWebAPI'),
          entry(16610, 'CO Notification Service', 'CONotificationService'),
        ],
        [
          'ContentOrchestrationApi',
          'COConfigPortal',
          'AmadeusWebApi',
          'DotWWebAPI',
          'StubaWebAPI',
          'JetstarWebAPI',
        ]
      )

      assert.strictEqual(rows.length, 7)
      assert.strictEqual(
        rows.filter(r => r.presence === 'planned-and-cut').length,
        6
      )

      const notCut = rows.filter(r => r.presence === 'not-cut')
      assert.strictEqual(notCut.length, 1)
      assert.strictEqual(notCut[0].releaseItem?.id, 16610)
      assert.strictEqual(rows.filter(r => r.presence === 'unplanned').length, 0)
    })

    it('returns nothing for an empty cycle', () => {
      assert.deepStrictEqual(reconcileCycle([], []), [])
    })
  })
})
