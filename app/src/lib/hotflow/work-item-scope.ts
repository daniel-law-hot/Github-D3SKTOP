import { IWorkItem } from '../../models/hotflow'

/**
 * Narrows a cycle's work items to the ones that belong to *this* repository.
 *
 * The cycle query can't do this itself. House of Travel runs one Azure DevOps
 * project (`Group`) across forty-odd GitHub repositories, and the release
 * sequence number is per cycle, not per repository — so "everything assigned to
 * 202617" is the same list whether you ask from ContentOrchestration or
 * AmadeusWebApi, and both releases carry version 1.2026.17.
 *
 * Nothing on the work item scopes it either. Sibling repositories share an area
 * path (`Group\Platform` covers both of the above), and tags are free text that
 * nobody fills in consistently. The only field that says where the work happened
 * is the Development links, so that's what this uses.
 *
 * The rule, deliberately asymmetric:
 *
 *  - links resolve here            → keep. It's ours.
 *  - links, none of which are ours → drop. Proven to be another repository's.
 *  - no links at all               → keep. Nobody has started it anywhere, and
 *                                    "planned but not begun" is the single most
 *                                    useful thing this view can tell you about a
 *                                    release. Dropping it would make the release
 *                                    look readier than it is.
 *
 * Only positive evidence excludes anything, because a false negative here hides
 * work that isn't done, which is exactly the failure the reconciliation exists to
 * catch.
 */

/**
 * Every commit sha referenced by the given work items, for resolving in one pass.
 *
 * Deduplicated: sibling work items routinely link the same merge commit.
 */
export function collectLinkedCommitShas(
  ids: ReadonlyArray<number>,
  workItems: ReadonlyMap<number, IWorkItem>
): ReadonlyArray<string> {
  const shas = new Set<string>()

  for (const id of ids) {
    for (const sha of workItems.get(id)?.linkedCommitShas ?? []) {
      shas.add(sha)
    }
  }

  return [...shas]
}

/**
 * Filters cycle-assigned ids down to this repository, given the subset of linked
 * shas that were found locally.
 *
 * `shasInRepository` is the answer from git; this function is the policy, kept
 * separate so the rule above can be tested without a repository.
 */
export function scopeToRepository(
  ids: ReadonlyArray<number>,
  workItems: ReadonlyMap<number, IWorkItem>,
  shasInRepository: ReadonlySet<string>
): ReadonlyArray<number> {
  return ids.filter(id => {
    const workItem = workItems.get(id)

    // No detail came back for it — ADO didn't return the item, so we know
    // nothing. Not grounds for hiding it.
    if (workItem === undefined) {
      return true
    }

    if (workItem.linkedCommitShas.length === 0) {
      return true
    }

    return workItem.linkedCommitShas.some(sha => shasInRepository.has(sha))
  })
}
