import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Branch, BranchType } from '../../../src/models/branch'
import { Repository } from '../../../src/models/repository'
import {
  CleanupMinAgeDays,
  findCleanupBranches,
  ICleanupCandidate,
  isProtectedBranchName,
  selectCleanupBranches,
  staleCleanupBranches,
} from '../../../src/lib/hotflow/branch-cleanup'

const day = 24 * 60 * 60 * 1000
const now = 1_800_000_000_000

function local(name: string): Branch {
  return new Branch(
    name,
    null,
    { sha: `sha-${name}` },
    BranchType.Local,
    `refs/heads/${name}`
  )
}

function remote(name: string, remoteName = 'origin'): Branch {
  return new Branch(
    `${remoteName}/${name}`,
    null,
    { sha: `sha-${name}` },
    BranchType.Remote,
    `refs/remotes/${remoteName}/${name}`
  )
}

function candidate(
  name: string,
  overrides: Partial<ICleanupCandidate> = {}
): ICleanupCandidate {
  return {
    name,
    local: local(name),
    remote: remote(name),
    authorEmail: 'dan@hot.co.nz',
    lastCommitAt: now - 30 * day,
    mergedIntoIntegration: true,
    mergedIntoRelease: true,
    ...overrides,
  }
}

const context = {
  myEmails: new Set(['dan@hot.co.nz']),
  protectedNames: new Set(['develop', 'main']),
  currentBranchName: null,
  now,
}

describe('hotflow/branch-cleanup', () => {
  describe('isProtectedBranchName', () => {
    const names = new Set(['trunk', 'live'])

    it('protects the integration and production names it is given', () => {
      assert.strictEqual(isProtectedBranchName('trunk', names), true)
      assert.strictEqual(isProtectedBranchName('live', names), true)
    })

    it('protects the usual trunk names', () => {
      for (const name of ['main', 'master', 'develop', 'development', 'dev']) {
        assert.strictEqual(isProtectedBranchName(name, new Set()), true, name)
      }
    })

    it('protects release and hotfix lines and HEAD', () => {
      assert.strictEqual(
        isProtectedBranchName('release/1.2026.26', names),
        true
      )
      assert.strictEqual(
        isProtectedBranchName('hotfix/1.2026.26.1', names),
        true
      )
      assert.strictEqual(isProtectedBranchName('HEAD', names), true)
    })

    it('does not protect a feature branch', () => {
      assert.strictEqual(
        isProtectedBranchName('feature/123-thing', names),
        false
      )
      assert.strictEqual(isProtectedBranchName('devices/1', names), false)
    })
  })

  describe('selectCleanupBranches', () => {
    it('keeps only the user’s branches', () => {
      const result = selectCleanupBranches(
        [
          candidate('feature/1-mine'),
          candidate('feature/2-theirs', { authorEmail: 'other@hot.co.nz' }),
        ],
        context
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/1-mine']
      )
    })

    it('needs the branch merged into both the integration branch and a release', () => {
      const result = selectCleanupBranches(
        [
          candidate('feature/1-both'),
          candidate('feature/2-develop-only', { mergedIntoRelease: false }),
          candidate('feature/3-release-only', { mergedIntoIntegration: false }),
          candidate('feature/4-neither', {
            mergedIntoIntegration: false,
            mergedIntoRelease: false,
          }),
        ],
        context
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/1-both']
      )
    })

    it('can ignore the release when told to', () => {
      const result = selectCleanupBranches(
        [
          candidate('feature/1-both'),
          candidate('feature/2-develop-only', { mergedIntoRelease: false }),
          candidate('feature/3-release-only', { mergedIntoIntegration: false }),
        ],
        { ...context, requireRelease: false }
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/1-both', 'feature/2-develop-only']
      )
    })

    it('keeps only the branches old enough for a notification', () => {
      const result = staleCleanupBranches(
        selectCleanupBranches(
          [
            candidate('feature/1-old', { lastCommitAt: now - 15 * day }),
            candidate('feature/2-young', { lastCommitAt: now - 2 * day }),
          ],
          context
        )
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/1-old']
      )
    })

    it('never offers a protected branch', () => {
      const result = selectCleanupBranches(
        [
          candidate('develop'),
          candidate('release/1.2026.20'),
          candidate('main'),
          candidate('feature/1-ok'),
        ],
        context
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/1-ok']
      )
    })

    it('never offers the checked-out branch', () => {
      const result = selectCleanupBranches(
        [candidate('feature/1-here'), candidate('feature/2-away')],
        { ...context, currentBranchName: 'feature/1-here' }
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/2-away']
      )
    })

    it('preselects from exactly fourteen days', () => {
      assert.strictEqual(CleanupMinAgeDays, 14)

      const result = selectCleanupBranches(
        [
          candidate('feature/1-exact', { lastCommitAt: now - 14 * day }),
          candidate('feature/2-almost', {
            lastCommitAt: now - 14 * day + 1,
          }),
          candidate('feature/3-thirteen', { lastCommitAt: now - 13 * day }),
          candidate('feature/4-old', { lastCommitAt: now - 90 * day }),
        ],
        context
      )

      const byName = new Map(result.map(b => [b.name, b.preselected]))

      assert.strictEqual(byName.get('feature/1-exact'), true)
      assert.strictEqual(byName.get('feature/2-almost'), false)
      assert.strictEqual(byName.get('feature/3-thirteen'), false)
      assert.strictEqual(byName.get('feature/4-old'), true)
    })

    it('still lists the young ones, unticked', () => {
      const result = selectCleanupBranches(
        [candidate('feature/1-young', { lastCommitAt: now - 2 * day })],
        context
      )

      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].preselected, false)
    })

    it('puts the stalest first', () => {
      const result = selectCleanupBranches(
        [
          candidate('feature/1-mid', { lastCommitAt: now - 30 * day }),
          candidate('feature/2-new', { lastCommitAt: now - 15 * day }),
          candidate('feature/3-old', { lastCommitAt: now - 100 * day }),
        ],
        context
      )

      assert.deepStrictEqual(
        result.map(b => b.name),
        ['feature/3-old', 'feature/1-mid', 'feature/2-new']
      )
    })

    it('keeps a local-only and a remote-only copy as they are', () => {
      const localOnly = candidate('feature/1-local', { remote: null })
      const remoteOnly = candidate('feature/2-remote', { local: null })

      const result = selectCleanupBranches([localOnly, remoteOnly], context)
      const byName = new Map(result.map(b => [b.name, b]))

      assert.strictEqual(byName.get('feature/1-local')?.remote, null)
      assert.strictEqual(
        byName.get('feature/1-local')?.local?.name,
        'feature/1-local'
      )
      assert.strictEqual(byName.get('feature/2-remote')?.local, null)
      assert.strictEqual(
        byName.get('feature/2-remote')?.remote?.name,
        'origin/feature/2-remote'
      )
    })

    it('does not mutate its input', () => {
      const input = [candidate('feature/1-a'), candidate('feature/2-b')]
      const before = input.map(c => c.name)

      selectCleanupBranches(input, context)

      assert.deepStrictEqual(
        input.map(c => c.name),
        before
      )
    })
  })

  describe('findCleanupBranches', () => {
    const repository = new Repository('C:/repo', 1, null, false)

    const tipLine = (ref: string, email: string, daysOld: number) =>
      `${ref}\0<${email}>\0${Math.floor((now - daysOld * day) / 1000)}`

    /**
     * A git that knows the tips and what each target contains. `--merged=<ref>`
     * answers with the listed refs that appear in that target's set.
     */
    function fakeGit(
      tips: ReadonlyArray<string>,
      merged: { [target: string]: ReadonlyArray<string> }
    ) {
      const calls: Array<ReadonlyArray<string>> = []

      const run = async (args: ReadonlyArray<string>) => {
        calls.push(args)

        const mergedArg = args.find(a => a.startsWith('--merged='))

        if (mergedArg === undefined) {
          return tips.join('\n')
        }

        const target = mergedArg.slice('--merged='.length)
        const asked = args.filter(a => a.startsWith('refs/'))

        return asked.filter(r => (merged[target] ?? []).includes(r)).join('\n')
      }

      return { run, calls }
    }

    const base = {
      integrationRefs: ['refs/heads/develop', 'refs/remotes/origin/develop'],
      releaseRefs: [
        'refs/remotes/origin/release/1.2026.26',
        'refs/remotes/origin/main',
      ],
      integrationBranchName: 'develop',
      productionBranchName: 'main',
      currentBranchName: null,
      myEmails: new Set(['dan@hot.co.nz']),
      now,
    }

    it('lists a branch merged into develop and a release', async () => {
      const { run } = fakeGit(
        [
          tipLine('refs/heads/feature/1-done', 'dan@hot.co.nz', 30),
          tipLine('refs/remotes/origin/feature/1-done', 'dan@hot.co.nz', 30),
        ],
        {
          'refs/remotes/origin/develop': [
            'refs/heads/feature/1-done',
            'refs/remotes/origin/feature/1-done',
          ],
          'refs/remotes/origin/release/1.2026.26': [
            'refs/heads/feature/1-done',
            'refs/remotes/origin/feature/1-done',
          ],
        }
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [local('feature/1-done'), remote('feature/1-done')],
        runGit: run,
      })

      assert.deepStrictEqual(
        result.map(b => [b.name, b.preselected]),
        [['feature/1-done', true]]
      )
      assert.strictEqual(result[0].local?.ref, 'refs/heads/feature/1-done')
      assert.strictEqual(
        result[0].remote?.ref,
        'refs/remotes/origin/feature/1-done'
      )
    })

    it('leaves out a branch merged into develop but not into any release', async () => {
      const { run } = fakeGit(
        [tipLine('refs/heads/feature/2-fresh', 'dan@hot.co.nz', 30)],
        { 'refs/heads/develop': ['refs/heads/feature/2-fresh'] }
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [local('feature/2-fresh')],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
    })

    it('leaves out a branch with commits develop does not have', async () => {
      const { run } = fakeGit(
        [tipLine('refs/heads/feature/3-wip', 'dan@hot.co.nz', 60)],
        {}
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [local('feature/3-wip')],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
    })

    it('leaves out a branch when only one of its copies is merged', async () => {
      const { run } = fakeGit(
        [
          tipLine('refs/heads/feature/4-ahead', 'dan@hot.co.nz', 60),
          tipLine('refs/remotes/origin/feature/4-ahead', 'dan@hot.co.nz', 60),
        ],
        {
          'refs/heads/develop': ['refs/remotes/origin/feature/4-ahead'],
          'refs/remotes/origin/main': ['refs/remotes/origin/feature/4-ahead'],
        }
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [local('feature/4-ahead'), remote('feature/4-ahead')],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
    })

    it('leaves out other people’s branches, and never asks git about them', async () => {
      const { run, calls } = fakeGit(
        [tipLine('refs/heads/feature/5-theirs', 'other@hot.co.nz', 60)],
        {
          'refs/heads/develop': ['refs/heads/feature/5-theirs'],
          'refs/remotes/origin/main': ['refs/heads/feature/5-theirs'],
        }
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [local('feature/5-theirs')],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
      assert.ok(!calls.some(c => c.some(a => a.startsWith('--merged='))))
    })

    it('never offers the checked-out branch or the flow’s own branches', async () => {
      const { run } = fakeGit(
        [
          tipLine('refs/heads/feature/6-here', 'dan@hot.co.nz', 60),
          tipLine('refs/heads/develop', 'dan@hot.co.nz', 60),
          tipLine('refs/heads/release/1.2026.20', 'dan@hot.co.nz', 60),
        ],
        {
          'refs/heads/develop': [
            'refs/heads/feature/6-here',
            'refs/heads/develop',
            'refs/heads/release/1.2026.20',
          ],
          'refs/remotes/origin/main': [
            'refs/heads/feature/6-here',
            'refs/heads/develop',
            'refs/heads/release/1.2026.20',
          ],
        }
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        currentBranchName: 'feature/6-here',
        branches: [
          local('feature/6-here'),
          local('develop'),
          local('release/1.2026.20'),
        ],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
    })

    it('ignores Desktop’s fork remotes', async () => {
      const { run } = fakeGit(
        [
          tipLine(
            'refs/remotes/github-desktop-someone/feature/7-fork',
            'dan@hot.co.nz',
            60
          ),
        ],
        {}
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [remote('feature/7-fork', 'github-desktop-someone')],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
    })

    it('copes with a target that git cannot resolve', async () => {
      const calls: Array<ReadonlyArray<string>> = []
      const run = async (args: ReadonlyArray<string>) => {
        calls.push(args)

        if (args.some(a => a.startsWith('--merged='))) {
          throw new Error('malformed object name')
        }

        return tipLine('refs/heads/feature/8-x', 'dan@hot.co.nz', 60)
      }

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [local('feature/8-x')],
        runGit: run,
      })

      assert.deepStrictEqual(result, [])
    })

    it('keeps a remote-only branch with its remote copy', async () => {
      const { run } = fakeGit(
        [tipLine('refs/remotes/origin/feature/9-remote', 'dan@hot.co.nz', 20)],
        {
          'refs/remotes/origin/develop': [
            'refs/remotes/origin/feature/9-remote',
          ],
          'refs/remotes/origin/main': ['refs/remotes/origin/feature/9-remote'],
        }
      )

      const result = await findCleanupBranches(repository, {
        ...base,
        branches: [remote('feature/9-remote')],
        runGit: run,
      })

      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].local, null)
      assert.strictEqual(
        result[0].remote?.ref,
        'refs/remotes/origin/feature/9-remote'
      )
    })
  })
})
