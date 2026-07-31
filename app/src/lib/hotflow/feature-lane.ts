import { IFeatureLaneEntry } from '../../models/hotflow'

/**
 * The order feature branches appear in above the integration branch.
 *
 * Three tiers, in this order:
 *
 *  1. **Has a pull request, or not.** Anything with one is closer to landing, and
 *     the lane draws those with solid connectors and the rest dashed — so they need
 *     to be grouped, not interleaved, or the two styles alternate down the column.
 *  2. **VSO number, ascending.** Matching the work item list, which also sorts by
 *     id ascending, so the same work reads in the same order in both places.
 *  3. **Branch name.** Only reached when two branches share a VSO, which happens
 *     when work is split across branches. Keeps the order stable across refreshes
 *     rather than letting it follow whatever order git listed refs in.
 *
 * A branch with no VSO sorts after every branch that has one — it isn't the
 * lowest-numbered work, it's work we can't place.
 */
export function compareFeatureLaneEntries(
  a: IFeatureLaneEntry,
  b: IFeatureLaneEntry
): number {
  const aHasPr = a.pullRequestNumber !== null
  const bHasPr = b.pullRequestNumber !== null

  if (aHasPr !== bHasPr) {
    return aHasPr ? -1 : 1
  }

  if (a.vso !== b.vso) {
    if (a.vso === null) {
      return 1
    }

    if (b.vso === null) {
      return -1
    }

    return a.vso - b.vso
  }

  return a.branchName.localeCompare(b.branchName)
}

/** Orders a lane without mutating the caller's array. */
export function sortFeatureLane(
  entries: ReadonlyArray<IFeatureLaneEntry>
): ReadonlyArray<IFeatureLaneEntry> {
  return [...entries].sort(compareFeatureLaneEntries)
}
