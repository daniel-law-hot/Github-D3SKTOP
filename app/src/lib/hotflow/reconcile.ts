import {
  IHotFlowState,
  IReconciledWorkItem,
  IReconciliation,
  IReleaseBranchState,
  IWorkItem,
} from '../../models/hotflow'

/**
 * Three-way reconciliation between git and Azure DevOps.
 *
 * - A = VSOs found in `main..release` (git truth: what is actually there)
 * - B = work items assigned to the release's sequence number in ADO, narrowed to
 *       this repository (intent: what was planned)
 *
 * The interesting set is B \ A — planned but not merged. That's the failure mode
 * no amount of staring at a commit graph will surface, and it's the reason the
 * ADO integration exists at all.
 */
export function reconcileWorkItems(
  inRelease: ReadonlyArray<number>,
  sequenceAssigned: ReadonlyArray<number>,
  workItems: ReadonlyMap<number, IWorkItem>,

  /**
   * Drops the planned-but-not-merged rows, for a repository that has asked not to
   * be told about them.
   *
   * The rest of the reconciliation still runs: knowing an item *was* planned is
   * what separates the happy path from an unplanned extra, and that is worth
   * keeping. Only the absences go.
   */
  suppressMissing: boolean = false,

  /**
   * VSO numbers whose feature branch production already contains.
   *
   * Anything here is reported as shipped earlier rather than missing, and is not
   * counted in `missingCount` — which decides the release verdict, so counting
   * it would argue against shipping a release over work that already shipped.
   */
  shippedEarlier: ReadonlySet<number> = new Set()
): IReconciliation {
  const releaseSet = new Set(inRelease)
  const taggedSet = new Set(sequenceAssigned)

  const items: Array<IReconciledWorkItem> = []

  let inReleaseTaggedCount = 0
  let missingCount = 0
  let untaggedCount = 0

  // Everything in the release, split by whether it was planned for this release.
  for (const id of releaseSet) {
    const presence = taggedSet.has(id)
      ? 'in-release-tagged'
      : 'in-release-untagged'

    if (presence === 'in-release-tagged') {
      inReleaseTaggedCount++
    } else {
      untaggedCount++
    }

    items.push({ id, presence, workItem: workItems.get(id) ?? null })
  }

  // Assigned to the release but absent from it.
  if (!suppressMissing) {
    for (const id of taggedSet) {
      if (releaseSet.has(id)) {
        continue
      }

      if (shippedEarlier.has(id)) {
        items.push({
          id,
          presence: 'shipped-earlier',
          workItem: workItems.get(id) ?? null,
        })

        continue
      }

      missingCount++
      items.push({
        id,
        presence: 'missing-from-release',
        workItem: workItems.get(id) ?? null,
      })
    }
  }

  return {
    items: sortReconciledItems(items),
    inReleaseTaggedCount,
    missingCount,
    untaggedCount,

    // Nothing came back for the sequence, so every count above is trivially zero
    // rather than genuinely clean.
    noSequenceMatches: sequenceAssigned.length === 0,
  }
}

/**
 * Orders rows so the ones needing attention surface first: missing, then
 * present-and-planned, then untagged extras. Within a group, by id ascending so
 * the list is stable across refreshes.
 */
function sortReconciledItems(
  items: ReadonlyArray<IReconciledWorkItem>
): ReadonlyArray<IReconciledWorkItem> {
  const rank: Record<IReconciledWorkItem['presence'], number> = {
    'missing-from-release': 0,
    'in-release-tagged': 1,
    'in-release-untagged': 2,

    // Below the outstanding rows: work that shipped is settled, and sorting it
    // with the things still to do would put the calmest rows at the top of a
    // list read for what needs attention.
    'shipped-earlier': 3,

    // Never mixed with the others — a reconciliation is either comparing against
    // a plan or it isn't — so its rank only has to be stable, not chosen.
    merged: 4,
  }

  return [...items].sort((a, b) => {
    const byRank = rank[a.presence] - rank[b.presence]
    return byRank !== 0 ? byRank : a.id - b.id
  })
}

/**
 * Reconciles a release against whatever Azure DevOps told us, falling back to
 * git alone when ADO isn't available. Keeps every caller on one code path.
 */
export function reconcileRelease(
  hotFlowState: IHotFlowState,
  release: IReleaseBranchState
): IReconciliation {
  const { ado } = hotFlowState

  // No sequence number means there is no plan in Azure DevOps this release
  // answers to, so there is nothing to reconcile and every comparison below
  // would be against an empty set — which reads as "everything is missing" or
  // "nothing was planned", neither of which is true. What's left is what git
  // knows: these work items were merged.
  if (release.releaseSequence === null || ado.status !== 'ok') {
    return gitOnlyReconciliation(release.vsoNumbers)
  }

  return reconcileWorkItems(
    release.vsoNumbers,
    ado.sequenceAssignedIds,
    ado.workItems,
    hotFlowState.suppressAssignedNotMerged,
    new Set(hotFlowState.shippedFeatureVsos)
  )
}

/**
 * How many work items are assigned to the release but absent from it — the
 * number that decides whether a release is really ready to ship.
 */
export function getMissingWorkItemCount(hotFlowState: IHotFlowState): number {
  const release = hotFlowState.currentRelease

  if (release === null) {
    return 0
  }

  return reconcileRelease(hotFlowState, release).missingCount
}

/**
 * Builds a reconciliation for the git-only case — no ADO detail available, so
 * every VSO we found is simply "in the release" with nothing to compare against.
 * Keeps the UI on one code path whether or not ADO is reachable.
 */
export function gitOnlyReconciliation(
  inRelease: ReadonlyArray<number>
): IReconciliation {
  return {
    items: [...inRelease]
      .sort((a, b) => a - b)
      .map(id => ({
        id,
        // `merged`, not `in-release-tagged`: nothing was compared, so calling
        // these assigned to the release would be asserting something nobody
        // checked. They used to claim exactly that.
        presence: 'merged' as const,
        workItem: null,
      })),
    inReleaseTaggedCount: inRelease.length,
    missingCount: 0,
    untaggedCount: 0,

    // Nothing to compare against, so this isn't a claim about the sequence.
    noSequenceMatches: false,
  }
}
