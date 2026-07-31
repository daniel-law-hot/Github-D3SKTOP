import { IReleaseVersion } from '../../models/hotflow'
import { compareReleaseVersions, isSameReleaseVersion } from './version'

/**
 * Choosing which release branch the view is about.
 *
 * The original rule was "lowest unshipped version, because releases ship in
 * order". That assumes one release in flight at a time, which isn't how every
 * repository works. HOTWebsites builds three products — COBT, HOBT and M&M — that
 * release independently from the same repository, so several `release/*` branches
 * are legitimately open at once: 1.2026.15 finished and awaiting go-live while
 * 1.2026.17 is in testing, and others alongside them for the other products.
 *
 * Nothing in git says which product a release branch belongs to. The branch name
 * carries a version and nothing else, so no ordering — lowest, highest, newest
 * commit — can work out which one you *meant*. Any automatic pick is a guess.
 *
 * So this stops guessing where it can and picks a sane default where it can't:
 *
 *  1. **A checked-out release branch wins.** That's not a heuristic, it's the
 *     user having already said which release they're working on, and it matches
 *     the House of Travel flow where you're on the release branch you're
 *     updating. It also gives "View" on another open release real teeth, since
 *     viewing checks it out.
 *  2. **Otherwise the highest unshipped version**, because "the latest release"
 *     is what people mean when they haven't said otherwise.
 *  3. **Everything else open is listed**, not hidden. In a repository like this
 *     that list is the point, not a footnote — it's the other products' releases.
 *
 * The bug this replaced wasn't really the ordering, though. It was counting a
 * shipped release as open: see `isShipped`.
 */

/** Just enough of a release branch to choose between them. */
export interface IReleaseChoice {
  readonly version: IReleaseVersion

  /** Commits on the branch that aren't in production. Zero means merged. */
  readonly aheadOfProduction: number

  /** The branch name as git reports it, matched against HEAD. */
  readonly branchName: string
}

/**
 * Whether a release has already gone out.
 *
 * Two independent ways of being shipped, and a release only needs one:
 *
 *  - **The branch is fully merged into production.** Nothing on it that isn't
 *    live.
 *  - **A tag for its version is reachable from production.** The release shipped
 *    even though the branch didn't merge — a squash merge, a rebase, or a branch
 *    that carried on after being tagged. HOTWebsites' 1.2026.7 is exactly this:
 *    tagged on main, and still 31 commits ahead of it.
 *
 * Checking only the first is the actual bug: 1.2026.7 shipped in July, its branch
 * stayed behind unmerged, and it was then presented as the release about to go out
 * while ten later ones sat under "also open".
 */
export function isShipped(
  release: IReleaseChoice,
  shippedVersions: ReadonlyArray<IReleaseVersion>
): boolean {
  if (release.aheadOfProduction === 0) {
    return true
  }

  return shippedVersions.some(v => isSameReleaseVersion(v, release.version))
}

export interface IReleaseSelection<T> {
  /** The release the view is about, or null when nothing is open. */
  readonly current: T | null

  /** Everything else still open, highest version first. */
  readonly others: ReadonlyArray<T>
}

/**
 * Picks the current release and orders the rest.
 *
 * @param candidates             Every release branch found.
 * @param shippedVersions        Versions tagged on production.
 * @param checkedOutBranchName   HEAD's branch, or null when detached.
 */
export function pickCurrentRelease<T extends IReleaseChoice>(
  candidates: ReadonlyArray<T>,
  shippedVersions: ReadonlyArray<IReleaseVersion>,
  checkedOutBranchName: string | null
): IReleaseSelection<T> {
  // Highest first: the default answer to "which release" is the latest one, and
  // this order is also what the "also open" list reads best in.
  const open = [...candidates]
    .filter(c => !isShipped(c, shippedVersions))
    .sort((a, b) => compareReleaseVersions(b.version, a.version))

  // An explicit choice beats any ordering. Searched across every candidate rather
  // than just the open ones, so deliberately checking out an old release shows it
  // instead of silently showing a different one.
  const checkedOut =
    checkedOutBranchName === null
      ? undefined
      : candidates.find(c => c.branchName === checkedOutBranchName)

  const current = checkedOut ?? open[0] ?? null

  return {
    current,
    others: open.filter(c => c !== current),
  }
}
