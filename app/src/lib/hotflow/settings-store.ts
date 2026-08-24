import { Repository } from '../../models/repository'
import { IHotFlowBranchOverride } from '../../models/hotflow'
import { getObject, setObject } from '../local-storage'
import { parseReleaseSequence } from './release-sequence'

/**
 * Per-repository HotFlow settings.
 *
 * Two kinds of thing live here, both of which are corrections to a guess:
 *
 *  - **Release sequence overrides.** HotFlow derives the Azure DevOps release
 *    sequence number from the version — `1.2026.17` gives 202617 — which is right
 *    wherever the version's cycle segment is the calendar cycle. A repository that
 *    numbers releases independently needs a way to say so.
 *  - **Branch overrides.** Integration and production branches are resolved from
 *    a list of known aliases, which covers every repository surveyed — but a
 *    deviant repo needs a way to say so without a code change.
 *
 * Keyed on the working tree path rather than `repository.hash`: the hash folds in
 * the alias, id and missing flag, so it changes when a repository is renamed or
 * goes missing and returns, which would silently discard these corrections.
 * Lower-cased because Windows paths are case-insensitive.
 */

const storageKeyPrefix = 'hotflow-settings'

interface IStoredSettings {
  /**
   * Release branch name -> release sequence number.
   *
   * Still called `cycles` so values written by the old confirm-the-cycle step
   * carry over. They held the same six-digit number as a string, and the reader
   * below accepts both — renaming the key would have thrown them away for nothing.
   */
  readonly cycles?: Record<string, string | number | null>
  readonly integrationBranch?: string
  readonly productionBranch?: string

  /** The merge method last used for a pull request in this repository. */
  readonly mergeMethod?: string

  /**
   * Whether to stop looking for work items assigned to a release but absent from
   * it. Absent means no, which keeps the check on for every repository that has
   * never said otherwise.
   */
  readonly suppressAssignedNotMerged?: boolean

  /**
   * Whether the assign dialog's override box was left ticked.
   *
   * Remembered because the answer is a property of how someone works rather than
   * of one release: a person who reassigns work items across cycles does it every
   * cycle, and a person who never would should not have to untick it every time.
   * Absent means off, which is the safe reading for a box that overwrites data.
   */
  readonly overwriteReleaseSequence?: boolean
}

function storageKey(repository: Repository): string {
  return `${storageKeyPrefix}-${repository.path.toLowerCase()}`
}

function read(repository: Repository): IStoredSettings {
  return getObject<IStoredSettings>(storageKey(repository)) ?? {}
}

function write(repository: Repository, settings: IStoredSettings): void {
  setObject(storageKey(repository), settings)
}

// ── release sequence overrides ────────────────────────────────────────────────

/**
 * Reads the release sequence overrides for a repository.
 *
 * Accepts numbers and the strings the old confirm-the-cycle step wrote, so those
 * values keep working. Entries that don't parse as a sequence number are dropped
 * rather than trusted — a corrupt or hand-edited value shouldn't drive
 * reconciliation.
 */
export function getReleaseSequenceOverrides(
  repository: Repository
): ReadonlyMap<string, number | null> {
  const stored = read(repository).cycles

  if (stored === undefined) {
    return new Map<string, number | null>()
  }

  const overrides = new Map<string, number | null>()

  for (const [branch, value] of Object.entries(stored)) {
    if (typeof branch !== 'string' || branch.length === 0) {
      continue
    }

    // A stored null is someone saying this release has no sequence number at
    // all, which is not the same as never having said anything: the second falls
    // back to what the version gives, and this must not. Repositories that don't
    // follow the Content Orchestration cycle have nothing to reconcile against,
    // and inventing a number for them produces a list of imaginary omissions.
    if (value === null) {
      overrides.set(branch, null)
      continue
    }

    const parsed = parseReleaseSequence(value)

    if (parsed !== null) {
      overrides.set(branch, formatSequence(parsed))
    }
  }

  return overrides
}

function formatSequence({
  year,
  cycle,
}: {
  year: number
  cycle: number
}): number {
  return year * 100 + cycle
}

/**
 * Records a release sequence override for a branch. Returns false without storing
 * anything when the value isn't a plausible `{year}{cycle:00}` number.
 */
export function setReleaseSequenceOverride(
  repository: Repository,
  branchName: string,
  releaseSequence: number
): boolean {
  if (parseReleaseSequence(releaseSequence) === null) {
    return false
  }

  const settings = read(repository)
  const cycles = { ...(settings.cycles ?? {}), [branchName]: releaseSequence }

  write(repository, { ...settings, cycles })

  return true
}

/**
 * Records that a release has no sequence number at all.
 *
 * Distinct from `clearReleaseSequenceOverride`, which forgets the correction and
 * goes back to deriving one from the version. This says there is nothing to
 * derive — the release doesn't take part in the Content Orchestration cycle, so
 * there is no plan in Azure DevOps to reconcile it against.
 */
export function setReleaseSequenceCleared(
  repository: Repository,
  branchName: string
): void {
  const settings = read(repository)
  const cycles = { ...(settings.cycles ?? {}), [branchName]: null }

  write(repository, { ...settings, cycles })
}

/**
 * Whether this repository has asked not to be told about work items assigned to
 * a release but missing from it.
 */
export function getSuppressAssignedNotMerged(repository: Repository): boolean {
  return read(repository).suppressAssignedNotMerged === true
}

/** Records that preference. */
export function setSuppressAssignedNotMerged(
  repository: Repository,
  suppress: boolean
): void {
  write(repository, {
    ...read(repository),
    suppressAssignedNotMerged: suppress,
  })
}

/**
 * Whether the assign dialog should overwrite a sequence number already set.
 *
 * Per repository, like everything else here — a repository that follows the cycle
 * and one that doesn't call for different answers, and they are used side by side.
 */
export function getOverwriteReleaseSequence(repository: Repository): boolean {
  return read(repository).overwriteReleaseSequence === true
}

/** Records that choice, so the box comes back the way it was left. */
export function setOverwriteReleaseSequence(
  repository: Repository,
  overwrite: boolean
): void {
  write(repository, {
    ...read(repository),
    overwriteReleaseSequence: overwrite,
  })
}

/** Forgets the override for a branch, returning it to the derived number. */
export function clearReleaseSequenceOverride(
  repository: Repository,
  branchName: string
): void {
  const settings = read(repository)
  const cycles = { ...(settings.cycles ?? {}) }
  delete cycles[branchName]

  write(repository, { ...settings, cycles })
}

// ── branch overrides ─────────────────────────────────────────────────

/** Reads the pinned integration/production branches, if any. */
export function getBranchOverride(
  repository: Repository
): IHotFlowBranchOverride {
  const { integrationBranch, productionBranch } = read(repository)

  return {
    integrationBranch:
      typeof integrationBranch === 'string' && integrationBranch.length > 0
        ? integrationBranch
        : undefined,
    productionBranch:
      typeof productionBranch === 'string' && productionBranch.length > 0
        ? productionBranch
        : undefined,
  }
}

// ── merge method ─────────────────────────────────────────────────────────────

/** The merge strategies GitHub offers. */
export type StoredMergeMethod = 'merge' | 'squash' | 'rebase'

const defaultMergeMethod: StoredMergeMethod = 'merge'

/**
 * The merge method last used in this repository, defaulting to a merge commit.
 *
 * Remembered per repository rather than globally, since different repositories
 * reasonably want different strategies.
 */
export function getMergeMethod(repository: Repository): StoredMergeMethod {
  const stored = read(repository).mergeMethod

  return stored === 'merge' || stored === 'squash' || stored === 'rebase'
    ? stored
    : defaultMergeMethod
}

export function setMergeMethod(
  repository: Repository,
  mergeMethod: StoredMergeMethod
): void {
  write(repository, { ...read(repository), mergeMethod })
}

/**
 * Pins the branches HotFlow should use for this repository.
 *
 * Passing an empty string or undefined for either clears that override and
 * returns it to alias resolution.
 */
export function setBranchOverride(
  repository: Repository,
  override: IHotFlowBranchOverride
): void {
  const settings = read(repository)

  write(repository, {
    ...settings,
    integrationBranch:
      override.integrationBranch !== undefined &&
      override.integrationBranch.length > 0
        ? override.integrationBranch
        : undefined,
    productionBranch:
      override.productionBranch !== undefined &&
      override.productionBranch.length > 0
        ? override.productionBranch
        : undefined,
  })
}
