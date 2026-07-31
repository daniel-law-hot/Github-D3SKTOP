/**
 * Narrows a release sequence's work items to the ones that belong to *this*
 * repository.
 *
 * The sequence query can't do it itself. House of Travel runs one Azure DevOps
 * project (`Group`) across forty-odd GitHub repositories, and the release sequence
 * number is per cycle rather than per repository — so "everything assigned to
 * 202617" is the same list whether you ask from ContentOrchestration or
 * AmadeusWebApi, and both releases carry version 1.2026.17. Left unfiltered,
 * NimbleObt's release listed "Expedia: Margin Manager" and "StubaWebApi -
 * Automated saving" as work it was missing.
 *
 * Nothing on the work item scopes it. Sibling repositories share an area path
 * (`Group\Platform` covers both of the above), and tags are free text nobody fills
 * in consistently.
 *
 * What does scope it is the branch convention: work on VSO 104402 happens on
 * `feature/104402-…`, and that branch exists in the repository doing the work.
 * Nothing else in this system ties a work item to a repository as directly. Tested
 * against the real data it agrees exactly with the Development links — on
 * ContentOrchestration both pick out 104402, 106884 and 107035 — while needing no
 * ADO link wiring and no commit present in the local object database.
 *
 * Two ways to qualify, and either is enough:
 *
 *  - **A `feature/{vso}` branch exists here.** Someone started it in this
 *    repository.
 *  - **The release already contains it.** Git found the number in a commit in
 *    `production..release`, which is proof beyond argument — no branch needed,
 *    which matters because branches get deleted after they merge.
 *
 * That second clause is why this takes `inRelease`. Without it, an item whose
 * branch had been tidied away would drop out of "in release and assigned" and
 * reappear as "in release, not assigned" — a worse answer than the one it replaced.
 */
export function scopeToRepository(
  ids: ReadonlyArray<number>,
  vsosWithFeatureBranch: ReadonlySet<number>,
  inRelease: ReadonlySet<number>
): ReadonlyArray<number> {
  return ids.filter(id => vsosWithFeatureBranch.has(id) || inRelease.has(id))
}
