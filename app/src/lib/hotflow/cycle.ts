import { IReleaseCycle, IReleaseVersion } from '../../models/hotflow'

/**
 * Cycle identification.
 *
 * House of Travel's ADO work items carry a "Release sequence number" field
 * holding `{year}{cycle:00}` — 202609 for cycle 9 of 2026. (Not a tag: work item
 * tags hold things like "CO Flights; Content Orchestration" and never the
 * release.) It is tempting to read that straight off a release version like
 * `1.2026.9` — and often that works — but the convention varies by repo: in
 * some, the trailing segment is a per-repo release counter that has nothing to
 * do with the calendar cycle.
 *
 * So HotFlow *guesses*, marks the guess unconfirmed, and asks. A guess is only
 * ever used to pre-fill; reconciliation built on an unconfirmed cycle is shown
 * as provisional so we never report "2 work items are missing" with false
 * confidence.
 */

/** Formats a year and cycle number as an ADO tag, e.g. (2026, 9) -> "202609". */
export function formatCycleTag(year: number, cycle: number): string {
  return `${year}${cycle.toString().padStart(2, '0')}`
}

/** Parses an ADO cycle tag back into its year and cycle number. */
export function parseCycleTag(
  tag: string
): { year: number; cycle: number } | null {
  const match = tag.trim().match(/^(\d{4})(\d{2})$/)

  if (match === null) {
    return null
  }

  const year = parseInt(match[1], 10)
  const cycle = parseInt(match[2], 10)

  if (year < 2000 || year > 2100 || cycle < 1 || cycle > 53) {
    return null
  }

  return { year, cycle }
}

/**
 * Infers a cycle from a release version, unconfirmed.
 *
 * Requires both a plausible year and a trailing number in range — otherwise
 * there's nothing worth pre-filling and we return null so the UI asks outright
 * rather than showing a nonsense guess.
 */
export function guessCycle(version: IReleaseVersion): IReleaseCycle | null {
  const { year, cycleSegment } = version

  if (year === null || cycleSegment === null) {
    return null
  }

  if (cycleSegment < 1 || cycleSegment > 53) {
    return null
  }

  return {
    tag: formatCycleTag(year, cycleSegment),
    cycle: cycleSegment,
    year,
    confirmed: false,
  }
}

/**
 * Resolves the cycle for a release branch: a previously confirmed value if the
 * user has set one, otherwise a fresh guess.
 *
 * @param branchName  The release branch, used as the key for stored overrides.
 * @param version     The parsed version, used to seed the guess.
 * @param confirmed   Stored branch-name -> cycle-tag overrides.
 */
export function resolveCycle(
  branchName: string,
  version: IReleaseVersion,
  confirmed: ReadonlyMap<string, string> | undefined
): IReleaseCycle | null {
  const stored = confirmed?.get(branchName)

  if (stored !== undefined) {
    const parsed = parseCycleTag(stored)
    if (parsed !== null) {
      return { ...parsed, tag: stored, confirmed: true }
    }
    // A stored value we can't parse is a bug or hand-edited state. Fall through
    // to the guess rather than trusting it.
  }

  return guessCycle(version)
}
