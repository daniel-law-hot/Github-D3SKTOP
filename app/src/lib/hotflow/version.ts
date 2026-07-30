import { IReleaseVersion } from '../../models/hotflow'

/**
 * Parses a release version string into comparable segments.
 *
 * House of Travel versions look like `1.2026.9` — major, year, and a trailing
 * number whose meaning varies by repo (see `cycle.ts`). We deliberately don't
 * assume semver: segments are compared numerically where possible and
 * lexically otherwise, so an unexpected format degrades rather than throws.
 *
 * Returns null only for input with no usable content at all.
 */
export function parseReleaseVersion(raw: string): IReleaseVersion | null {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return null
  }

  // Split on dots and dashes so `1.2026.9` and `1.2026.9-hotfix` both parse.
  const parts = trimmed.split(/[.\-]/).filter(p => p.length > 0)

  if (parts.length === 0) {
    return null
  }

  const segments = parts.map(p => (/^\d+$/.test(p) ? parseInt(p, 10) : null))

  // A version with no numeric segment at all isn't something we can order, and
  // ordering is the whole point — treat it as unparseable.
  if (segments.every(s => s === null)) {
    return null
  }

  const numeric = segments.filter((s): s is number => s !== null)

  // Look for a plausible four-digit year in any position. Most versions are
  // `<major>.<year>.<n>` but we don't require the year to be second.
  const yearIndex = segments.findIndex(
    s => s !== null && s >= 2000 && s <= 2100
  )
  const year = yearIndex === -1 ? null : segments[yearIndex]

  return {
    raw: trimmed,
    segments,
    year,
    cycleSegment: findCycleSegment(segments, yearIndex, numeric),
  }
}

/**
 * The segment that plausibly identifies the release cycle.
 *
 * Taken from immediately *after* the year rather than from the end of the
 * version, because hotfixes add a fourth segment: `1.2026.16.1` belongs to cycle
 * 16, not cycle 1. Reading the last segment would derive the wrong Azure DevOps
 * tag and make every work item look untagged.
 *
 * Falls back to the last numeric segment when there's no year to anchor on.
 */
function findCycleSegment(
  segments: ReadonlyArray<number | null>,
  yearIndex: number,
  numeric: ReadonlyArray<number>
): number | null {
  if (yearIndex !== -1) {
    const afterYear = segments[yearIndex + 1]
    return afterYear ?? null
  }

  if (numeric.length === 0) {
    return null
  }

  return numeric[numeric.length - 1]
}

/**
 * Compares two versions. Negative when `a` sorts first (older/lower).
 *
 * Numeric segments compare numerically. A non-numeric segment sorts after any
 * numeric one, so `1.2026.9` precedes `1.2026.rc`. Shorter versions sort before
 * longer ones with an identical prefix, so `1.2026` precedes `1.2026.1`.
 */
export function compareReleaseVersions(
  a: IReleaseVersion,
  b: IReleaseVersion
): number {
  const length = Math.max(a.segments.length, b.segments.length)

  for (let i = 0; i < length; i++) {
    const left = a.segments[i]
    const right = b.segments[i]

    // Ran out of segments on one side.
    if (left === undefined && right === undefined) {
      break
    }
    if (left === undefined) {
      return -1
    }
    if (right === undefined) {
      return 1
    }

    // Non-numeric sorts after numeric.
    if (left === null && right === null) {
      continue
    }
    if (left === null) {
      return 1
    }
    if (right === null) {
      return -1
    }

    if (left !== right) {
      return left < right ? -1 : 1
    }
  }

  // Identical segments — fall back to the raw string so sorting is stable and
  // total rather than leaving equal-looking-but-different versions unordered.
  return a.raw === b.raw ? 0 : a.raw < b.raw ? -1 : 1
}

/**
 * Increments the trailing numeric segment to suggest the next version.
 *
 * `1.2026.9` -> `1.2026.10`. Returns null when there's no trailing number to
 * increment, in which case the caller should ask rather than guess.
 */
export function suggestNextVersion(version: IReleaseVersion): string | null {
  const parts = version.raw.split(/([.\-])/)

  // Walk backwards to find the last purely-numeric part, preserving the
  // original separators so `1.2026.9` keeps its dots.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i])) {
      const incremented = (parseInt(parts[i], 10) + 1).toString()
      return [...parts.slice(0, i), incremented, ...parts.slice(i + 1)].join('')
    }
  }

  return null
}

/**
 * Formats a version for display. Currently the raw string — House of Travel
 * tags are bare versions with no `v` prefix, so there's nothing to normalize.
 */
export function formatReleaseVersion(version: IReleaseVersion): string {
  return version.raw
}
