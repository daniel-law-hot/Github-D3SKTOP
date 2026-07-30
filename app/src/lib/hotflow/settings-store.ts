import { Repository } from '../../models/repository'
import { IHotFlowBranchOverride } from '../../models/hotflow'
import { getObject, setObject } from '../local-storage'
import { parseCycleTag } from './cycle'

/**
 * Per-repository HotFlow settings.
 *
 * Two kinds of thing live here, both of which are corrections to a guess:
 *
 *  - **Confirmed release cycles.** HotFlow infers the Azure DevOps cycle from the
 *    trailing segment of a release version, but that convention varies by repo,
 *    so the inference has to be confirmable and the confirmation has to stick.
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
  /** Release branch name -> ADO cycle tag. */
  readonly cycles?: Record<string, string>
  readonly integrationBranch?: string
  readonly productionBranch?: string
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

// ── release cycles ───────────────────────────────────────────────────

/**
 * Reads the confirmed cycle tags for a repository.
 *
 * Entries which no longer parse as a cycle tag are dropped rather than trusted —
 * a corrupt or hand-edited value shouldn't drive reconciliation.
 */
export function getConfirmedReleaseCycles(
  repository: Repository
): ReadonlyMap<string, string> {
  const cycles = read(repository).cycles

  if (cycles === undefined) {
    return new Map<string, string>()
  }

  return new Map(
    Object.entries(cycles).filter(
      ([branch, tag]) =>
        typeof branch === 'string' &&
        typeof tag === 'string' &&
        parseCycleTag(tag) !== null
    )
  )
}

/**
 * Records the confirmed cycle tag for a release branch. Returns false without
 * storing anything when the tag isn't a valid `{year}{cycle:00}` value.
 */
export function setConfirmedReleaseCycle(
  repository: Repository,
  branchName: string,
  cycleTag: string
): boolean {
  if (parseCycleTag(cycleTag) === null) {
    return false
  }

  const settings = read(repository)
  const cycles = { ...(settings.cycles ?? {}), [branchName]: cycleTag }

  write(repository, { ...settings, cycles })

  return true
}

/** Forgets the confirmed cycle for a branch, reverting it to a guess. */
export function clearConfirmedReleaseCycle(
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
