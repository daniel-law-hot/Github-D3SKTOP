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
 * - B = VSOs tagged with the release's cycle tag in ADO (intent: what was planned)
 *
 * The interesting set is B \ A — planned but not merged. That's the failure mode
 * no amount of staring at a commit graph will surface, and it's the reason the
 * ADO integration exists at all.
 */
export function reconcileWorkItems(
  inRelease: ReadonlyArray<number>,
  cycleTagged: ReadonlyArray<number>,
  workItems: ReadonlyMap<number, IWorkItem>,
  provisional: boolean
): IReconciliation {
  const releaseSet = new Set(inRelease)
  const taggedSet = new Set(cycleTagged)

  const items: Array<IReconciledWorkItem> = []

  let inReleaseTaggedCount = 0
  let missingCount = 0
  let untaggedCount = 0

  // Everything in the release, split by whether it was planned for this cycle.
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

  // Planned for the cycle but absent from the release.
  for (const id of taggedSet) {
    if (releaseSet.has(id)) {
      continue
    }

    missingCount++
    items.push({
      id,
      presence: 'missing-from-release',
      workItem: workItems.get(id) ?? null,
    })
  }

  return {
    items: sortReconciledItems(items),
    inReleaseTaggedCount,
    missingCount,
    untaggedCount,
    provisional,
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

  if (ado.status !== 'ok') {
    return gitOnlyReconciliation(release.vsoNumbers)
  }

  return reconcileWorkItems(
    release.vsoNumbers,
    ado.cycleTaggedIds,
    ado.workItems,
    release.cycle === null || !release.cycle.confirmed
  )
}

/**
 * How many work items are tagged for the cycle but absent from the release — the
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
        presence: 'in-release-tagged' as const,
        workItem: null,
      })),
    inReleaseTaggedCount: inRelease.length,
    missingCount: 0,
    untaggedCount: 0,
    provisional: false,
  }
}
