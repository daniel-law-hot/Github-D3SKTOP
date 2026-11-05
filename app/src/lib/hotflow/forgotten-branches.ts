import { Account } from '../../models/account'
import { IFeatureBranchState } from '../../models/hotflow'
import { Repository } from '../../models/repository'
import { git } from '../git/core'
import { request } from '../http'

/**
 * A feature branch somebody committed to, then never raised as a pull request.
 *
 * Found rather than recorded: nothing here is stored, so a branch stops being
 * listed the moment it gets a pull request or lands in the integration branch.
 */
export interface IForgottenBranch {
  /** `nameWithoutRemote`, so a local branch and its remote copy are one entry. */
  readonly branchName: string

  /** The VSO number from the branch name, or null when it doesn't carry one. */
  readonly vso: number | null

  /** Commits on the branch that the integration branch doesn't have. */
  readonly aheadCount: number

  /** When the tip commit was made, in epoch milliseconds. */
  readonly lastCommitAt: number

  /**
   * True when no remote has this branch, so the work exists on this machine only.
   * The ones most easily lost.
   */
  readonly isLocalOnly: boolean

  readonly authorEmail: string
}

/** A branch as `selectForgotten` is given it, before any rule has been applied. */
export interface IForgottenCandidate {
  readonly branchName: string
  readonly vso: number | null
  readonly authorEmail: string
  readonly lastCommitAt: number
  readonly aheadCount: number
  readonly isLocalOnly: boolean
}

/**
 * How long a branch has to have been left alone before it counts as forgotten.
 *
 * A branch committed to yesterday is being worked on, not forgotten, and listing it
 * would make the Notifications count a nag about this week's work. Measured from
 * the latest commit on the branch, which is the last time anyone touched it that
 * git can see.
 */
export const ForgottenMinAgeDays = 7

const MillisecondsPerDay = 24 * 60 * 60 * 1000

export interface IForgottenSelectionContext {
  /** The user's git emails, and optionally their GitHub login. */
  readonly myEmails: ReadonlySet<string>

  /**
   * Head ref names that have any pull request at all: open, closed or merged.
   * A closed one still means the branch was not forgotten.
   */
  readonly branchesWithPullRequest: ReadonlySet<string>

  /** Branch names the user asked not to be shown again. */
  readonly hidden: ReadonlySet<string>

  /** The time to measure age from, in epoch milliseconds. Defaults to now. */
  readonly now?: number
}

export interface IForgottenResult {
  readonly shown: ReadonlyArray<IForgottenBranch>

  /** Branches that would have been listed but have been hidden. */
  readonly hiddenCount: number
}

/** `123+login@users.noreply.github.com` or `login@users.noreply.github.com`. */
const NoReplyPattern = /^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/

function noReplyLogin(email: string): string | null {
  const match = NoReplyPattern.exec(email)

  return match === null ? null : match[1]
}

/**
 * Whether an author email is the user's.
 *
 * Case-insensitive, because git stores whatever was typed and providers differ.
 * GitHub's private addresses come in two forms, with and without the numeric id,
 * and which one a commit carries depends on when the account was made — so any
 * noreply form matches any other for the same login, and a bare login in the set
 * matches too.
 */
export function isMine(
  authorEmail: string,
  myEmails: ReadonlySet<string>
): boolean {
  const email = authorEmail.trim().toLowerCase()

  if (email.length === 0) {
    return false
  }

  const mine = new Set<string>()
  const myLogins = new Set<string>()

  for (const entry of myEmails) {
    const value = entry.trim().toLowerCase()

    if (value.length === 0) {
      continue
    }

    mine.add(value)

    const login = noReplyLogin(value)

    if (login !== null) {
      myLogins.add(login)
    } else if (!value.includes('@')) {
      myLogins.add(value)
    }
  }

  if (mine.has(email)) {
    return true
  }

  const login = noReplyLogin(email)

  return login !== null && myLogins.has(login)
}

/**
 * Applies the rules for "forgotten", to branches whose facts are already known.
 *
 * Pure, so the rules can be tested without a repository. A branch is listed when
 * it is the user's, has work the integration branch lacks, has never had a pull
 * request, and has been left alone for `ForgottenMinAgeDays`. Hidden ones are
 * counted rather than dropped, so the view can say they exist; ones too young to
 * count are neither listed nor counted.
 */
export function selectForgotten(
  candidates: ReadonlyArray<IForgottenCandidate>,
  context: IForgottenSelectionContext
): { shown: IForgottenBranch[]; hiddenCount: number } {
  const shown: Array<IForgottenBranch> = []
  let hiddenCount = 0

  // Branches touched since this are still being worked on.
  const youngest =
    (context.now ?? Date.now()) - ForgottenMinAgeDays * MillisecondsPerDay

  for (const candidate of candidates) {
    if (
      !isMine(candidate.authorEmail, context.myEmails) ||
      candidate.aheadCount === 0 ||
      context.branchesWithPullRequest.has(candidate.branchName) ||
      candidate.lastCommitAt > youngest
    ) {
      continue
    }

    if (context.hidden.has(candidate.branchName)) {
      hiddenCount++
      continue
    }

    shown.push({
      branchName: candidate.branchName,
      vso: candidate.vso,
      aheadCount: candidate.aheadCount,
      lastCommitAt: candidate.lastCommitAt,
      isLocalOnly: candidate.isLocalOnly,
      authorEmail: candidate.authorEmail,
    })
  }

  shown.sort((a, b) => b.lastCommitAt - a.lastCommitAt)

  return { shown, hiddenCount }
}

/** What one branch ref's tip says. */
export interface ITipInfo {
  /** The full ref, e.g. `refs/heads/feature/1-x` or `refs/remotes/origin/…`. */
  readonly ref: string

  /** The name without `refs/heads/` or `refs/remotes/<remote>/`. */
  readonly name: string
  readonly isRemote: boolean
  readonly authorEmail: string

  /** Epoch milliseconds. */
  readonly committedAt: number
}

const TipFormat = '%(refname)%00%(authoremail)%00%(committerdate:unix)'

/**
 * Reads `for-each-ref` output made with `TipFormat`, one ref per line.
 *
 * Remote `HEAD` pointers are skipped, and so is anything unparseable — one odd
 * line shouldn't lose the rest.
 */
export function parseTipInfo(stdout: string): ReadonlyArray<ITipInfo> {
  const tips: Array<ITipInfo> = []

  for (const line of stdout.split('\n')) {
    const [ref, rawEmail, rawDate] = line.trim().split('\0')

    if (ref === undefined || rawEmail === undefined || rawDate === undefined) {
      continue
    }

    const seconds = parseInt(rawDate, 10)

    if (!Number.isFinite(seconds)) {
      continue
    }

    const authorEmail = rawEmail.replace(/^<|>$/g, '')
    const committedAt = seconds * 1000

    if (ref.startsWith('refs/heads/')) {
      tips.push({
        ref,
        name: ref.slice('refs/heads/'.length),
        isRemote: false,
        authorEmail,
        committedAt,
      })
    } else if (ref.startsWith('refs/remotes/')) {
      // `refs/remotes/<remote>/<name>`; a remote's name can't contain a slash
      // that matters here, and the branch name keeps its own.
      const rest = ref.slice('refs/remotes/'.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? '' : rest.slice(slash + 1)

      if (name.length === 0 || name === 'HEAD') {
        continue
      }

      tips.push({ ref, name, isRemote: true, authorEmail, committedAt })
    }
  }

  return tips
}

/** How many `git rev-list` or API calls to have going at once. */
const Concurrency = 4

async function mapLimited<T, R>(
  items: ReadonlyArray<T>,
  work: (item: T) => Promise<R>
): Promise<ReadonlyArray<R>> {
  const results = new Array<R>(items.length)
  let next = 0

  const runners = Array.from(
    { length: Math.min(Concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index])
      }
    }
  )

  await Promise.all(runners)

  return results
}

export interface IFindForgottenInput {
  /** The ref to measure "ahead" against, e.g. `origin/develop`. */
  readonly integrationRef: string

  /** `hotFlowState.openFeatureBranches`: feature branches not yet merged. */
  readonly candidates: ReadonlyArray<IFeatureBranchState>

  readonly myEmails: ReadonlySet<string>

  /** Head ref names of open pull requests, known without a network call. */
  readonly openPullRequestHeads: ReadonlySet<string>

  /**
   * Whether the branch has ever had a pull request, in any state. Null means
   * unknown, and the branch is kept: better to show one that turns out to have a
   * pull request than to hide one that was forgotten.
   */
  readonly hasAnyPullRequest?: (branchName: string) => Promise<boolean | null>

  readonly hidden: ReadonlySet<string>

  /**
   * Runs git and returns stdout. Defaults to the repository's own git; here so
   * the work can be tested without one.
   */
  readonly runGit?: (args: ReadonlyArray<string>) => Promise<string>
}

/**
 * Finds the user's branches with work in them and no pull request.
 *
 * Cheap to run: one `for-each-ref` for every branch's tip, a `rev-list --count`
 * only for the few that are the user's and have no open pull request, and the
 * API only for those that survive both.
 */
export async function findForgottenBranches(
  repository: Repository,
  input: IFindForgottenInput
): Promise<IForgottenResult> {
  const run =
    input.runGit ??
    (async (args: ReadonlyArray<string>) =>
      (
        await git([...args], repository.path, 'hotFlowForgottenBranches', {
          successExitCodes: new Set([0]),
        })
      ).stdout)

  const stdout = await run([
    'for-each-ref',
    `--format=${TipFormat}`,
    'refs/heads',
    'refs/remotes',
  ])

  // Local wins for the tip: it can be ahead of the remote copy, and that's the
  // commit someone would be about to lose.
  const byName = new Map<string, ITipInfo>()
  const remoteNames = new Set<string>()

  for (const tip of parseTipInfo(stdout)) {
    if (tip.isRemote) {
      remoteNames.add(tip.name)
    }

    const existing = byName.get(tip.name)

    if (existing === undefined || (!tip.isRemote && existing.isRemote)) {
      byName.set(tip.name, tip)
    }
  }

  const mine = input.candidates
    .map(candidate => ({
      candidate,
      name: candidate.branch.nameWithoutRemote,
      tip: byName.get(candidate.branch.nameWithoutRemote),
    }))
    .filter(
      (c): c is typeof c & { tip: ITipInfo } =>
        c.tip !== undefined &&
        !input.openPullRequestHeads.has(c.name) &&
        isMine(c.tip.authorEmail, input.myEmails)
    )

  const counted = await mapLimited(mine, async c => {
    try {
      const out = await run([
        'rev-list',
        '--count',
        `${input.integrationRef}..${c.tip.ref}`,
      ])
      const aheadCount = parseInt(out.trim(), 10)

      return Number.isFinite(aheadCount) ? { ...c, aheadCount } : null
    } catch (e) {
      log.debug(`[HotFlow] could not count commits on ${c.name}`, e)
      return null
    }
  })

  const withWork = counted.filter(
    (c): c is NonNullable<typeof c> => c !== null && c.aheadCount > 0
  )

  const branchesWithPullRequest = new Set<string>()
  const check = input.hasAnyPullRequest

  if (check !== undefined) {
    await mapLimited(withWork, async c => {
      try {
        if ((await check(c.name)) === true) {
          branchesWithPullRequest.add(c.name)
        }
      } catch (e) {
        log.debug(`[HotFlow] could not look up pull requests for ${c.name}`, e)
      }
    })
  }

  return selectForgotten(
    withWork.map(c => ({
      branchName: c.name,
      vso: c.candidate.vso,
      authorEmail: c.tip.authorEmail,
      lastCommitAt: c.tip.committedAt,
      aheadCount: c.aheadCount,
      isLocalOnly: !remoteNames.has(c.name),
    })),
    {
      myEmails: input.myEmails,
      branchesWithPullRequest,
      hidden: input.hidden,
    }
  )
}

/**
 * Builds the "has this branch ever had a pull request?" check for GitHub.
 *
 * `state=all` is the point: a branch whose pull request was merged, or closed,
 * was not forgotten, and squash merges leave exactly that behind — a branch git
 * can't tell is merged. Answers null on any failure, which the caller treats as
 * "keep it".
 */
export function makeHasAnyPullRequest(
  account: Account,
  owner: string,
  name: string
): (branchName: string) => Promise<boolean | null> {
  return async branchName => {
    try {
      const head = encodeURIComponent(`${owner}:${branchName}`)
      const response = await request(
        account.endpoint,
        account.token,
        'GET',
        `repos/${owner}/${name}/pulls?head=${head}&state=all&per_page=1`
      )

      if (!response.ok) {
        return null
      }

      const pulls = (await response.json()) as ReadonlyArray<unknown>

      return Array.isArray(pulls) ? pulls.length > 0 : null
    } catch (e) {
      log.debug(
        `[HotFlow] could not look up pull requests for ${branchName}`,
        e
      )
      return null
    }
  }
}
