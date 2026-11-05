import { IRepositoryPipeline } from './ado-pipelines'

/** How often the release pipeline is read while something may be deploying. */
export const FastPollMs = 5 * 1000

/** How often it is read the rest of the time, so it never goes stale for long. */
export const SlowPollMs = 60 * 1000

/** How long after a merge, an approval or a finish the fast rate carries on. */
export const FastPollWindowMs = 10 * 60 * 1000

/**
 * How many releases a poll reads.
 *
 * Far fewer than the full read that opens HotFlow: a poll is after the state of
 * what is being deployed, which is in the newest few, and reading a hundred
 * releases every five seconds would be a megabyte a pipeline each time. The older
 * ones are kept from the full read (see `mergePipelineReleases`).
 */
export const PollReleaseLimit = 8

/**
 * How long to wait before the next poll.
 *
 * Fast until `fastUntil`, which is when the burst after a merge ends, and slow
 * otherwise. Pure so the rhythm can be tested without a clock.
 */
export function nextPollDelay(now: number, fastUntil: number | null): number {
  return fastUntil !== null && now < fastUntil ? FastPollMs : SlowPollMs
}

/**
 * Folds a short read of the newest releases into what is already known.
 *
 * A release the poll saw replaces the old copy (its stages moved), and the ones it
 * did not see are kept, so the earlier releases from the full read do not vanish
 * every time a poll comes back with only eight. Newest first, by release id, which
 * Azure DevOps assigns in order. A pipeline the poll did not return at all is left
 * as it was rather than dropped, since that is far more likely to be a hiccup than
 * the pipeline having gone.
 */
export function mergePipelineReleases(
  previous: ReadonlyArray<IRepositoryPipeline>,
  fresh: ReadonlyArray<IRepositoryPipeline>
): ReadonlyArray<IRepositoryPipeline> {
  const before = new Map(previous.map(p => [p.definitionId, p]))
  const merged: Array<IRepositoryPipeline> = []

  for (const pipeline of fresh) {
    const old = before.get(pipeline.definitionId)
    before.delete(pipeline.definitionId)

    if (old === undefined) {
      merged.push(pipeline)
      continue
    }

    const byId = new Map(old.releases.map(r => [r.id, r]))

    for (const release of pipeline.releases) {
      byId.set(release.id, release)
    }

    merged.push({
      ...pipeline,
      releases: [...byId.values()].sort((a, b) => b.id - a.id),
    })
  }

  return [...merged, ...before.values()]
}
