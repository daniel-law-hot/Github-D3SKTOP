import { Branch, BranchType } from '../../models/branch'
import { Repository } from '../../models/repository'
import { git } from '../git/core'
import { isMine, ITipInfo, parseTipInfo } from './forgotten-branches'

/**
 * A branch of the user's that is safe to delete: everything on it is already in
 * the integration branch and in a release, so nothing is lost with it.
 */
export interface ICleanupBranch {
  /** The short name, without a remote: `feature/123-x`. */
  readonly name: string

  /** The local copy, or null when there isn't one. */
  readonly local: Branch | null

  /** The remote copy, or null when it was never pushed or is already gone. */
  readonly remote: Branch | null

  /** When the tip commit was made, in epoch milliseconds. */
  readonly lastCommitAt: number

  readonly authorEmail: string

  /** Old enough that the dialog ticks it for the user. */
  readonly preselected: boolean
}

/**
 * How old a branch's last commit has to be before the dialog ticks it by default.
 * The rest are still listed, unticked, for the user to add.
 */
export const CleanupMinAgeDays = 14

const MillisecondsPerDay = 24 * 60 * 60 * 1000

/** Names that are never offered for deletion, whatever the repository calls them. */
const TrunkNames: ReadonlySet<string> = new Set([
  'main',
  'master',
  'develop',
  'development',
  'dev',
])

/**
 * Whether a branch is part of the flow itself rather than somebody's work.
 *
 * The integration and production names are passed in because a repository can
 * call them anything; the rest are the usual trunk names and the release lines,
 * which are never a feature branch's to delete.
 */
export function isProtectedBranchName(
  name: string,
  protectedNames: ReadonlySet<string>
): boolean {
  return (
    protectedNames.has(name) ||
    TrunkNames.has(name) ||
    name === 'HEAD' ||
    name.startsWith('release/') ||
    name.startsWith('hotfix/')
  )
}

/** A branch as `selectCleanupBranches` is given it, with every fact already read. */
export interface ICleanupCandidate {
  readonly name: string
  readonly local: Branch | null
  readonly remote: Branch | null
  readonly authorEmail: string
  readonly lastCommitAt: number
  readonly mergedIntoIntegration: boolean
  readonly mergedIntoRelease: boolean
}

export interface ICleanupSelectionContext {
  /** The user's git emails, and optionally their GitHub login. */
  readonly myEmails: ReadonlySet<string>

  /** The integration and production branch names, as this repository has them. */
  readonly protectedNames: ReadonlySet<string>

  /** The checked-out branch, which can't be deleted from under the user. */
  readonly currentBranchName: string | null

  /** The time to measure age from, in epoch milliseconds. Defaults to now. */
  readonly now?: number
}

/**
 * Applies the rules for "safe to clean up", to branches whose facts are known.
 *
 * Pure, so the rules can be tested without a repository. A branch is listed when
 * it is the user's, is merged into both the integration branch and a release, is
 * not part of the flow, and is not the one checked out. Oldest first, so the
 * stalest are at the top.
 */
export function selectCleanupBranches(
  candidates: ReadonlyArray<ICleanupCandidate>,
  context: ICleanupSelectionContext
): ReadonlyArray<ICleanupBranch> {
  const now = context.now ?? Date.now()
  const selected: Array<ICleanupBranch> = []

  for (const candidate of candidates) {
    if (
      !isMine(candidate.authorEmail, context.myEmails) ||
      !candidate.mergedIntoIntegration ||
      !candidate.mergedIntoRelease ||
      isProtectedBranchName(candidate.name, context.protectedNames) ||
      candidate.name === context.currentBranchName
    ) {
      continue
    }

    selected.push({
      name: candidate.name,
      local: candidate.local,
      remote: candidate.remote,
      lastCommitAt: candidate.lastCommitAt,
      authorEmail: candidate.authorEmail,
      preselected:
        now - candidate.lastCommitAt >= CleanupMinAgeDays * MillisecondsPerDay,
    })
  }

  selected.sort((a, b) => a.lastCommitAt - b.lastCommitAt)

  return selected
}

export interface IFindCleanupInput {
  /** Every branch Desktop knows about: local and remote. */
  readonly branches: ReadonlyArray<Branch>

  /** Where the integration branch may live (local and remote); merged into any counts. */
  readonly integrationRefs: ReadonlyArray<string>

  /** Every release branch ref, and the production ref; merged into any counts. */
  readonly releaseRefs: ReadonlyArray<string>

  readonly integrationBranchName: string
  readonly productionBranchName: string
  readonly currentBranchName: string | null
  readonly myEmails: ReadonlySet<string>
  readonly now?: number

  /**
   * Runs git and returns stdout. Defaults to the repository's own git; here so
   * the work can be tested without one.
   */
  readonly runGit?: (args: ReadonlyArray<string>) => Promise<string>
}

const TipFormat = '%(refname)%00%(authoremail)%00%(committerdate:unix)'

/** How many `git` calls to have going at once. */
const Concurrency = 4

/** Refs per `for-each-ref`, so a repository with hundreds of branches can't overrun the command line. */
const RefsPerCall = 100

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

interface IBranchPair {
  readonly name: string
  local: Branch | null
  remote: Branch | null
}

/** Groups a branch's local and remote copies under its short name. */
function groupBranches(
  branches: ReadonlyArray<Branch>
): ReadonlyArray<IBranchPair> {
  const byName = new Map<string, IBranchPair>()

  for (const branch of branches) {
    if (branch.isDesktopForkRemoteBranch) {
      continue
    }

    const name = branch.nameWithoutRemote

    if (name === 'HEAD') {
      continue
    }

    let pair = byName.get(name)

    if (pair === undefined) {
      pair = { name, local: null, remote: null }
      byName.set(name, pair)
    }

    if (branch.type === BranchType.Local) {
      pair.local = branch
    } else if (pair.remote === null || branch.remoteName === 'origin') {
      // One remote copy per branch; origin is the one a feature branch lives on.
      pair.remote = branch
    }
  }

  return [...byName.values()]
}

/**
 * The refs, out of those given, that are fully merged into at least one of
 * `targets`. A target that doesn't exist, or a failed call, contributes nothing,
 * which can only ever leave a branch out — never put one in.
 */
async function refsMergedIntoAny(
  run: (args: ReadonlyArray<string>) => Promise<string>,
  targets: ReadonlyArray<string>,
  refs: ReadonlyArray<string>
): Promise<ReadonlySet<string>> {
  const merged = new Set<string>()

  if (refs.length === 0 || targets.length === 0) {
    return merged
  }

  const calls: Array<{ target: string; chunk: ReadonlyArray<string> }> = []

  for (const target of new Set(targets)) {
    for (let i = 0; i < refs.length; i += RefsPerCall) {
      calls.push({ target, chunk: refs.slice(i, i + RefsPerCall) })
    }
  }

  await mapLimited(calls, async ({ target, chunk }) => {
    try {
      const out = await run([
        'for-each-ref',
        `--merged=${target}`,
        '--format=%(refname)',
        ...chunk,
      ])

      for (const line of out.split('\n')) {
        const ref = line.trim()

        if (ref.length > 0) {
          merged.add(ref)
        }
      }
    } catch (e) {
      log.debug(`[HotFlow] could not read what is merged into ${target}`, e)
    }
  })

  return merged
}

/**
 * Finds the user's branches that are fully merged into the integration branch and
 * into a release, so deleting them loses nothing.
 *
 * Cheap to run: one `for-each-ref` for every tip, then a few `--merged` queries
 * for only the branches that are the user's and could be offered at all.
 */
export async function findCleanupBranches(
  repository: Repository,
  input: IFindCleanupInput
): Promise<ReadonlyArray<ICleanupBranch>> {
  const run =
    input.runGit ??
    (async (args: ReadonlyArray<string>) =>
      (
        await git([...args], repository.path, 'hotFlowBranchCleanup', {
          successExitCodes: new Set([0, 1]),
        })
      ).stdout)

  const protectedNames = new Set([
    input.integrationBranchName,
    input.productionBranchName,
  ])

  const tipOut = await run([
    'for-each-ref',
    `--format=${TipFormat}`,
    'refs/heads',
    'refs/remotes',
  ])

  const tips = new Map<string, ITipInfo>()

  for (const tip of parseTipInfo(tipOut)) {
    tips.set(tip.ref, tip)
  }

  // Everything that could be offered: the user's, not part of the flow, not
  // the branch they are standing on. Done first so the merge queries are about a
  // handful of refs rather than every branch in the repository.
  const eligible = groupBranches(input.branches).flatMap(pair => {
    // The local copy's tip wins: it can be ahead of the remote, and is the one
    // that decides whether the work is all merged.
    const tip =
      (pair.local === null ? undefined : tips.get(pair.local.ref)) ??
      (pair.remote === null ? undefined : tips.get(pair.remote.ref))

    if (
      tip === undefined ||
      isProtectedBranchName(pair.name, protectedNames) ||
      pair.name === input.currentBranchName ||
      !isMine(tip.authorEmail, input.myEmails)
    ) {
      return []
    }

    return [{ pair, tip }]
  })

  const refs = [
    ...new Set(
      eligible.flatMap(({ pair }) =>
        [pair.local, pair.remote].flatMap(b => (b === null ? [] : [b.ref]))
      )
    ),
  ]

  const [inIntegration, inRelease] = await Promise.all([
    refsMergedIntoAny(run, input.integrationRefs, refs),
    refsMergedIntoAny(run, input.releaseRefs, refs),
  ])

  // Merged only if every copy is: a remote copy with commits the local one lacks
  // (or the reverse) would lose them on deletion.
  const mergedEverywhere = (
    pair: IBranchPair,
    merged: ReadonlySet<string>
  ): boolean =>
    [pair.local, pair.remote].every(b => b === null || merged.has(b.ref))

  return selectCleanupBranches(
    eligible.map(({ pair, tip }) => ({
      name: pair.name,
      local: pair.local,
      remote: pair.remote,
      authorEmail: tip.authorEmail,
      lastCommitAt: tip.committedAt,
      mergedIntoIntegration: mergedEverywhere(pair, inIntegration),
      mergedIntoRelease: mergedEverywhere(pair, inRelease),
    })),
    {
      myEmails: input.myEmails,
      protectedNames,
      currentBranchName: input.currentBranchName,
      now: input.now,
    }
  )
}
