import { Branch, IAheadBehind } from '../../models/branch'
import { Commit } from '../../models/commit'

/**
 * Everything HotFlow needs to read about a repository, expressed as questions
 * rather than as git commands.
 *
 * HotFlow grew up talking to dugite directly, which quietly assumed a working
 * copy on disk — clone the repository, fetch it, keep it current. That's the
 * right assumption inside Desktop and the wrong one everywhere else: the release
 * picture is entirely derivable from a remote, and requiring forty-odd clones to
 * look at it is a cost with nothing to show for it.
 *
 * So the reads live behind this. Two implementations satisfy it — one over
 * dugite for Desktop, one over the GitHub API for the standalone app — and
 * `detect.ts` cannot tell which it has. Every method here is a read; nothing in
 * this interface writes.
 *
 * The methods are deliberately bulk-shaped where the git implementation can
 * answer many things in one process. `getMergedBranches` takes a list rather
 * than being asked once per branch because doing otherwise cost sixteen git
 * processes in NimbleObt, and that saving must survive the abstraction rather
 * than being abstracted away.
 */
export interface IRepositoryProvider {
  /**
   * True when a local working copy backs this provider.
   *
   * Two of the finish-release preflight checks — a clean working directory, and
   * production matching its remote — are questions about a working copy rather
   * than about the release. Without one they don't become false, they stop
   * existing, and the caller skips them rather than reporting a failure it
   * invented.
   */
  readonly hasWorkingCopy: boolean

  /** Every branch, local and remote. */
  getBranches(): Promise<ReadonlyArray<Branch>>

  /**
   * The short name of the checked-out branch — `release/1.2026.17`, never
   * `refs/heads/release/1.2026.17`.
   *
   * Null on a detached HEAD, and null for any provider with no working copy,
   * which simply means there's no explicit choice to honour.
   */
  getCheckedOutBranchName(): Promise<string | null>

  /** The remote's default branch, used as the safety net when no alias matches. */
  getDefaultBranchName(): Promise<string | null>

  /**
   * Of the given branches, which does `intoRef` already contain?
   *
   * Returns short names matching `Branch.name`, so a local `release/1.2026.17`
   * and an `origin/release/1.2026.17` stay distinguishable — they legitimately
   * differ when one has been pushed and the other hasn't.
   */
  getMergedBranches(
    intoRef: string,
    branches: ReadonlyArray<Branch>
  ): Promise<ReadonlySet<string>>

  /** Tags reachable from `intoRef`, newest-first ordering left to the caller. */
  getMergedTags(intoRef: string): Promise<ReadonlyArray<IProviderTag>>

  /** Every tag name in the repository, for "has this version shipped already". */
  getAllTagNames(): Promise<ReadonlySet<string>>

  /**
   * How far `ref` and `otherRef` have diverged from each other.
   *
   * Null when the question can't be answered — an unknown ref, or two refs with
   * no common ancestor.
   */
  getAheadBehind(ref: string, otherRef: string): Promise<IAheadBehind | null>

  /** Commits in `from..to`, newest first, capped at `limit`. */
  getCommitRange(
    from: string,
    to: string,
    limit: number
  ): Promise<ReadonlyArray<Commit>>

  /** The merge base of two refs, or null when they share no history. */
  getMergeBase(ref: string, otherRef: string): Promise<string | null>

  /**
   * Whether the working directory has no uncommitted changes.
   *
   * Null when there is no working copy to ask about. Callers must treat null as
   * "not applicable" rather than as false — see `hasWorkingCopy`.
   */
  isWorkingTreeClean(): Promise<boolean | null>

  /**
   * How far a branch has diverged from the remote branch it tracks.
   *
   * Null when it tracks nothing, or when there is no working copy and so no
   * local branch that could be out of step.
   */
  getUpstreamDivergence(branch: Branch): Promise<IAheadBehind | null>
}

/** A tag, as much of it as HotFlow reads. */
export interface IProviderTag {
  readonly name: string
  readonly sha: string

  /**
   * When the tag was made.
   *
   * Annotated tags carry their own date; lightweight tags fall back to the date
   * of the commit they point at, which for a release tag is the merge that
   * shipped it — so the answer is right either way. Null when unparseable.
   */
  readonly date: Date | null
}
