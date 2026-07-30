import { GitError } from 'dugite'
import { Branch, BranchType } from '../../models/branch'
import { Commit } from '../../models/commit'
import {
  DefaultIntegrationBranchName,
  DefaultProductionBranchName,
  IFeatureBranchState,
  IHotFlowBranchOverride,
  IHotFlowState,
  IReleaseBranchState,
  IReleaseVersion,
  IResolvedBranch,
  IShippedRelease,
  IntegrationBranchAliases,
  ProductionBranchAliases,
  ReleaseVerdict,
  defaultAdoState,
  defaultHotFlowState,
} from '../../models/hotflow'
import { Repository } from '../../models/repository'
import { git } from '../git/core'
import { getRemoteHEAD } from '../git/remote'
import { getBranches } from '../git/for-each-ref'
import { createForEachRefParser } from '../git/git-delimiter-parser'
import { getCommits } from '../git/log'
import {
  getAheadBehind,
  revRange,
  revSymmetricDifference,
} from '../git/rev-list'
import {
  extractVsoNumbersFromCommits,
  parseFeatureBranchName,
  parseReleaseBranchName,
} from './branch-patterns'
import { resolveCycle } from './cycle'
import {
  compareReleaseVersions,
  parseReleaseVersion,
  suggestNextVersion,
} from './version'

/**
 * How many commits we're willing to load per range. Release branches hold a
 * cycle's worth of work, so this is generous — but it stops a mis-detected
 * range from trying to load an entire repository's history.
 */
const MaxCommitsPerRange = 500

/** How many shipped releases to show in the history list. */
const ReleaseHistoryLimit = 12

/**
 * Reads the repository and builds the complete HotFlow state.
 *
 * Every git call here is scoped to a revision range or a ref query, so this is
 * cheap enough to run on repository refresh. Nothing in here mutates the repo.
 */
export async function detectHotFlowState(
  repository: Repository,
  confirmedCycles: ReadonlyMap<string, string> | undefined,
  branchOverride: IHotFlowBranchOverride = {}
): Promise<IHotFlowState> {
  const branches = await getBranches(repository)

  const integrationResolution = resolveBranch(
    branches,
    IntegrationBranchAliases,
    branchOverride.integrationBranch
  )

  // Aliases first; the repository's own default branch is the safety net for a
  // production branch named something we don't know about.
  const productionResolution =
    resolveBranch(
      branches,
      ProductionBranchAliases,
      branchOverride.productionBranch
    ) ??
    (branchOverride.productionBranch === undefined
      ? await resolveProductionFromDefaultBranch(
          repository,
          branches,
          integrationResolution
        )
      : null)

  const integrationBranch = integrationResolution?.branch ?? null
  const productionBranch = productionResolution?.branch ?? null

  const integrationBranchName =
    integrationBranch?.nameWithoutRemote ?? DefaultIntegrationBranchName
  const productionBranchName =
    productionBranch?.nameWithoutRemote ?? DefaultProductionBranchName

  const missingRequiredBranches: Array<'integration' | 'production'> = []
  if (integrationBranch === null) {
    missingRequiredBranches.push('integration')
  }
  if (productionBranch === null) {
    missingRequiredBranches.push('production')
  }

  // Without both branches there is no flow to model. Report which are missing
  // so the view can explain itself rather than rendering an empty dashboard.
  if (integrationBranch === null || productionBranch === null) {
    return {
      ...defaultHotFlowState,
      lastRefreshed: Date.now(),
      missingRequiredBranches,
      integrationBranch,
      productionBranch,
      integrationResolution,
      productionResolution,
      integrationBranchName,
      productionBranchName,
    }
  }

  const integrationRef = integrationBranch.name
  const productionRef = productionBranch.name

  const [releaseCandidates, releaseHistory, unreleased, featureBranches] =
    await Promise.all([
      collectReleaseBranches(repository, branches, productionRef),
      collectReleaseHistory(repository, productionRef),
      collectUnreleased(repository, productionRef, integrationRef),
      collectFeatureBranches(repository, branches, integrationRef),
    ])

  // Unshipped releases, lowest version first — the lowest is what ships next.
  const unshipped = releaseCandidates
    .filter(c => c.aheadOfProduction > 0)
    .sort((a, b) => compareReleaseVersions(a.version, b.version))

  const currentCandidate = unshipped.length > 0 ? unshipped[0] : null
  const otherCandidates = unshipped.slice(1)

  const currentRelease =
    currentCandidate === null
      ? null
      : await buildReleaseState(
          repository,
          currentCandidate,
          integrationRef,
          productionRef,
          confirmedCycles
        )

  // Other open releases get the same treatment but without loading their commit
  // bodies — they're a summary line, not the focus.
  const otherOpenReleases = await Promise.all(
    otherCandidates.map(c =>
      buildReleaseState(
        repository,
        c,
        integrationRef,
        productionRef,
        confirmedCycles,
        false
      )
    )
  )

  return {
    isLoading: false,
    lastRefreshed: Date.now(),
    errorMessage: null,
    missingRequiredBranches: [],
    integrationBranch,
    productionBranch,
    integrationResolution,
    productionResolution,
    integrationBranchName,
    productionBranchName,
    currentRelease,
    otherOpenReleases,
    releaseHistory,
    openFeatureBranches: featureBranches,
    unreleasedCommitCount: unreleased.commitCount,
    unreleasedVsoCount: unreleased.vsoCount,
    nextVersion: computeNextVersion(releaseCandidates, releaseHistory),
    // Approvals are a separate API read; the store fills these in after
    // detection so a network hiccup can't hold up the git picture.
    pullRequestApprovals: defaultHotFlowState.pullRequestApprovals,
    ado: defaultAdoState,
  }
}

/**
 * Finds a branch by name, preferring the local branch over its remote tracking
 * counterpart so ranges resolve against what the user actually has checked out.
 *
 * Many House of Travel repositories have no local `main`, only `origin/main`, so
 * the remote fallback is the common path rather than an edge case.
 */
function findBranch(
  branches: ReadonlyArray<Branch>,
  name: string
): { branch: Branch; remoteOnly: boolean } | null {
  const local = branches.find(
    b => b.type === BranchType.Local && b.name === name
  )

  if (local !== undefined) {
    return { branch: local, remoteOnly: false }
  }

  const remote = branches.find(
    b =>
      b.type === BranchType.Remote &&
      !b.isDesktopForkRemoteBranch &&
      b.nameWithoutRemote === name
  )

  return remote === undefined ? null : { branch: remote, remoteOnly: true }
}

/**
 * Resolves a branch from a per-repository override first, then a list of known
 * aliases in priority order.
 *
 * An override that doesn't resolve is reported as unresolved rather than quietly
 * falling through to the aliases — if someone pinned a branch and it's gone,
 * saying so is more useful than guessing again behind their back.
 */
function resolveBranch(
  branches: ReadonlyArray<Branch>,
  aliases: ReadonlyArray<string>,
  override: string | undefined
): IResolvedBranch | null {
  if (override !== undefined) {
    const hit = findBranch(branches, override)

    return hit === null ? null : { ...hit, resolution: 'override' }
  }

  for (const alias of aliases) {
    const hit = findBranch(branches, alias)

    if (hit !== null) {
      return { ...hit, resolution: 'alias' }
    }
  }

  return null
}

/**
 * Last-resort production branch: whatever the remote says its HEAD is.
 *
 * Guarded against returning the integration branch — this fork's default branch
 * *is* `development`, and a single branch playing both roles would make the whole
 * view nonsense.
 */
async function resolveProductionFromDefaultBranch(
  repository: Repository,
  branches: ReadonlyArray<Branch>,
  integration: IResolvedBranch | null
): Promise<IResolvedBranch | null> {
  const remoteHead = await getRemoteHEAD(repository, 'origin').catch(() => null)

  if (remoteHead === null) {
    return null
  }

  if (
    integration !== null &&
    integration.branch.nameWithoutRemote === remoteHead
  ) {
    return null
  }

  const hit = findBranch(branches, remoteHead)

  return hit === null ? null : { ...hit, resolution: 'default-branch' }
}

interface IReleaseCandidate {
  readonly branch: Branch
  readonly version: IReleaseVersion
  readonly aheadOfProduction: number
  readonly behindIntegration: number
}

/**
 * Finds every release branch and how far it is from production, deduplicating
 * local against remote so a branch that exists in both places appears once.
 */
async function collectReleaseBranches(
  repository: Repository,
  branches: ReadonlyArray<Branch>,
  productionRef: string
): Promise<ReadonlyArray<IReleaseCandidate>> {
  const byVersion = new Map<string, Branch>()

  for (const branch of branches) {
    if (branch.isDesktopForkRemoteBranch) {
      continue
    }

    const version = parseReleaseBranchName(branch.name)

    if (version === null) {
      continue
    }

    const existing = byVersion.get(version.raw)

    // Prefer local; between two remotes prefer the first we saw.
    if (existing === undefined || branch.type === BranchType.Local) {
      if (existing === undefined || existing.type !== BranchType.Local) {
        byVersion.set(version.raw, branch)
      }
    }
  }

  const candidates = await Promise.all(
    [...byVersion.entries()].map(async ([raw, branch]) => {
      const version = parseReleaseVersion(raw)

      if (version === null) {
        return null
      }

      const aheadBehind = await getAheadBehind(
        repository,
        revSymmetricDifference(branch.name, productionRef)
      )

      if (aheadBehind === null) {
        return null
      }

      return {
        branch,
        version,
        aheadOfProduction: aheadBehind.ahead,
        behindIntegration: 0,
      }
    })
  )

  return candidates.filter((c): c is IReleaseCandidate => c !== null)
}

/** Loads the detail for one release branch. */
async function buildReleaseState(
  repository: Repository,
  candidate: IReleaseCandidate,
  integrationRef: string,
  productionRef: string,
  confirmedCycles: ReadonlyMap<string, string> | undefined,
  loadCommits: boolean = true
): Promise<IReleaseBranchState> {
  const releaseRef = candidate.branch.name

  const driftAheadBehind = await getAheadBehind(
    repository,
    revSymmetricDifference(releaseRef, integrationRef)
  )

  const behindIntegration = driftAheadBehind?.behind ?? 0

  const [commits, releaseOnlyCommits, incomingCommits] = loadCommits
    ? await Promise.all([
        loadRange(repository, productionRef, releaseRef),
        loadRange(repository, integrationRef, releaseRef),
        loadRange(repository, releaseRef, integrationRef),
      ])
    : [[], [], []]

  const vsoNumbers = extractVsoNumbersFromCommits(commits)

  const contributorCount = new Set(commits.map(c => c.author.name)).size

  return {
    branch: candidate.branch,
    version: candidate.version,
    cycle: resolveCycle(
      candidate.branch.nameWithoutRemote,
      candidate.version,
      confirmedCycles
    ),
    commits,
    releaseOnlyCommits,
    incomingCommits,
    aheadOfProduction: candidate.aheadOfProduction,
    behindIntegration,
    vsoNumbers,
    contributorCount,
    verdict: computeVerdict(candidate.aheadOfProduction, behindIntegration),
  }
}

/**
 * The git-only verdict. The view upgrades `ready` to `needs-update` once ADO
 * reconciliation reveals missing work items — that can't be known from git.
 */
function computeVerdict(
  aheadOfProduction: number,
  behindIntegration: number
): ReleaseVerdict {
  if (aheadOfProduction === 0) {
    return 'shipped'
  }

  return behindIntegration > 0 ? 'needs-update' : 'ready'
}

/** Loads full commits (with bodies, for VSO extraction) in `from..to`. */
async function loadRange(
  repository: Repository,
  from: string,
  to: string
): Promise<ReadonlyArray<Commit>> {
  try {
    return await getCommits(repository, revRange(from, to), MaxCommitsPerRange)
  } catch {
    // A bad range shouldn't take the whole view down — an empty list degrades
    // to "nothing here" rather than an error screen.
    return []
  }
}

/** Commits and VSOs sitting in development but not yet shipped to production. */
async function collectUnreleased(
  repository: Repository,
  productionRef: string,
  integrationRef: string
): Promise<{ commitCount: number; vsoCount: number }> {
  const commits = await loadRange(repository, productionRef, integrationRef)

  return {
    commitCount: commits.length,
    vsoCount: extractVsoNumbersFromCommits(commits).length,
  }
}

/**
 * Feature branches with work not yet in the integration branch.
 *
 * Covers remote branches as well as local ones: most feature branches in flight
 * belong to someone else, so looking only at what's checked out locally makes
 * HotFlow report a fraction of the real picture. Local and remote copies of the
 * same branch are counted once, preferring the local one.
 *
 * Branches with nothing ahead of integration are dropped, which is what keeps
 * the count honest in repositories carrying dozens of long-merged branches.
 */
async function collectFeatureBranches(
  repository: Repository,
  branches: ReadonlyArray<Branch>,
  integrationRef: string
): Promise<ReadonlyArray<IFeatureBranchState>> {
  const byName = new Map<string, Branch>()

  for (const branch of branches) {
    if (
      branch.isDesktopForkRemoteBranch ||
      parseFeatureBranchName(branch.name) === null
    ) {
      continue
    }

    const key = branch.nameWithoutRemote
    const existing = byName.get(key)

    if (existing === undefined || branch.type === BranchType.Local) {
      byName.set(key, branch)
    }
  }

  const states = await Promise.all(
    [...byName.values()].map(async branch => {
      const parsed = parseFeatureBranchName(branch.name)

      if (parsed === null) {
        return null
      }

      const aheadBehind = await getAheadBehind(
        repository,
        revSymmetricDifference(branch.name, integrationRef)
      )

      const ahead = aheadBehind?.ahead ?? 0

      // A feature branch with nothing on it is already merged or never started;
      // either way it isn't open work.
      if (ahead === 0) {
        return null
      }

      return {
        branch,
        vso: parsed.vso,
        slug: parsed.slug,
        aheadOfIntegration: ahead,
      }
    })
  )

  return states
    .filter((s): s is IFeatureBranchState => s !== null)
    .sort((a, b) => a.vso - b.vso)
}

/**
 * Shipped releases, newest first, read from version-shaped tags reachable from
 * production.
 *
 * Uses a single `for-each-ref --merged` query rather than testing each tag for
 * ancestry, which would be one git call per tag.
 */
async function collectReleaseHistory(
  repository: Repository,
  productionRef: string
): Promise<ReadonlyArray<IShippedRelease>> {
  const { formatArgs, parse } = createForEachRefParser({
    name: '%(refname:short)',
    sha: '%(objectname)',
    // Annotated tags carry taggerdate; lightweight tags fall back to the
    // commit's own date via creatordate.
    date: '%(creatordate:iso8601)',
  })

  const result = await git(
    ['for-each-ref', ...formatArgs, `--merged=${productionRef}`, 'refs/tags'],
    repository.path,
    'hotFlowReleaseHistory',
    {
      expectedErrors: new Set([GitError.NotAGitRepository]),
      successExitCodes: new Set([0, 1]),
    }
  )

  if (result.gitError === GitError.NotAGitRepository) {
    return []
  }

  const releases: Array<IShippedRelease> = []

  for (const ref of parse(result.stdout)) {
    if (ref.name === undefined || ref.name.length === 0) {
      continue
    }

    // House of Travel tags are bare versions — `1.2026.9`, no `v` prefix — so a
    // tag is a release exactly when it parses as a version.
    const version = parseReleaseVersion(ref.name)

    if (version === null) {
      continue
    }

    const parsedDate = ref.date ? new Date(ref.date) : null

    releases.push({
      version,
      tagName: ref.name,
      sha: ref.sha,
      shippedAt:
        parsedDate !== null && !isNaN(parsedDate.valueOf()) ? parsedDate : null,
      // Filled in below, once we know the adjacent tag to diff against.
      vsoCount: 0,
    })
  }

  // Newest first.
  releases.sort((a, b) => compareReleaseVersions(b.version, a.version))

  const trimmed = releases.slice(0, ReleaseHistoryLimit)

  // Count the VSOs each release introduced, by diffing against the tag below it.
  const withCounts = await Promise.all(
    trimmed.map(async (release, index) => {
      const previous = trimmed[index + 1]

      if (previous === undefined) {
        return release
      }

      const commits = await loadRange(
        repository,
        previous.tagName,
        release.tagName
      )

      return {
        ...release,
        vsoCount: extractVsoNumbersFromCommits(commits).length,
      }
    })
  )

  return withCounts
}

/**
 * The version a new release branch would be cut as.
 *
 * Derived from this repository's own highest known version — never from the
 * calendar — because repos version independently of each other.
 */
function computeNextVersion(
  candidates: ReadonlyArray<IReleaseCandidate>,
  history: ReadonlyArray<IShippedRelease>
): string | null {
  const versions = [
    ...candidates.map(c => c.version),
    ...history.map(h => h.version),
  ]

  if (versions.length === 0) {
    return null
  }

  const highest = versions.reduce((a, b) =>
    compareReleaseVersions(a, b) >= 0 ? a : b
  )

  return suggestNextVersion(highest)
}
