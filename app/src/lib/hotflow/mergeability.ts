import { Branch } from '../../models/branch'
import { ComputedAction } from '../../models/computed-action'
import { IFeatureBranchState } from '../../models/hotflow'
import { Repository } from '../../models/repository'
import { determineMergeability } from '../git/merge-tree'

/**
 * How many branches to test at once.
 *
 * `git merge-tree` is a process per branch, and this runs after the picture is
 * already on screen — so the aim is to finish soon without making the app feel
 * heavy while it does. Concurrency past a handful buys little here anyway: git
 * processes on Windows contend rather than queue, and measuring the release
 * refresh showed throughput flattening at about twice serial however many were
 * in flight.
 */
const Concurrency = 4

/**
 * Which feature branches would conflict if merged into the integration branch.
 *
 * The same question GitHub answers with "This branch has conflicts that must be
 * resolved", asked of git instead of the API. Deliberately so: it's what Desktop
 * does for its own merge dialogs, it needs no network, and it keeps working in an
 * organisation that hasn't approved the OAuth app — where the API tells us
 * nothing at all and a branch's state would otherwise be a blank.
 *
 * Skips branches already answered, so a refresh that rebuilds the lane doesn't
 * re-test everything it already knows.
 *
 * Returned keyed by `Branch.name` rather than by position, because a refresh can
 * land while this is in flight and rebuild the list underneath it.
 */
export async function loadFeatureBranchConflicts(
  repository: Repository,
  integrationBranch: Branch,
  featureBranches: ReadonlyArray<IFeatureBranchState>
): Promise<Map<string, boolean>> {
  const answers = new Map<string, boolean>()
  const pending = featureBranches.filter(
    f => f.conflictsWithIntegration === null
  )

  for (let i = 0; i < pending.length; i += Concurrency) {
    const batch = pending.slice(i, i + Concurrency)

    await Promise.all(
      batch.map(async feature => {
        // `ours` is the integration branch and `theirs` the feature, matching
        // what merging the pull request would do rather than the other way about
        // — the two differ, and only one of them is the question being asked.
        const result = await determineMergeability(
          repository,
          integrationBranch,
          feature.branch
        ).catch(() => null)

        // Anything other than a definite conflict is left unanswered rather than
        // called clean. `Invalid` means git couldn't say — unrelated histories, a
        // missing ref — and claiming "no conflicts" on the strength of a failed
        // check is the one answer here that could cost someone time.
        if (result === null) {
          return
        }

        if (result.kind === ComputedAction.Conflicts) {
          answers.set(feature.branch.name, true)
        } else if (result.kind === ComputedAction.Clean) {
          answers.set(feature.branch.name, false)
        }
      })
    )
  }

  return answers
}
