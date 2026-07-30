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
   * The segment that plausibly identifies the release cycle — the one straight
   * after the year, so a hotfix version like `1.2026.16.1` still reports 16.
   *
   * This is HotFlow's *guess* at the cycle number and is never treated as
   * authoritative; see `guessCycle`.
   */
  readonly cycleSegment: number | null
}

/** How confident HotFlow is about which ADO cycle a release belongs to. */
export interface IReleaseCycle {
  /** The ADO tag, e.g. `202609`. */
  readonly tag: string

  /** The cycle number on its own, e.g. 9. */
  readonly cycle: number

  /** The year, e.g. 2026. */
  readonly year: number

  /**
   * False when the tag was inferred from the version number and the user hasn't
   * confirmed it. Reconciliation results derived from an unconfirmed cycle are
   * presented as provisional.
   */
  readonly confirmed: boolean
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
   * True when the cycle backing this reconciliation is unconfirmed, meaning
   * `missingCount` can't be trusted.
   */
  readonly provisional: boolean
}

/** Everything HotFlow knows about one release branch. */
export interface IReleaseBranchState {
  readonly branch: Branch
  readonly version: IReleaseVersion
  readonly cycle: IReleaseCycle | null

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
  readonly aheadOfIntegration: number
}

/** A release that has already shipped, identified by its tag on production. */
export interface IShippedRelease {
  readonly version: IReleaseVersion
  readonly tagName: string
  readonly sha: string
  readonly shippedAt: Date | null
  readonly vsoCount: number
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

  /** VSO ids tagged with the current release's cycle tag. */
  readonly cycleTaggedIds: ReadonlyArray<number>

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

  /** Commits in `production..integration` — the full unreleased backlog. */
  readonly unreleasedCommitCount: number
  readonly unreleasedVsoCount: number

  /** The version a new release branch would be cut as. */
  readonly nextVersion: string | null

  readonly ado: IAdoState
}

export const defaultAdoState: IAdoState = {
  status: 'unconfigured',
  authMethod: null,
  workItems: new Map<number, IWorkItem>(),
  cycleTaggedIds: [],
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
  unreleasedCommitCount: 0,
  unreleasedVsoCount: 0,
  nextVersion: null,
  ado: defaultAdoState,
}
