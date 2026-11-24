import { Branch } from '../../models/branch'
import { Commit } from '../../models/commit'
import {
  BranchAlignmentStatus,
  IAlignmentTag,
  IBranchAlignment,
  IMergeSimulation,
  IReleaseAlignment,
  IShippedRelease,
} from '../../models/hotflow'
import { IRepositoryProvider } from './repository-provider'

/**
 * How many production-only commits to read. Enough to draw and to name the first
 * one off the line; a repository further out than this needs fixing rather than
 * an exact count.
 */
const MaxProductionOnlyCommits = 50

/** Shipped tags drawn on the production lane. */
const RecentTagCount = 8

/**
 * The ref to measure a shared branch by: its remote counterpart when it has one.
 *
 * The question is whether the team's branches are in line, not whether this
 * working copy has pulled lately.
 */
function sharedRef(branch: Branch): string {
  return branch.upstream ?? branch.name
}

/**
 * Whether production is in line with integration.
 *
 * What is on production but not integration puts it out of line. Whether that
 * leaves anything missing is a separate question, and only a simulated merge of
 * production back into integration answers it. Counting commits doesn't:
 *
 * - AmadeusWebApi from 1.2026.24 had only merge commits off the line, and
 *   nothing missing.
 * - DataSources, Nexus and HOTBrain-v2 have non-merge commits off the line, but
 *   they are squashes or cherry-picks of work develop already has. Merging back
 *   changes nothing there either.
 * - HOTWebsites and NimbleObt would conflict, so work really is stranded.
 *
 * When the merge can't be simulated, a non-merge commit is treated as stranded,
 * because overstating a gap costs less than hiding one.
 *
 * Exported for tests.
 */
export function classifyAlignment(
  productionOnly: ReadonlyArray<Commit>,
  mergeBack: IMergeSimulation | null
): BranchAlignmentStatus {
  if (productionOnly.length === 0) {
    return 'aligned'
  }

  if (mergeBack === null) {
    return productionOnly.some(c => !c.isMergeCommit)
      ? 'stranded'
      : 'out-of-line'
  }

  return mergeBack.outcome === 'no-change' ? 'out-of-line' : 'stranded'
}

/**
 * The recent shipped tags, oldest first, each marked by whether integration
 * contains it.
 *
 * Production's tags are each other's ancestors, so once integration contains
 * one it contains every one before it. The marks therefore run aligned, then
 * unaligned, and the boundary is where things went wrong.
 *
 * Exported for tests.
 */
export function markTags(
  releaseHistory: ReadonlyArray<IShippedRelease>,
  integrationTags: ReadonlySet<string>
): {
  readonly recentTags: ReadonlyArray<IAlignmentTag>
  readonly lastAlignedTag: string | null
  readonly firstUnalignedTag: string | null
} {
  // The history arrives newest first.
  const marked = releaseHistory.map(r => ({
    name: r.tagName,
    inIntegration: integrationTags.has(r.tagName),
  }))

  const lastAligned = marked.find(t => t.inIntegration) ?? null

  // The oldest unaligned tag is the last one before the newest aligned tag, or
  // the oldest in the window when none is aligned.
  const lastAlignedIndex =
    lastAligned === null ? marked.length : marked.indexOf(lastAligned)
  const firstUnaligned =
    lastAlignedIndex > 0 ? marked[lastAlignedIndex - 1] : null

  return {
    recentTags: marked.slice(0, RecentTagCount).reverse(),
    lastAlignedTag: lastAligned?.name ?? null,
    firstUnalignedTag: firstUnaligned?.name ?? null,
  }
}

/**
 * The commands that bring integration back in line with production.
 *
 * Merging production into integration records the missing merge commits in
 * integration's history. When nothing is stranded it changes no files, and from
 * then on production can fast-forward again.
 */
export function alignmentFixCommands(
  integrationName: string,
  productionName: string
): ReadonlyArray<string> {
  return [
    `git fetch origin`,
    `git checkout ${integrationName}`,
    `git pull origin ${integrationName}`,
    `git merge origin/${productionName}`,
    `git push origin ${integrationName}`,
  ]
}

/**
 * Reads how production, the current release and integration line up.
 *
 * Read-only, and cheap: one bounded `git log`, one `git diff --quiet` that stops
 * at the first difference, and one tag query, plus two for the release.
 */
export async function detectBranchAlignment(
  provider: IRepositoryProvider,
  integrationBranch: Branch,
  productionBranch: Branch,
  releaseBranch: Branch | null,
  releaseHistory: ReadonlyArray<IShippedRelease>
): Promise<IBranchAlignment | null> {
  const integrationRef = sharedRef(integrationBranch)
  const productionRef = sharedRef(productionBranch)

  try {
    const [productionOnly, integrationTags, release] = await Promise.all([
      provider.getCommitRange(
        integrationRef,
        productionRef,
        MaxProductionOnlyCommits
      ),
      provider.getMergedTags(integrationRef),
      releaseBranch === null
        ? Promise.resolve(null)
        : detectReleaseAlignment(
            provider,
            releaseBranch,
            integrationRef,
            productionRef
          ),
    ])

    // Only asked when there is a split to look at. In line, merging back is a
    // fast-forward and there is nothing to simulate.
    const mergeBack =
      productionOnly.length === 0
        ? null
        : await provider.simulateMerge(integrationRef, productionRef)

    return {
      status: classifyAlignment(productionOnly, mergeBack),
      productionOnlyCommits: productionOnly,
      productionOnlyCapped: productionOnly.length >= MaxProductionOnlyCommits,
      strandedCommits: productionOnly.filter(c => !c.isMergeCommit),
      mergeBack,
      ...markTags(releaseHistory, new Set(integrationTags.map(t => t.name))),
      release,
    }
  } catch {
    // An unreadable alignment shouldn't take the rest of the view with it. The
    // tab says it couldn't tell rather than claiming the branches are fine.
    return null
  }
}

async function detectReleaseAlignment(
  provider: IRepositoryProvider,
  releaseBranch: Branch,
  integrationRef: string,
  productionRef: string
): Promise<IReleaseAlignment> {
  const releaseRef = sharedRef(releaseBranch)

  const [productionNotInRelease, releaseNotInIntegration, drift] =
    await Promise.all([
      provider.getCommitRange(releaseRef, productionRef, 1),
      provider.getCommitRange(integrationRef, releaseRef, 200),
      provider.getAheadBehind(releaseRef, integrationRef),
    ])

  return {
    branchName: releaseBranch.nameWithoutRemote,
    containsProduction: productionNotInRelease.length === 0,
    behindIntegration: drift?.behind ?? 0,
    notInIntegrationCount: releaseNotInIntegration.filter(c => !c.isMergeCommit)
      .length,
  }
}
