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
import {
  extractVsoNumbersFromCommits,
  parseFeatureBranchName,
  parseReleaseBranchName,
} from './branch-patterns'
import { resolveReleaseSequence } from './release-sequence'
import { pickCurrentRelease } from './pick-release'
import { IRepositoryProvider } from './repository-provider'
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
 * Every read here is scoped to a revision range or a ref query, so this is cheap
 * enough to run on repository refresh. Nothing in here mutates the repository.
 *
 * Takes a provider rather than a `Repository` so the same detection runs against
 * a local clone or a remote API — see `repository-provider.ts`. Nothing below
 * knows which it has.
 */
export async function detectHotFlowState(
  provider: IRepositoryProvider,
  sequenceOverrides: ReadonlyMap<string, number> | undefined,
  branchOverride: IHotFlowBranchOverride = {}
): Promise<IHotFlowState> {
  const branches = await provider.getBranches()

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
          provider,
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

  // Started out here rather than inside the group below because two of the
  // things in it want the answer, and awaiting one promise twice costs nothing —
  // whereas reading HEAD first would put a serial git call in front of
  // everything else.
  const checkedOutBranchNamePromise = provider.getCheckedOutBranchName()

  const [
    releaseCandidates,
    releaseHistory,
    unreleased,
    featureBranches,
    checkedOutBranchName,
  ] = await Promise.all([
    collectReleaseBranches(provider, branches, productionRef),
    collectReleaseHistory(provider, productionRef),
    collectUnreleased(provider, productionRef, integrationRef),
    collectFeatureBranches(
      provider,
      branches,
      integrationRef,
      checkedOutBranchNamePromise
    ),
    checkedOutBranchNamePromise,
  ])

  const { current: currentCandidate, others: otherCandidates } =
    pickCurrentRelease(
      // `nameWithoutRemote`, because that's the form HEAD reports — a local
      // `release/1.2026.17` rather than `origin/release/1.2026.17`.
      releaseCandidates.map(c => ({
        ...c,
        branchName: c.branch.nameWithoutRemote,
      })),
      releaseHistory.map(h => h.version),
      checkedOutBranchName
    )

  // The current release and the summary lines beside it are independent reads, so
  // they go together. Awaiting the current one first cost a whole round trip of
  // waiting for no reason — and with git processes contending rather than queuing,
  // a removed serial hop is worth more than a removed command.
  const [currentRelease, otherOpenReleases] = await Promise.all([
    currentCandidate === null
      ? Promise.resolve(null)
      : buildReleaseState(
          provider,
          currentCandidate,
          integrationRef,
          productionRef,
          sequenceOverrides
        ),

    // Other open releases get the same treatment but without loading their commit
    // bodies — they're a summary line, not the focus.
    Promise.all(
      otherCandidates.map(c =>
        buildReleaseState(
          provider,
          c,
          integrationRef,
          productionRef,
          sequenceOverrides,
          false
        )
      )
    ),
  ])

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
    featureBranchVsos: collectFeatureBranchVsos(branches),
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
  provider: IRepositoryProvider,
  branches: ReadonlyArray<Branch>,
  integration: IResolvedBranch | null
): Promise<IResolvedBranch | null> {
  const remoteHead = await provider.getDefaultBranchName()

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

  /**
   * Whether the branch is wholly contained in production.
   *
   * A boolean rather than the commit count, because that's all choosing between
   * candidates needs — and the count costs a git process each, while this comes
   * free for every branch at once. `buildReleaseState` works out the real number
   * for the handful of releases actually shown.
   */
  readonly isMergedIntoProduction: boolean
}

/**
 * Finds every release branch, and which of them production already contains.
 *
 * One `for-each-ref --merged` rather than an ahead/behind per branch. That used to
 * be sixteen git processes in HOTWebsites and the single largest cost in the whole
 * refresh — 3.1 of about 3.0 seconds, since much of the rest ran in parallel with
 * it. The same answer arrives in one call in 364ms.
 *
 * Local and remote copies of a branch are deduplicated so a branch that exists in
 * both places appears once, preferring the local one.
 */
async function collectReleaseBranches(
  provider: IRepositoryProvider,
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

  const mergedIntoProduction = await provider.getMergedBranches(productionRef, [
    ...byVersion.values(),
  ])

  const candidates: Array<IReleaseCandidate> = []

  for (const [raw, branch] of byVersion) {
    const version = parseReleaseVersion(raw)

    if (version === null) {
      continue
    }

    candidates.push({
      branch,
      version,
      isMergedIntoProduction: mergedIntoProduction.has(branch.name),
    })
  }

  return candidates
}

/** Loads the detail for one release branch. */
async function buildReleaseState(
  provider: IRepositoryProvider,
  candidate: IReleaseCandidate,
  integrationRef: string,
  productionRef: string,
  sequenceOverrides: ReadonlyMap<string, number> | undefined,
  loadCommits: boolean = true
): Promise<IReleaseBranchState> {
  const releaseRef = candidate.branch.name

  // Drift is only measured for the release being shown in full. The "also open"
  // rows display a version and a commit count and nothing else, so asking git how
  // far each of them has drifted was a process apiece for a number no view reads —
  // three of HOTWebsites' twenty-seven. Zero here means unmeasured, not current,
  // which is safe only because `verdict` isn't shown for those rows either; if that
  // changes, this has to start measuring again rather than the zero being believed.
  // Drift and the commit ranges are independent questions, so they're asked at the
  // same time. Awaiting drift first was a serial hop for nothing.
  const [drift, commits, releaseOnlyCommits, incomingCommits] = loadCommits
    ? await Promise.all([
        provider.getAheadBehind(releaseRef, integrationRef),
        loadRange(provider, productionRef, releaseRef),
        loadRange(provider, integrationRef, releaseRef),
        loadRange(provider, releaseRef, integrationRef),
      ])
    : [null, [], [], []]

  const behindIntegration = drift?.behind ?? 0

  // How far ahead of production this release is, worked out here rather than for
  // every candidate — only the releases that get shown need the number, and each
  // one costs a git process.
  //
  // When the commits are loaded it's free: they *are* `production..release`, so
  // counting them is the same answer without asking git twice. A release known to
  // be merged is zero by definition. Otherwise it takes the one extra call.
  const aheadOfProduction = loadCommits
    ? commits.length
    : candidate.isMergedIntoProduction
    ? 0
    : (await provider.getAheadBehind(releaseRef, productionRef))?.ahead ?? 0

  const vsoNumbers = extractVsoNumbersFromCommits(commits)

  const contributorCount = new Set(commits.map(c => c.author.name)).size

  return {
    branch: candidate.branch,
    version: candidate.version,
    releaseSequence: resolveReleaseSequence(
      candidate.branch.nameWithoutRemote,
      candidate.version,
      sequenceOverrides
    ),
    commits,
    releaseOnlyCommits,
    incomingCommits,
    aheadOfProduction,
    behindIntegration,
    vsoNumbers,
    contributorCount,
    verdict: computeVerdict(aheadOfProduction, behindIntegration),
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

/**
 * Loads full commits (with bodies, for VSO extraction) in `from..to`.
 *
 * The provider swallows a bad range into an empty list rather than throwing, so
 * a mis-detected range degrades to "nothing here" instead of an error screen.
 */
function loadRange(
  provider: IRepositoryProvider,
  from: string,
  to: string
): Promise<ReadonlyArray<Commit>> {
  return provider.getCommitRange(from, to, MaxCommitsPerRange)
}

/** Commits and VSOs sitting in development but not yet shipped to production. */
async function collectUnreleased(
  provider: IRepositoryProvider,
  productionRef: string,
  integrationRef: string
): Promise<{ commitCount: number; vsoCount: number }> {
  const commits = await loadRange(provider, productionRef, integrationRef)

  return {
    commitCount: commits.length,
    vsoCount: extractVsoNumbersFromCommits(commits).length,
  }
}

/**
 * Every VSO number that has a feature branch in this repository.
 *
 * Deliberately every `feature/*` ref rather than the unmerged ones
 * `collectFeatureBranches` returns: this answers "does this repository own this
 * work item", and owning it doesn't stop being true when the branch merges. A
 * branch merged into develop but not yet into the release is exactly the case the
 * reconciliation needs to warn about.
 *
 * Free — the branch list is already loaded for alias resolution, so this is string
 * parsing rather than another git call.
 */
function collectFeatureBranchVsos(
  branches: ReadonlyArray<Branch>
): ReadonlyArray<number> {
  const vsos = new Set<number>()

  for (const branch of branches) {
    if (branch.isDesktopForkRemoteBranch) {
      continue
    }

    const parsed = parseFeatureBranchName(branch.nameWithoutRemote)

    if (parsed !== null) {
      vsos.add(parsed.vso)
    }
  }

  return [...vsos].sort((a, b) => a - b)
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
 *
 * The branch you're standing on is exempt from that. A feature branch cut a
 * moment ago has no commits of its own, so integration contains it and the rule
 * above would throw it away — Start feature would appear to do nothing until you
 * made your first commit. Worse, whether it did depended on how far the local
 * integration branch had fallen behind its remote: a new branch showed up in
 * NimbleObt, 41 commits behind, and vanished in HOTWebsites, which was in step.
 * The filter is there to hide other people's long-merged branches, and the one
 * under your feet is never that.
 */
async function collectFeatureBranches(
  provider: IRepositoryProvider,
  branches: ReadonlyArray<Branch>,
  integrationRef: string,
  checkedOutBranchName: Promise<string | null>
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

  // One query for every branch integration already contains, rather than an
  // ahead/behind per branch. "Nothing ahead of integration" and "merged into
  // integration" are the same condition, and this was the largest remaining block
  // of git processes in the refresh — sixteen of them in NimbleObt.
  const [merged, checkedOut] = await Promise.all([
    provider.getMergedBranches(integrationRef, [...byName.values()]),
    checkedOutBranchName,
  ])

  const states: Array<IFeatureBranchState> = []

  for (const branch of byName.values()) {
    const parsed = parseFeatureBranchName(branch.name)

    if (parsed === null) {
      continue
    }

    // A feature branch integration already holds is merged or never started;
    // either way it isn't open work — unless it's the one checked out, which is
    // the work in front of you whether or not it has any commits yet.
    const isCheckedOut =
      checkedOut !== null && branch.nameWithoutRemote === checkedOut

    if (merged.has(branch.name) && !isCheckedOut) {
      continue
    }

    states.push({ branch, vso: parsed.vso, slug: parsed.slug })
  }

  return states.sort((a, b) => a.vso - b.vso)
}

/**
 * Shipped releases, newest first, read from version-shaped tags reachable from
 * production.
 *
 * Uses a single `for-each-ref --merged` query rather than testing each tag for
 * ancestry, which would be one git call per tag.
 */
async function collectReleaseHistory(
  provider: IRepositoryProvider,
  productionRef: string
): Promise<ReadonlyArray<IShippedRelease>> {
  const tags = await provider.getMergedTags(productionRef)

  const releases: Array<IShippedRelease> = []

  for (const tag of tags) {
    // House of Travel tags are bare versions — `1.2026.9`, no `v` prefix — so a
    // tag is a release exactly when it parses as a version.
    const version = parseReleaseVersion(tag.name)

    if (version === null) {
      continue
    }

    releases.push({
      version,
      tagName: tag.name,
      sha: tag.sha,
      shippedAt: tag.date,
      // Unread. `loadReleaseHistoryContents` fills these in after the refresh.
      commits: null,
      vsoNumbers: null,
    })
  }

  // Newest first.
  releases.sort((a, b) => compareReleaseVersions(b.version, a.version))

  const trimmed = releases.slice(0, ReleaseHistoryLimit)

  // Contents are left unread here and fetched afterwards by
  // `loadReleaseHistoryContents`. Reading them costs a `git log` each, and twelve
  // of those were the biggest single block in a refresh — HOTWebsites spent 900ms
  // of 1875ms on a list down the side of the view.
  //
  // The oldest entry is the exception: it has no tag beneath it, so there is nothing
  // to read and empty is the answer rather than a wait.
  return trimmed.map((release, index) =>
    trimmed[index + 1] === undefined
      ? { ...release, commits: [], vsoNumbers: [] }
      : release
  )
}

/**
 * Reads what each shipped release introduced, for a history the refresh left unread.
 *
 * Split out of detection so the release picture can be on screen before this starts.
 * Every range is independent, so they all go at once — off the critical path, the
 * only cost is git processes competing with each other rather than with anything the
 * user is waiting on.
 *
 * Entries that already have contents are left alone, so this is safe to call again.
 */
export async function loadReleaseHistoryContents(
  provider: IRepositoryProvider,
  history: ReadonlyArray<IShippedRelease>
): Promise<ReadonlyArray<IShippedRelease>> {
  return Promise.all(
    history.map(async (release, index) => {
      const previous = history[index + 1]

      if (release.commits !== null || previous === undefined) {
        return release
      }

      const commits = await loadRange(
        provider,
        previous.tagName,
        release.tagName
      )

      return {
        ...release,
        commits,
        vsoNumbers: extractVsoNumbersFromCommits(commits),
      }
    })
  )
}

/**
 * A suggestion for the version a new release branch would be cut as.
 *
 * The highest version this repository knows about, plus one. Only ever a pre-fill
 * for an editable field, and it is regularly wrong — deliberately so, because it
 * can't be right from git alone.
 *
 * The third segment is the calendar cycle, not a per-repository counter: 1.2026.17
 * is cycle 17 of 2026, which is where the Azure DevOps release sequence 202617
 * comes from. A repository that skips a cycle therefore skips a number.
 * ExpediaWebApi last released in cycle 15 and its next release is 1.2026.17, while
 * this returns 1.2026.16 — nothing in its own history records that cycle 16 came
 * and went without it.
 *
 * Guessing better would mean asking Azure DevOps which cycle is current, and a
 * confident wrong answer is worse than an obvious one in a field you're already
 * expected to check.
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
