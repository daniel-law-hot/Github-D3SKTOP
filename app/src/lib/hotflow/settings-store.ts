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
  readonly cycles?: Record<string, string | number>
  readonly integrationBranch?: string
  readonly productionBranch?: string

  /** The merge method last used for a pull request in this repository. */
  readonly mergeMethod?: string
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
): ReadonlyMap<string, number> {
  const stored = read(repository).cycles

  if (stored === undefined) {
    return new Map<string, number>()
  }

  const overrides = new Map<string, number>()

  for (const [branch, value] of Object.entries(stored)) {
    if (typeof branch !== 'string' || branch.length === 0) {
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
