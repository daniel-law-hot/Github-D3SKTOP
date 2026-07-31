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
 * The rule: a work item needs a commit in this repository to count.
 *
 *  - links resolve here            → keep. It's ours.
 *  - links, none of which are ours → drop. It's another repository's.
 *  - no links at all               → drop. Nothing attributes it to anywhere.
 *
 * That last case used to be kept, on the reasoning that "planned but nobody has
 * started it" is the most useful thing this view can say and that dropping it
 * would make a release look readier than it is. The volume killed it. A cycle
 * carries around twenty work items across a dozen repositories, and every
 * unstarted one appeared in all of them — NimbleObt's release showed "Expedia:
 * Margin Manager", "CO Itinerary v2" and "StubaWebApi - Automated saving" as
 * assigned-but-not-merged, which reads as this repository missing work it never
 * owned.
 *
 * The reasoning was wrong, not just outweighed. An item with no commits anywhere
 * isn't evidence about *this* repository — it's evidence about the cycle. Showing
 * it in every repository is a false positive in all but one of them, and there's
 * no way to tell which one that is. So "assigned but not merged" now means
 * something precise and trustworthy: this repository has commits for it, and they
 * aren't in the release yet.
 *
 * The cost is real and worth naming: a work item planned for this repository that
 * nobody has begun is invisible here. Nothing in git or Azure DevOps ties it to a
 * repository, so HotFlow can't claim it either way — and a warning that fires in
 * eleven wrong places to be right in one isn't a warning.
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
    // No detail came back for it. The batch asks with `errorPolicy: 'omit'`, so an
    // absent entry means Azure DevOps has no such work item rather than that the
    // request failed — a failure takes the whole reconciliation to git-only. With
    // nothing to attribute, it doesn't belong to this repository either.
    const workItem = workItems.get(id)

    return (
      workItem !== undefined &&
      workItem.linkedCommitShas.some(sha => shasInRepository.has(sha))
    )
  })
}
