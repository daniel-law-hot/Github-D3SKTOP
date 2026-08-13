import { IReleaseVersion, IWorkItem } from '../../models/hotflow'
import { formatReleaseSequence } from './release-sequence'

/**
 * A release cycle — the unit House of Travel actually ships.
 *
 * Cycle 18 of 2026 is not six releases; it is one release that happens to live
 * in six repositories, every one of them carrying `1.2026.18`. The per-repository
 * view can only ever show a sixth of that, which is why this exists.
 *
 * A cycle is a year and a number, never a version string. `work-item-scope.ts`
 * already spells out why: one Azure DevOps project spans forty-odd repositories
 * and the release sequence is per cycle, so `202618` is the same query wherever
 * you ask it from.
 */
export interface ICycleKey {
  readonly year: number
  readonly cycle: number
}

/** The Azure DevOps release sequence number for a cycle — 2026 and 18 give 202618. */
export function cycleSequence(key: ICycleKey): number {
  return formatReleaseSequence(key.year, key.cycle)
}

/** Renders a cycle the way people say it: `1.2026.18`. */
export function formatCycle(key: ICycleKey): string {
  return `1.${key.year}.${key.cycle}`
}

/** Two cycles are the same when both halves agree. */
export function isSameCycle(a: ICycleKey, b: ICycleKey): boolean {
  return a.year === b.year && a.cycle === b.cycle
}

/**
 * The cycle a release version belongs to, or null when it doesn't carry one.
 *
 * Reads `cycleSegment` rather than the last segment, which is what makes a hotfix
 * work: `1.2026.18.1` reports cycle 18, because the segment holding the cycle is
 * the one straight after the year. A hotfix ships in the cycle it patches.
 */
export function cycleOfVersion(version: IReleaseVersion): ICycleKey | null {
  const { year, cycleSegment } = version

  if (year === null || cycleSegment === null) {
    return null
  }

  return { year, cycle: cycleSegment }
}

/** True when a release version belongs to the given cycle. */
export function isVersionInCycle(
  version: IReleaseVersion,
  key: ICycleKey
): boolean {
  const versionCycle = cycleOfVersion(version)

  return versionCycle !== null && isSameCycle(versionCycle, key)
}

/**
 * Resolves what someone typed into the cycle box.
 *
 * Deliberately permissive about the shape, because every form below names the
 * same cycle and making people guess which one the box wants is a puzzle with no
 * prize:
 *
 *   `1.2026.18`   a release version, the form on branches and tags
 *   `1.2026.18.1` a hotfix version, which is still cycle 18
 *   `2026.18`     year and cycle, no leading major
 *   `202618`      the Azure DevOps release sequence number itself
 *
 * Strict about the values, though: a cycle outside 1–53 or a year outside
 * 2000–2100 is a typo rather than a search, and returning null lets the caller
 * say so instead of running a query that quietly matches nothing.
 */
export function parseCycleQuery(input: string): ICycleKey | null {
  const trimmed = input.trim()

  if (trimmed.length === 0) {
    return null
  }

  // A bare sequence number: 202618. Six digits, year then two-digit cycle.
  const sequence = trimmed.match(/^(\d{4})(\d{2})$/)

  if (sequence !== null) {
    return validate(parseInt(sequence[1], 10), parseInt(sequence[2], 10))
  }

  const segments = trimmed.split('.').filter(s => s.length > 0)

  if (segments.length < 2) {
    return null
  }

  // Find the four-digit year, then take the segment after it as the cycle. That
  // handles `1.2026.18` and `2026.18` with the same rule rather than two.
  const yearIndex = segments.findIndex(s => /^\d{4}$/.test(s))

  if (yearIndex === -1 || segments[yearIndex + 1] === undefined) {
    return null
  }

  const cycleSegment = segments[yearIndex + 1]

  if (!/^\d+$/.test(cycleSegment)) {
    return null
  }

  return validate(parseInt(segments[yearIndex], 10), parseInt(cycleSegment, 10))
}

function validate(year: number, cycle: number): ICycleKey | null {
  if (year < 2000 || year > 2100 || cycle < 1 || cycle > 53) {
    return null
  }

  return { year, cycle }
}

/**
 * Where an application stands relative to the cycle it was meant to ship in.
 *
 * The same three-way shape as `WorkItemPresence` in `reconcile.ts`, one level up:
 * that reconciles work items against a release branch, this reconciles
 * applications against a cycle.
 */
export type ApplicationPresence =
  /** A release record, and a release branch cut for it. The happy path. */
  | 'planned-and-cut'
  /** A release record with no release branch. Nobody cut it. */
  | 'not-cut'
  /** A release branch with no release record. Shipping unannounced. */
  | 'unplanned'

/** One row of the cycle table. */
export interface IReconciledApplication {
  /**
   * The repository this row is about.
   *
   * Null only for a release record nothing could be matched to — see
   * `resolveRepository` at the call site. A null here is shown as its own row
   * rather than being attached to whichever repository scored highest, because a
   * confidently wrong "not cut" is worse than an honest "couldn't tell".
   */
  readonly repositoryName: string | null

  /** The Azure DevOps release record, when the cycle's manifest holds one. */
  readonly releaseItem: IWorkItem | null

  readonly presence: ApplicationPresence
}

/** A release record already resolved to the repository it belongs to. */
export interface IManifestEntry {
  readonly releaseItem: IWorkItem
  readonly repositoryName: string | null
}

/**
 * Reconciles the cycle's manifest against what git actually has.
 *
 * The manifest is authoritative about what *should* ship — it comes from Azure
 * DevOps, where the cycle is decided — and git is authoritative about what
 * *has been cut*. Neither alone answers the question, and the interesting rows
 * are the ones where they disagree.
 *
 * Repository names are compared case-insensitively, because Azure DevOps and
 * GitHub disagree about capitalisation often enough that matching exactly would
 * invent "not cut" rows for applications that are perfectly fine.
 */
export function reconcileCycle(
  manifest: ReadonlyArray<IManifestEntry>,
  repositoriesWithRelease: ReadonlyArray<string>
): ReadonlyArray<IReconciledApplication> {
  const cutByKey = new Map(
    repositoriesWithRelease.map(name => [name.toLowerCase(), name])
  )

  const rows: Array<IReconciledApplication> = []
  const claimed = new Set<string>()

  for (const entry of manifest) {
    const key = entry.repositoryName?.toLowerCase()
    const cut = key === undefined ? undefined : cutByKey.get(key)

    if (cut !== undefined) {
      claimed.add(key!)
    }

    rows.push({
      // Prefer git's spelling of the name — it's the one the merge will use.
      repositoryName: cut ?? entry.repositoryName,
      releaseItem: entry.releaseItem,
      presence: cut === undefined ? 'not-cut' : 'planned-and-cut',
    })
  }

  // Anything cut that no release record claimed is shipping in this cycle
  // without Azure DevOps knowing about it.
  for (const [key, name] of cutByKey) {
    if (!claimed.has(key)) {
      rows.push({
        repositoryName: name,
        releaseItem: null,
        presence: 'unplanned',
      })
    }
  }

  return rows
}
