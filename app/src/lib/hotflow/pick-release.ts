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

  /**
   * Whether production already contains the whole branch.
   *
   * A boolean rather than a commit count: choosing between releases only needs to
   * know *whether* anything is outstanding, and the counts cost a git process each
   * while this comes free for every branch in one call.
   */
  readonly isMergedIntoProduction: boolean

  /** The branch name as git reports it, matched against HEAD. */
  readonly branchName: string
}

/**
 * Whether a release has already gone out.
 *
 * A tag for its version reachable from production settles it outright. That
 * catches the release whose branch never merged — a squash merge, a rebase, or a
 * branch that carried on afterwards. HOTWebsites' 1.2026.7 is exactly this:
 * tagged on main, and still 31 commits ahead of it. Going by the branch alone was
 * the original bug, and 1.2026.7 was presented as the release about to go out
 * while ten later ones sat under "also open".
 *
 * Failing a tag, a branch fully merged into production has usually shipped —
 * nothing on it that isn't live. But "contains nothing production doesn't" is
 * also true of a release branch cut a minute ago, which is the opposite of
 * shipped, and there's no way to tell those apart by containment alone.
 *
 * The version number tells them apart. A release numbered above everything that
 * has ever shipped hasn't shipped: NezasaWebApi's `release/1.2026.19` sat level
 * with main having just been cut, the newest tag was 1.2026.17, and it was being
 * called shipped and dropped from the open list — so HotFlow reported no release
 * branch from any feature branch, while checking 19 out found it again, because
 * that path looks at every candidate rather than the open ones.
 *
 * With no tags at all there's no evidence either way, and containment is the only
 * signal left, so it decides as it did before.
 */
export function isShipped(
  release: IReleaseChoice,
  shippedVersions: ReadonlyArray<IReleaseVersion>
): boolean {
  if (shippedVersions.some(v => isSameReleaseVersion(v, release.version))) {
    return true
  }

  if (!release.isMergedIntoProduction) {
    return false
  }

  const highestShipped = shippedVersions.reduce<IReleaseVersion | null>(
    (highest, v) =>
      highest === null || compareReleaseVersions(v, highest) > 0 ? v : highest,
    null
  )

  return (
    highestShipped === null ||
    compareReleaseVersions(release.version, highestShipped) <= 0
  )
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
