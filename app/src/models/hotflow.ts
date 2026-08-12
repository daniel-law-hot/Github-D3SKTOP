import { Branch } from './branch'
import { Commit } from './commit'

/**
 * Candidate names for the integration branch, in priority order.
 *
 * `develop` is the convention across the House of Travel repositories;
 * `development` appears in the Desktop fork itself. `dev` is last deliberately —
 * it's far more likely to be someone's scratch branch than the real integration
 * branch, so it must never win in a repository that also has `develop`.
 */
export const IntegrationBranchAliases: ReadonlyArray<string> = [
  'develop',
  'development',
  'dev',
]

/** Candidate names for the production branch, in priority order. */
export const ProductionBranchAliases: ReadonlyArray<string> = ['main', 'master']

/** Used only for copy when no branch has been resolved yet. */
export const DefaultIntegrationBranchName = IntegrationBranchAliases[0]
export const DefaultProductionBranchName = ProductionBranchAliases[0]

/** A per-repository override of the branches HotFlow should use. */
export interface IHotFlowBranchOverride {
  readonly integrationBranch?: string
  readonly productionBranch?: string
}

/** How a branch was arrived at, so the UI can be honest about it. */
export type BranchResolution =
  /** Matched one of the known aliases. */
  | 'alias'
  /** The user pinned it for this repository. */
  | 'override'
  /** Fell back to the repository's default branch. */
  | 'default-branch'

export interface IResolvedBranch {
  readonly branch: Branch
  readonly resolution: BranchResolution

  /** True when only a remote tracking branch exists, with no local branch. */
  readonly remoteOnly: boolean
}

/**
 * A parsed release version, e.g. `1.2026.9` -> segments [1, 2026, 9].
 *
 * `raw` is preserved verbatim because it's what we match against tags and what
 * we show the user — never reconstruct a version from its segments.
 */
export interface IReleaseVersion {
  /** The version exactly as it appeared in the branch or tag name. */
  readonly raw: string

  /**
   * Numeric segments, in order. Segments which aren't purely numeric are
   * represented as `null` and sort after numeric ones.
   */
  readonly segments: ReadonlyArray<number | null>

  /**
   * The year segment, if the version looks like `<major>.<year>.<n>` with a
   * plausible four-digit year. Used to seed the cycle guess.
   */
  readonly year: number | null

  /**
   * The segment holding the cycle number — the one straight after the year, so a
   * hotfix version like `1.2026.16.1` still reports 16.
   *
   * Combined with the year this gives the release sequence number; see
   * `deriveReleaseSequence`.
   */
  readonly cycleSegment: number | null
}

/**
 * The Azure DevOps release sequence number a release branch maps to.
 *
 * Derived from the version by concatenating the year and the cycle segment:
 * `1.2026.17` gives 202617, which is what the work items' "Release sequence
 * number" field holds. That derivation is right wherever the version's cycle
 * segment is the calendar cycle, which is the convention across House of Travel —
 * but nothing in git can confirm it, so the number is shown plainly and can be
 * changed by clicking it.
 */
export interface IReleaseSequence {
  /** The value, e.g. 202617. */
  readonly value: number

  /**
   * True when this came from the user rather than from the version.
   *
   * Only ever set when the stored value actually differs from what the version
   * gives — re-stating the derived number isn't an override, and shouldn't read
   * as one.
   */
  readonly isOverridden: boolean
}

/** Where a release branch sits in the flow. */
export type ReleaseVerdict =
  /** Current with integration, nothing outstanding. Safe to ship. */
  | 'ready'
  /** Behind integration, or work items assigned to the release are missing. */
  | 'needs-update'
  /** Already merged into the production branch. */
  | 'shipped'
  /** Not enough information — e.g. an unparseable version. */
  | 'unknown'

/** A work item as returned by Azure DevOps. */
export interface IWorkItem {
  readonly id: number
  readonly title: string
  readonly workItemType: string
  readonly state: string
  readonly assignedTo: string | null
  readonly tags: ReadonlyArray<string>

  /**
   * The "Release sequence number" from the work item's Details — the
   * `{year}{cycle:00}` value saying which release it belongs to, or null when
   * nobody has set one.
   *
   * This, not `System.Tags`, is how House of Travel records the release.
   */
  readonly releaseSequence: number | null
}

/**
 * How many reviewers have approved a pull request, and how many have asked for
 * changes — counted the way GitHub does, latest review per reviewer.
 */
export interface IPullRequestApproval {
  readonly approvals: number
  readonly changesRequested: number
}

/** Approvals at or above this count are treated as ready to merge. */
export const ApprovalsForReady = 2

/**
 * One feature branch in the lane feeding the integration branch.
 *
 * Sourced from git, because branches are always visible whereas pull request data
 * is only present once Desktop has fetched it from the API. The pull request
 * number annotates a branch when we happen to know it — it never decides whether
 * the branch is shown.
 */
export interface IFeatureLaneEntry {
  readonly branchName: string
  readonly pullRequestNumber: number | null

  /**
   * True when only the remote has this branch, so checking it out creates a
   * local one. Worth saying out loud rather than surprising someone with it.
   */
  readonly isRemoteOnly: boolean

  /**
   * The VSO number from the branch name, or null when it doesn't carry one.
   *
   * Drives the lane's order. Null for a branch named off-convention, which sorts
   * last rather than as zero — it isn't the oldest work, it's unidentified work.
   */
  readonly vso: number | null
}

/** Which side(s) of the git/ADO reconciliation a work item appeared on. */
export type WorkItemPresence =
  /** In the release branch and tagged for the cycle. The happy path. */
  | 'in-release-tagged'
  /** Assigned to the release but not present in the release branch. */
  | 'missing-from-release'
  /** In the release branch but not assigned to the release in ADO. */
  | 'in-release-untagged'

/** One row of the reconciled work item list. */
export interface IReconciledWorkItem {
  readonly id: number
  readonly presence: WorkItemPresence

  /** Detail from ADO. Null when ADO is unavailable — we still show the id. */
  readonly workItem: IWorkItem | null
}

/** The outcome of reconciling git against ADO. */
export interface IReconciliation {
  readonly items: ReadonlyArray<IReconciledWorkItem>
  readonly inReleaseTaggedCount: number
  readonly missingCount: number
  readonly untaggedCount: number

  /**
   * True when Azure DevOps returned no work items for the release sequence.
   *
   * Every count here is then trivially zero, which looks identical to a release
   * with nothing outstanding. Since the sequence number is derived from the
   * version, the likelier explanation is that the derivation is wrong — so this
   * says so rather than reporting a clean bill of health.
   */
  readonly noSequenceMatches: boolean
}

/** Everything HotFlow knows about one release branch. */
export interface IReleaseBranchState {
  readonly branch: Branch
  readonly version: IReleaseVersion

  /** The ADO release sequence number, derived from the version or overridden. */
  readonly releaseSequence: IReleaseSequence | null

  /** Commits in `production..release` — what this release would ship. */
  readonly commits: ReadonlyArray<Commit>

  /**
   * Commits on the release branch that aren't in `development`. Rare, but when
   * present they'd be orphaned on main unless merged back.
   */
  readonly releaseOnlyCommits: ReadonlyArray<Commit>

  /** Commits in `release..integration` — the drift that needs pulling in. */
  readonly incomingCommits: ReadonlyArray<Commit>

  readonly aheadOfProduction: number
  readonly behindIntegration: number

  /** VSO numbers extracted from `production..release`. */
  readonly vsoNumbers: ReadonlyArray<number>

  /** Distinct commit author names in `production..release`. */
  readonly contributorCount: number

  readonly verdict: ReleaseVerdict
}

/** A feature branch with work not yet in the integration branch. */
export interface IFeatureBranchState {
  readonly branch: Branch
  readonly vso: number
  readonly slug: string
  // `aheadOfIntegration` used to live here. Nothing ever read it, and computing it
  // cost one git process per feature branch — sixteen in NimbleObt — to produce a
  // number no view displayed. Whether a branch is open at all is now answered for
  // every branch at once by `--merged`.
}

/** A release that has already shipped, identified by its tag on production. */
export interface IShippedRelease {
  readonly version: IReleaseVersion
  readonly tagName: string
  readonly sha: string
  readonly shippedAt: Date | null

  /**
   * What this release introduced — the commits between the tag below it and this
   * one.
   *
   * Kept rather than discarded because they're loaded anyway to count the VSOs, so
   * holding them makes inspecting a past release free rather than another round of
   * git. Empty for the oldest release in the window, which has no tag beneath it to
   * diff against.
   */
  readonly commits: ReadonlyArray<Commit>

  /** The VSO numbers those commits reference, ascending. */
  readonly vsoNumbers: ReadonlyArray<number>
}

/** How HotFlow is talking to Azure DevOps, if at all. */
export type AdoStatus =
  /** No credentials available and the user hasn't been asked yet. */
  'unconfigured' | 'loading' | 'ok' | 'error'

export interface IAdoState {
  readonly status: AdoStatus
  readonly authMethod: 'az' | 'pat' | null

  /** Work item detail, keyed by id. Empty unless status is `ok`. */
  readonly workItems: ReadonlyMap<number, IWorkItem>

  /**
   * Work item ids assigned to the current release's sequence number, narrowed to
   * this repository — see `work-item-scope.ts`.
   */
  readonly sequenceAssignedIds: ReadonlyArray<number>

  readonly errorMessage: string | null
}

/** The complete HotFlow view state for one repository. */
export interface IHotFlowState {
  readonly isLoading: boolean
  readonly lastRefreshed: number | null
  readonly errorMessage: string | null

  /**
   * Which of the two required branches couldn't be found — 'integration',
   * 'production', or both. When non-empty the view renders an explanation
   * rather than a broken dashboard.
   */
  readonly missingRequiredBranches: ReadonlyArray<'integration' | 'production'>

  readonly integrationBranch: Branch | null
  readonly productionBranch: Branch | null

  /** How each branch was resolved, for display. Null when unresolved. */
  readonly integrationResolution: IResolvedBranch | null
  readonly productionResolution: IResolvedBranch | null

  /**
   * Display names for the resolved branches, falling back to the primary alias
   * when nothing was resolved. Every piece of user-facing copy reads these
   * rather than assuming a name.
   */
  readonly integrationBranchName: string
  readonly productionBranchName: string

  /**
   * The release shipping next — the lowest-versioned release branch not yet
   * merged into main.
   */
  readonly currentRelease: IReleaseBranchState | null

  /** Higher-versioned unshipped release branches. Usually empty. */
  readonly otherOpenReleases: ReadonlyArray<IReleaseBranchState>

  readonly releaseHistory: ReadonlyArray<IShippedRelease>
  readonly openFeatureBranches: ReadonlyArray<IFeatureBranchState>

  /**
   * Every VSO number with a `feature/{vso}-…` branch in this repository, merged or
   * not, local or remote.
   *
   * This is how a work item is attributed to a repository — see
   * `work-item-scope.ts`. Deliberately not limited to `openFeatureBranches`:
   * ownership doesn't lapse when a branch merges, and a branch merged into develop
   * but not yet into the release is precisely the case worth warning about.
   */
  readonly featureBranchVsos: ReadonlyArray<number>

  /** Commits in `production..integration` — the full unreleased backlog. */
  readonly unreleasedCommitCount: number
  readonly unreleasedVsoCount: number

  /** The version a new release branch would be cut as. */
  readonly nextVersion: string | null

  /**
   * Approval state for open pull requests, keyed by pull request number.
   *
   * A missing entry means unknown rather than unapproved — reviews are a separate
   * API read that can fail or not have happened yet.
   */
  readonly pullRequestApprovals: ReadonlyMap<number, IPullRequestApproval>

  readonly ado: IAdoState
}

export const defaultAdoState: IAdoState = {
  status: 'unconfigured',
  authMethod: null,
  workItems: new Map<number, IWorkItem>(),
  sequenceAssignedIds: [],
  errorMessage: null,
}

export const defaultHotFlowState: IHotFlowState = {
  isLoading: false,
  lastRefreshed: null,
  errorMessage: null,
  missingRequiredBranches: [],
  integrationBranch: null,
  productionBranch: null,
  integrationResolution: null,
  productionResolution: null,
  integrationBranchName: DefaultIntegrationBranchName,
  productionBranchName: DefaultProductionBranchName,
  currentRelease: null,
  otherOpenReleases: [],
  releaseHistory: [],
  openFeatureBranches: [],
  featureBranchVsos: [],
  unreleasedCommitCount: 0,
  unreleasedVsoCount: 0,
  nextVersion: null,
  pullRequestApprovals: new Map<number, IPullRequestApproval>(),
  ado: defaultAdoState,
}
