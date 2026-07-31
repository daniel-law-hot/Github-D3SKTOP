import { Branch } from '../../models/branch'
import { IHotFlowState, IReleaseBranchState } from '../../models/hotflow'
import { Repository } from '../../models/repository'
import { getStatus } from '../git/status'
import { getAllTags } from '../git/tag'
import { getMergeBase } from '../git/merge'
import { getAheadBehind, revSymmetricDifference } from '../git/rev-list'

/**
 * Pre-flight checks for the HotFlow actions.
 *
 * Every action shows its checks before it runs. Blocking checks disable the
 * confirm button; warnings are shown but let you proceed. The point is that you
 * can see *why* an operation is safe rather than trusting that it is.
 *
 * Branch names are always taken from the resolved state, never assumed — repos
 * disagree about whether integration is `develop`, `development` or `dev`.
 */

export interface IPreflightCheck {
  /** Stable id, so the UI can key rows without relying on the label. */
  readonly id: string

  /** What was checked, in plain language. */
  readonly label: string

  readonly status: 'pass' | 'warn' | 'fail'

  /** Shown under the label when there's something to explain. */
  readonly detail?: string

  /** Blocking failures prevent the action entirely. */
  readonly blocking: boolean
}

export interface IPreflightResult {
  readonly checks: ReadonlyArray<IPreflightCheck>

  /** True when nothing blocking failed. */
  readonly canProceed: boolean
}

function summarise(checks: ReadonlyArray<IPreflightCheck>): IPreflightResult {
  return {
    checks,
    canProceed: !checks.some(c => c.status === 'fail' && c.blocking),
  }
}

/** True when the working directory has no changes. */
async function isWorkingTreeClean(repository: Repository): Promise<boolean> {
  const status = await getStatus(repository)

  // A null status means git couldn't tell us; treat that as not-clean rather
  // than assuming the best.
  return status !== null && status.workingDirectory.files.length === 0
}

/**
 * Checks for starting a feature or release branch off the integration branch.
 */
export async function preflightStartBranch(
  repository: Repository,
  hotFlowState: IHotFlowState,
  branchName: string,
  existingBranches: ReadonlyArray<Branch>
): Promise<IPreflightResult> {
  const checks: Array<IPreflightCheck> = []
  const integrationName = hotFlowState.integrationBranchName

  const clean = await isWorkingTreeClean(repository)
  checks.push({
    id: 'clean-tree',
    label: 'Working directory is clean',
    status: clean ? 'pass' : 'warn',
    detail: clean
      ? undefined
      : 'Uncommitted changes will be carried onto the new branch.',
    blocking: false,
  })

  const hasIntegration = hotFlowState.integrationBranch !== null
  checks.push({
    id: 'integration-exists',
    label: `${integrationName} exists`,
    status: hasIntegration ? 'pass' : 'fail',
    detail: hasIntegration
      ? undefined
      : `HotFlow branches from ${integrationName}, which this repository doesn't have.`,
    blocking: true,
  })

  const nameTaken = existingBranches.some(
    b => b.nameWithoutRemote === branchName
  )
  checks.push({
    id: 'name-available',
    label: 'Branch name is available',
    status: nameTaken ? 'fail' : 'pass',
    detail: nameTaken
      ? `A branch named ${branchName} already exists.`
      : undefined,
    blocking: true,
  })

  return summarise(checks)
}

/** Additional check for starting a release: the tag mustn't already exist. */
export async function preflightStartRelease(
  repository: Repository,
  hotFlowState: IHotFlowState,
  version: string,
  branchName: string,
  existingBranches: ReadonlyArray<Branch>
): Promise<IPreflightResult> {
  const base = await preflightStartBranch(
    repository,
    hotFlowState,
    branchName,
    existingBranches
  )

  const tags = await getAllTags(repository)
  const tagExists = tags.has(version)

  const checks = [
    ...base.checks,
    {
      id: 'tag-available',
      label: `No existing tag ${version}`,
      status: tagExists ? ('fail' as const) : ('pass' as const),
      detail: tagExists
        ? `${version} has already shipped. Pick a version that hasn't been tagged.`
        : undefined,
      blocking: true,
    },
  ]

  return summarise(checks)
}

/**
 * Checks for merging the integration branch into the current release branch.
 */
export async function preflightUpdateRelease(
  repository: Repository,
  release: IReleaseBranchState,
  integrationBranch: Branch
): Promise<IPreflightResult> {
  const checks: Array<IPreflightCheck> = []
  const integrationName = integrationBranch.nameWithoutRemote

  const clean = await isWorkingTreeClean(repository)
  checks.push({
    id: 'clean-tree',
    label: 'Working directory is clean',
    status: clean ? 'pass' : 'fail',
    detail: clean ? undefined : 'Commit or stash your changes before merging.',
    blocking: true,
  })

  const hasWork = release.behindIntegration > 0
  checks.push({
    id: 'has-drift',
    label: `Behind ${integrationName}`,
    status: hasWork ? 'pass' : 'warn',
    detail: hasWork
      ? `${release.behindIntegration} commits will be merged in.`
      : 'This release is already up to date — there is nothing to merge.',
    blocking: false,
  })

  // A merge base tells us the two branches are actually related. Without one, a
  // merge would produce something nobody wants.
  const mergeBase = await getMergeBase(
    repository,
    release.branch.name,
    integrationBranch.name
  )

  checks.push({
    id: 'related',
    label: 'Branches share history',
    status: mergeBase === null ? 'fail' : 'pass',
    detail:
      mergeBase === null
        ? `${release.branch.name} and ${integrationBranch.name} have no common ancestor.`
        : undefined,
    blocking: true,
  })

  return summarise(checks)
}

/**
 * Checks for the one action that writes to production.
 *
 * This is deliberately the strictest set in HotFlow: it merges into the
 * production branch, creates a tag other people depend on, and pushes both.
 */
export async function preflightFinishRelease(
  repository: Repository,
  release: IReleaseBranchState,
  productionBranch: Branch,
  integrationName: string,
  missingWorkItemCount: number
): Promise<IPreflightResult> {
  const checks: Array<IPreflightCheck> = []
  const productionName = productionBranch.nameWithoutRemote

  const clean = await isWorkingTreeClean(repository)
  checks.push({
    id: 'clean-tree',
    label: 'Working directory is clean',
    status: clean ? 'pass' : 'fail',
    detail: clean ? undefined : 'Commit or stash your changes first.',
    blocking: true,
  })

  // Shipping a release that's behind integration means shipping stale code.
  const isBehind = release.behindIntegration > 0
  checks.push({
    id: 'not-behind',
    label: `Not behind ${integrationName}`,
    status: isBehind ? 'fail' : 'pass',
    detail: isBehind
      ? `${release.behindIntegration} commits are in ${integrationName} but not this release. Update it first, or override below.`
      : undefined,
    blocking: true,
  })

  // Local production must match its remote, or the merge lands on a stale base.
  const productionAheadBehind =
    productionBranch.upstream === null
      ? null
      : await getAheadBehind(
          repository,
          revSymmetricDifference(
            productionBranch.name,
            productionBranch.upstream
          )
        )

  const productionInSync =
    productionAheadBehind !== null &&
    productionAheadBehind.ahead === 0 &&
    productionAheadBehind.behind === 0

  checks.push({
    id: 'production-in-sync',
    label: `${productionName} matches its remote`,
    status: productionInSync ? 'pass' : 'fail',
    detail: productionInSync
      ? undefined
      : productionAheadBehind === null
      ? `${productionName} isn't tracking a remote branch.`
      : `${productionName} is ${productionAheadBehind.ahead} ahead and ${productionAheadBehind.behind} behind its remote. Fetch and reconcile first.`,
    blocking: true,
  })

  const tags = await getAllTags(repository)
  const tagExists = tags.has(release.version.raw)
  checks.push({
    id: 'tag-available',
    label: `No existing tag ${release.version.raw}`,
    status: tagExists ? 'fail' : 'pass',
    detail: tagExists
      ? `${release.version.raw} is already tagged. This release may have shipped already.`
      : undefined,
    blocking: true,
  })

  const hasSomethingToShip = release.aheadOfProduction > 0
  checks.push({
    id: 'has-commits',
    label: `Ahead of ${productionName}`,
    status: hasSomethingToShip ? 'pass' : 'fail',
    detail: hasSomethingToShip
      ? `${release.aheadOfProduction} commits will ship.`
      : `There is nothing in this release that isn't already in ${productionName}.`,
    blocking: true,
  })

  // Non-blocking, because only the person shipping knows whether the missing
  // items matter — but they must see it.
  if (missingWorkItemCount > 0) {
    checks.push({
      id: 'work-items-missing',
      label: 'Work items assigned to this release are missing',
      status: 'warn',
      detail: `${missingWorkItemCount} work items are assigned to this release but aren't in it.`,
      blocking: false,
    })
  }

  return summarise(checks)
}

/**
 * The exact git commands an action will run.
 *
 * Shown in the dialog and available to copy, because trust in a tool that writes
 * to the production branch comes from showing the work rather than hiding it.
 */
export function describeFinishReleaseCommands(
  release: IReleaseBranchState,
  productionName: string,
  integrationName: string,
  mergeBackIntoIntegration: boolean
): ReadonlyArray<string> {
  const releaseRef = release.branch.nameWithoutRemote
  const version = release.version.raw

  const commands = [
    `git checkout ${productionName}`,
    `git pull origin ${productionName}`,
    `git merge ${releaseRef} --no-ff`,
    `git tag -a -m "" ${version}`,
    `git push origin ${productionName} --follow-tags`,
  ]

  if (mergeBackIntoIntegration) {
    commands.push(
      `git checkout ${integrationName}`,
      `git merge ${releaseRef}`,
      `git push origin ${integrationName}`
    )
  }

  return commands
}

/** The commands for updating a release from the integration branch. */
export function describeUpdateReleaseCommands(
  release: IReleaseBranchState,
  integrationName: string
): ReadonlyArray<string> {
  return [
    `git fetch origin`,
    `git checkout ${release.branch.nameWithoutRemote}`,
    `git merge origin/${integrationName}`,
    `git push origin ${release.branch.nameWithoutRemote}`,
  ]
}

/** The commands for cutting a new branch off the integration branch. */
export function describeStartBranchCommands(
  branchName: string,
  integrationName: string
): ReadonlyArray<string> {
  return [
    `git fetch origin`,
    `git checkout -b ${branchName} origin/${integrationName}`,
  ]
}
