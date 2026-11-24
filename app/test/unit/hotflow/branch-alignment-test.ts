import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  classifyAlignment,
  detectBranchAlignment,
  markTags,
} from '../../../src/lib/hotflow/branch-alignment'
import { layoutProductionNodes } from '../../../src/ui/hotflow/branch-alignment-panel'
import { Branch, BranchType, IAheadBehind } from '../../../src/models/branch'
import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { IMergeSimulation, IShippedRelease } from '../../../src/models/hotflow'
import { parseReleaseVersion } from '../../../src/lib/hotflow/version'
import {
  IProviderTag,
  IRepositoryProvider,
} from '../../../src/lib/hotflow/repository-provider'

const identity = new CommitIdentity(
  'Someone',
  'someone@example.com',
  new Date('2026-10-27T00:00:00Z')
)

function commit(sha: string, merge: boolean): Commit {
  return new Commit(
    sha,
    sha.slice(0, 8),
    merge ? `Merge ${sha}` : `Work ${sha}`,
    '',
    identity,
    identity,
    merge ? ['p1', 'p2'] : ['p1'],
    [],
    []
  )
}

function shipped(tag: string): IShippedRelease {
  const version = parseReleaseVersion(tag)
  assert.ok(version !== null)

  return {
    version,
    tagName: tag,
    sha: tag,
    shippedAt: null,
    commits: [],
    vsoNumbers: [],
  }
}

function localBranch(name: string): Branch {
  return new Branch(
    name,
    `origin/${name}`,
    { sha: name },
    BranchType.Local,
    `refs/heads/${name}`
  )
}

/** A provider answering only the questions alignment asks, keyed by range. */
function fakeProvider(answers: {
  readonly ranges: Record<string, ReadonlyArray<Commit>>
  readonly integrationTags: ReadonlyArray<string>
  readonly mergeBack: IMergeSimulation | null
  readonly drift?: IAheadBehind | null
}): IRepositoryProvider & { readonly asked: Array<string> } {
  const asked: Array<string> = []

  return {
    asked,
    hasWorkingCopy: true,
    getBranches: async () => [],
    getCheckedOutBranchName: async () => null,
    getDefaultBranchName: async () => null,
    getMergedBranches: async () => new Set<string>(),
    getMergedTags: async (): Promise<ReadonlyArray<IProviderTag>> =>
      answers.integrationTags.map(name => ({ name, sha: name, date: null })),
    getAllTagNames: async () => new Set<string>(),
    getAheadBehind: async () => answers.drift ?? null,
    getCommitRange: async (from: string, to: string, limit: number) => {
      asked.push(`${from}..${to}`)
      return (answers.ranges[`${from}..${to}`] ?? []).slice(0, limit)
    },
    getMergeBase: async () => null,
    simulateMerge: async (into: string, from: string) => {
      asked.push(`merge ${from} into ${into}`)
      return answers.mergeBack
    },
    isWorkingTreeClean: async () => true,
    getUpstreamDivergence: async () => null,
  }
}

const history = [
  '1.2026.26',
  '1.2026.25',
  '1.2026.24',
  '1.2026.23',
  '1.2026.22',
].map(shipped)

describe('hotflow/branch-alignment', () => {
  describe('classifyAlignment', () => {
    const noChange: IMergeSimulation = { outcome: 'no-change', files: [] }

    it('is aligned when production has nothing integration lacks', () => {
      assert.strictEqual(classifyAlignment([], null), 'aligned')
    })

    it('is out of line when only merges are off the line and merging back changes nothing', () => {
      assert.strictEqual(
        classifyAlignment([commit('a', true), commit('b', true)], noChange),
        'out-of-line'
      )
    })

    it('is out of line, not stranded, when non-merge commits are copies of work integration has', () => {
      // DataSources, Nexus, HOTBrain-v2: squashes and cherry-picks off the line.
      assert.strictEqual(
        classifyAlignment([commit('a', true), commit('b', false)], noChange),
        'out-of-line'
      )
    })

    it('is stranded when merging back would change files', () => {
      assert.strictEqual(
        classifyAlignment([commit('a', true)], {
          outcome: 'changes',
          files: ['a.cs'],
        }),
        'stranded'
      )
    })

    it('is stranded when merging back would conflict', () => {
      assert.strictEqual(
        classifyAlignment([commit('a', false)], {
          outcome: 'conflicts',
          files: ['Hold.cs'],
        }),
        'stranded'
      )
    })

    it('falls back to commit types when the merge could not be simulated', () => {
      assert.strictEqual(
        classifyAlignment([commit('a', true)], null),
        'out-of-line'
      )
      assert.strictEqual(
        classifyAlignment([commit('a', true), commit('b', false)], null),
        'stranded'
      )
    })
  })

  describe('markTags', () => {
    it('finds where integration stopped containing production', () => {
      const result = markTags(history, new Set(['1.2026.23', '1.2026.22']))

      assert.strictEqual(result.lastAlignedTag, '1.2026.23')
      assert.strictEqual(result.firstUnalignedTag, '1.2026.24')
      assert.deepStrictEqual(
        result.recentTags.map(t => `${t.name}:${t.inIntegration}`),
        [
          '1.2026.22:true',
          '1.2026.23:true',
          '1.2026.24:false',
          '1.2026.25:false',
          '1.2026.26:false',
        ]
      )
    })

    it('has no first unaligned tag when everything is in line', () => {
      const result = markTags(history, new Set(history.map(h => h.tagName)))

      assert.strictEqual(result.lastAlignedTag, '1.2026.26')
      assert.strictEqual(result.firstUnalignedTag, null)
    })

    it('blames the oldest tag in view when none is in line', () => {
      const result = markTags(history, new Set())

      assert.strictEqual(result.lastAlignedTag, null)
      assert.strictEqual(result.firstUnalignedTag, '1.2026.22')
    })
  })

  describe('detectBranchAlignment', () => {
    it('reads the AmadeusWebApi shape as out of line, not stranded', async () => {
      const provider = fakeProvider({
        ranges: {
          'origin/develop..origin/main': [
            commit('56d9eea4', true),
            commit('ee56e208', true),
            commit('d6af4c94', true),
          ],
          // The release doesn't contain main, so shipping it needs a merge.
          'origin/release/1.2026.28..origin/main': [commit('56d9eea4', true)],
        },
        integrationTags: ['1.2026.23', '1.2026.22'],
        mergeBack: { outcome: 'no-change', files: [] },
        drift: { ahead: 0, behind: 2 },
      })

      const alignment = await detectBranchAlignment(
        provider,
        localBranch('develop'),
        localBranch('main'),
        localBranch('release/1.2026.28'),
        history
      )

      assert.ok(alignment !== null)
      assert.strictEqual(alignment.status, 'out-of-line')
      assert.strictEqual(alignment.productionOnlyCommits.length, 3)
      assert.strictEqual(alignment.strandedCommits.length, 0)
      assert.strictEqual(alignment.firstUnalignedTag, '1.2026.24')
      assert.ok(alignment.release !== null)
      assert.strictEqual(alignment.release.containsProduction, false)
      assert.strictEqual(alignment.release.behindIntegration, 2)
      assert.ok(
        provider.asked.includes('merge origin/main into origin/develop'),
        'simulates merging production into integration, not the reverse'
      )
    })

    it('measures the shared branches, not the local ones', async () => {
      const provider = fakeProvider({
        ranges: {},
        integrationTags: [],
        mergeBack: null,
      })

      await detectBranchAlignment(
        provider,
        localBranch('develop'),
        localBranch('main'),
        null,
        []
      )

      assert.deepStrictEqual(provider.asked, ['origin/develop..origin/main'])
    })

    it('skips the merge simulation when production is already in line', async () => {
      const provider = fakeProvider({
        ranges: {},
        integrationTags: history.map(h => h.tagName),
        mergeBack: { outcome: 'changes', files: ['x'] },
      })

      const alignment = await detectBranchAlignment(
        provider,
        localBranch('develop'),
        localBranch('main'),
        null,
        history
      )

      assert.ok(alignment !== null)
      assert.strictEqual(alignment.status, 'aligned')
      assert.strictEqual(alignment.mergeBack, null)
      assert.ok(!provider.asked.some(q => q.startsWith('merge')))
    })
  })

  describe('layoutProductionNodes', () => {
    it('adds a tip when production is off the line with no tag to show it', () => {
      const nodes = layoutProductionNodes(
        [{ name: '1.2026.26', inIntegration: true }],
        'stranded'
      )

      assert.deepStrictEqual(
        nodes.map(n => `${n.label}:${n.inIntegration}`),
        ['.26:true', 'tip:false']
      )
    })

    it('spreads the dots left to right in order', () => {
      const nodes = layoutProductionNodes(
        markTags(history, new Set(['1.2026.23'])).recentTags,
        'out-of-line'
      )

      for (let i = 1; i < nodes.length; i++) {
        assert.ok(nodes[i].x > nodes[i - 1].x)
      }
    })
  })
})
