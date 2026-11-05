import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ForgottenMinAgeDays,
  findForgottenBranches,
  IForgottenCandidate,
  isMine,
  parseTipInfo,
  selectForgotten,
} from '../../../src/lib/hotflow/forgotten-branches'
import { Branch, BranchType } from '../../../src/models/branch'
import { IFeatureBranchState } from '../../../src/models/hotflow'
import { Repository } from '../../../src/models/repository'

const me = new Set(['dan@hot.co.nz', 'DanLaw'])

function candidate(
  branchName: string,
  overrides: Partial<IForgottenCandidate> = {}
): IForgottenCandidate {
  return {
    branchName,
    vso: 1,
    authorEmail: 'dan@hot.co.nz',
    lastCommitAt: 1000,
    aheadCount: 2,
    isLocalOnly: false,
    ...overrides,
  }
}

const noPullRequests = new Set<string>()
const nothingHidden = new Set<string>()

describe('hotflow/forgotten-branches', () => {
  describe('isMine', () => {
    it('matches an email regardless of case', () => {
      assert.strictEqual(isMine('Dan@HOT.co.nz', me), true)
    })

    it('does not match somebody else', () => {
      assert.strictEqual(isMine('fio@hot.co.nz', me), false)
    })

    it('does not match an empty email', () => {
      assert.strictEqual(isMine('', me), false)
    })

    it('matches a noreply address with an id, from the bare login', () => {
      assert.strictEqual(
        isMine('123+danlaw@users.noreply.github.com', me),
        true
      )
    })

    it('matches a noreply address without an id, from the bare login', () => {
      assert.strictEqual(isMine('DanLaw@users.noreply.github.com', me), true)
    })

    it('treats the two noreply forms as the same person', () => {
      const mine = new Set(['123+danlaw@users.noreply.github.com'])

      assert.strictEqual(isMine('danlaw@users.noreply.github.com', mine), true)
      assert.strictEqual(
        isMine('999+danlaw@users.noreply.github.com', mine),
        true
      )
    })

    it('does not match another login behind a noreply address', () => {
      assert.strictEqual(
        isMine('5+someoneelse@users.noreply.github.com', me),
        false
      )
    })
  })

  describe('selectForgotten', () => {
    it('keeps only the user’s branches', () => {
      const { shown } = selectForgotten(
        [
          candidate('feature/1-mine'),
          candidate('feature/2-theirs', { authorEmail: 'fio@hot.co.nz' }),
        ],
        {
          myEmails: me,
          branchesWithPullRequest: noPullRequests,
          hidden: nothingHidden,
        }
      )

      assert.deepStrictEqual(
        shown.map(s => s.branchName),
        ['feature/1-mine']
      )
    })

    it('drops a branch with nothing the integration branch lacks', () => {
      const { shown } = selectForgotten(
        [candidate('feature/1-empty', { aheadCount: 0 })],
        {
          myEmails: me,
          branchesWithPullRequest: noPullRequests,
          hidden: nothingHidden,
        }
      )

      assert.deepStrictEqual(shown, [])
    })

    it('drops a branch that has had a pull request in any state', () => {
      const { shown } = selectForgotten(
        [candidate('feature/1-merged-pr'), candidate('feature/2-forgotten')],
        {
          myEmails: me,
          branchesWithPullRequest: new Set(['feature/1-merged-pr']),
          hidden: nothingHidden,
        }
      )

      assert.deepStrictEqual(
        shown.map(s => s.branchName),
        ['feature/2-forgotten']
      )
    })

    it('counts hidden branches without showing them', () => {
      const result = selectForgotten(
        [candidate('feature/1-a'), candidate('feature/2-b')],
        {
          myEmails: me,
          branchesWithPullRequest: noPullRequests,
          hidden: new Set(['feature/2-b']),
        }
      )

      assert.deepStrictEqual(
        result.shown.map(s => s.branchName),
        ['feature/1-a']
      )
      assert.strictEqual(result.hiddenCount, 1)
    })

    it('does not count a hidden branch that was never a candidate', () => {
      const result = selectForgotten(
        [candidate('feature/1-merged', { aheadCount: 0 })],
        {
          myEmails: me,
          branchesWithPullRequest: noPullRequests,
          hidden: new Set(['feature/1-merged']),
        }
      )

      assert.strictEqual(result.hiddenCount, 0)
    })

    it('lists the most recent commit first', () => {
      const { shown } = selectForgotten(
        [
          candidate('feature/1-old', { lastCommitAt: 100 }),
          candidate('feature/2-new', { lastCommitAt: 300 }),
          candidate('feature/3-mid', { lastCommitAt: 200 }),
        ],
        {
          myEmails: me,
          branchesWithPullRequest: noPullRequests,
          hidden: nothingHidden,
        }
      )

      assert.deepStrictEqual(
        shown.map(s => s.branchName),
        ['feature/2-new', 'feature/3-mid', 'feature/1-old']
      )
    })
  })

  describe('parseTipInfo', () => {
    const line = (ref: string, email: string, date: string) =>
      `${ref}\0${email}\0${date}`

    it('reads local and remote branches', () => {
      const tips = parseTipInfo(
        [
          line('refs/heads/feature/1-a', '<dan@hot.co.nz>', '1700000000'),
          line(
            'refs/remotes/origin/feature/1-a',
            '<dan@hot.co.nz>',
            '1690000000'
          ),
        ].join('\n')
      )

      assert.deepStrictEqual(tips, [
        {
          ref: 'refs/heads/feature/1-a',
          name: 'feature/1-a',
          isRemote: false,
          authorEmail: 'dan@hot.co.nz',
          committedAt: 1700000000000,
        },
        {
          ref: 'refs/remotes/origin/feature/1-a',
          name: 'feature/1-a',
          isRemote: true,
          authorEmail: 'dan@hot.co.nz',
          committedAt: 1690000000000,
        },
      ])
    })

    it('skips remote HEAD pointers and unparseable lines', () => {
      const tips = parseTipInfo(
        [
          line('refs/remotes/origin/HEAD', '<a@b.c>', '1'),
          'garbage',
          line('refs/heads/x', '<a@b.c>', 'not-a-number'),
          line('refs/heads/ok', '<a@b.c>', '5'),
        ].join('\n')
      )

      assert.deepStrictEqual(
        tips.map(t => t.name),
        ['ok']
      )
    })
  })

  describe('the time gate', () => {
    const day = 24 * 60 * 60 * 1000
    const now = 1_800_000_000_000
    const context = {
      myEmails: new Set(['dan@hot.co.nz']),
      branchesWithPullRequest: new Set<string>(),
      hidden: new Set<string>(),
      now,
    }

    const aged = (name: string, days: number) =>
      candidate(name, { lastCommitAt: now - days * day })

    it('is a week', () => {
      assert.strictEqual(ForgottenMinAgeDays, 7)
    })

    it('leaves out a branch touched within the week', () => {
      const { shown } = selectForgotten(
        [aged('feature/1-today', 0), aged('feature/2-lastweek', 6)],
        context
      )

      assert.deepStrictEqual(shown, [])
    })

    it('lists a branch left alone for the full week', () => {
      const { shown } = selectForgotten([aged('feature/1-week', 7)], context)

      assert.deepStrictEqual(
        shown.map(b => b.branchName),
        ['feature/1-week']
      )
    })

    it('lists older ones and keeps newest first', () => {
      const { shown } = selectForgotten(
        [
          aged('feature/1-old', 60),
          aged('feature/2-young', 2),
          aged('feature/3-eightdays', 8),
        ],
        context
      )

      assert.deepStrictEqual(
        shown.map(b => b.branchName),
        ['feature/3-eightdays', 'feature/1-old']
      )
    })

    it('does not count a too-young branch as hidden', () => {
      const { hiddenCount } = selectForgotten([aged('feature/1-young', 1)], {
        ...context,
        hidden: new Set(['feature/1-young']),
      })

      assert.strictEqual(hiddenCount, 0)
    })

    it('still counts an old branch the user hid', () => {
      const { hiddenCount } = selectForgotten([aged('feature/1-old', 30)], {
        ...context,
        hidden: new Set(['feature/1-old']),
      })

      assert.strictEqual(hiddenCount, 1)
    })
  })

  describe('findForgottenBranches', () => {
    function feature(name: string, vso: number): IFeatureBranchState {
      return {
        branch: new Branch(
          name,
          null,
          { sha: 'abc' },
          BranchType.Local,
          `refs/heads/${name}`
        ),
        vso,
        slug: 'x',
        conflictsWithIntegration: null,
      }
    }

    const repository = new Repository('C:/git/example', 1, null, false)

    const tip = (ref: string, email: string, date: string) =>
      [ref, `<${email}>`, date].join(String.fromCharCode(0))

    const tips = [
      // Local ahead of its remote copy: the local tip is the one that counts.
      tip('refs/heads/feature/1-local', 'dan@hot.co.nz', '2000'),
      tip('refs/remotes/origin/feature/1-local', 'fio@hot.co.nz', '1000'),
      // Local only.
      tip('refs/heads/feature/2-onlyhere', 'dan@hot.co.nz', '3000'),
      // Somebody else's.
      tip('refs/remotes/origin/feature/3-theirs', 'fio@hot.co.nz', '4000'),
      // Squash merged: git says ahead, GitHub says it had a PR.
      tip('refs/remotes/origin/feature/4-squashed', 'dan@hot.co.nz', '5000'),
      // Open pull request.
      tip('refs/remotes/origin/feature/5-open-pr', 'dan@hot.co.nz', '6000'),
      // Nothing ahead.
      tip('refs/remotes/origin/feature/6-empty', 'dan@hot.co.nz', '7000'),
    ].join('\n')

    const ahead: Record<string, string> = {
      'refs/heads/feature/1-local': '3',
      'refs/heads/feature/2-onlyhere': '1',
      'refs/remotes/origin/feature/4-squashed': '4',
      'refs/remotes/origin/feature/6-empty': '0',
    }

    const names = [
      'feature/1-local',
      'feature/2-onlyhere',
      'feature/3-theirs',
      'feature/4-squashed',
      'feature/5-open-pr',
      'feature/6-empty',
    ]

    const runGit = async (args: ReadonlyArray<string>) => {
      if (args[0] === 'for-each-ref') {
        return tips
      }

      const ref = args[2].split('..')[1]

      return `${ahead[ref] ?? '0'}\n`
    }

    it('finds the user’s branches that never had a pull request', async () => {
      const checked = new Array<string>()

      const result = await findForgottenBranches(repository, {
        integrationRef: 'origin/develop',
        candidates: names.map((n, i) => feature(n, i + 1)),
        myEmails: me,
        openPullRequestHeads: new Set(['feature/5-open-pr']),
        hasAnyPullRequest: async name => {
          checked.push(name)
          return name === 'feature/4-squashed'
        },
        hidden: nothingHidden,
        runGit,
      })

      assert.deepStrictEqual(
        result.shown.map(s => [s.branchName, s.aheadCount, s.isLocalOnly]),
        [
          ['feature/2-onlyhere', 1, true],
          ['feature/1-local', 3, false],
        ]
      )
      assert.strictEqual(result.shown[1].lastCommitAt, 2000000)
      assert.strictEqual(result.shown[1].vso, 1)
      assert.strictEqual(result.hiddenCount, 0)

      // Only branches that survived the cheap checks cost an API call.
      assert.deepStrictEqual(checked.sort(), [
        'feature/1-local',
        'feature/2-onlyhere',
        'feature/4-squashed',
      ])
    })

    it('keeps a branch when the pull request lookup is unknown', async () => {
      const result = await findForgottenBranches(repository, {
        integrationRef: 'origin/develop',
        candidates: [feature('feature/4-squashed', 4)],
        myEmails: me,
        openPullRequestHeads: new Set(),
        hasAnyPullRequest: async () => null,
        hidden: nothingHidden,
        runGit,
      })

      assert.deepStrictEqual(
        result.shown.map(s => s.branchName),
        ['feature/4-squashed']
      )
    })

    it('counts a hidden branch without listing it', async () => {
      const result = await findForgottenBranches(repository, {
        integrationRef: 'origin/develop',
        candidates: [feature('feature/2-onlyhere', 2)],
        myEmails: me,
        openPullRequestHeads: new Set(),
        hidden: new Set(['feature/2-onlyhere']),
        runGit,
      })

      assert.deepStrictEqual(result.shown, [])
      assert.strictEqual(result.hiddenCount, 1)
    })
  })
})
