import { IReleaseSequence, IReleaseVersion } from '../../models/hotflow'

/**
 * The Azure DevOps release sequence number.
 *
 * House of Travel's work items carry a "Release sequence number" field holding
 * `{year}{cycle:00}` — 202617 for cycle 17 of 2026. (Not a tag: work item tags
 * hold things like "CO Flights; Content Orchestration" and never the release.)
 * It's the only input to the query that finds a release's work items, so getting
 * it right decides whether "assigned but not merged" means anything.
 *
 * A release version already contains it: `1.2026.17` gives 202617. That holds
 * wherever the version's cycle segment is the calendar cycle, which is the
 * convention here — but nothing in git can confirm it, and a repository could
 * number its releases independently. So HotFlow derives the number, shows it
 * plainly, and lets it be changed by clicking it. No confirmation step: the number
 * is on screen, which is disclosure enough, and a ceremony that's correct 99% of
 * the time teaches people to click through it.
 */

/** The smallest and largest values that encode a plausible year and cycle. */
const MinSequence = 200001
const MaxSequence = 210053

/** Builds a sequence number from a year and cycle, e.g. (2026, 17) -> 202617. */
export function formatReleaseSequence(year: number, cycle: number): number {
  return year * 100 + cycle
}

/**
 * Splits a sequence number back into its year and cycle, or null if it isn't one.
 *
 * Used to validate what someone types into the override field, so a typo can't
 * silently produce a query that matches nothing.
 */
export function parseReleaseSequence(
  value: number | string
): { year: number; cycle: number } | null {
  const numeric =
    typeof value === 'number'
      ? value
      : /^\d{6}$/.test(value.trim())
      ? parseInt(value.trim(), 10)
      : NaN

  if (!Number.isInteger(numeric) || numeric < MinSequence) {
    return null
  }

  const year = Math.floor(numeric / 100)
  const cycle = numeric % 100

  if (year < 2000 || year > 2100 || cycle < 1 || cycle > 53) {
    return null
  }

  return { year, cycle }
}

/** True when a value is a usable release sequence number. */
export function isValidReleaseSequence(value: number | string): boolean {
  return parseReleaseSequence(value) !== null
}

/**
 * Derives the sequence number from a release version, or null when the version
 * doesn't carry a plausible year and cycle to build one from.
 */
export function deriveReleaseSequence(version: IReleaseVersion): number | null {
  const { year, cycleSegment } = version

  if (year === null || cycleSegment === null) {
    return null
  }

  const derived = formatReleaseSequence(year, cycleSegment)

  return derived > MaxSequence || parseReleaseSequence(derived) === null
    ? null
    : derived
}

/**
 * Resolves the sequence number for a release branch: the stored override if there
 * is one, otherwise what the version gives.
 *
 * `isOverridden` compares the stored value against the derived one rather than
 * just noting that something was stored. Storing the number the version already
 * gives isn't an override and shouldn't be flagged as one — which also means the
 * values carried over from the old confirm-the-cycle step read correctly, since
 * confirming only ever recorded the derived number.
 *
 * @param branchName  The release branch, used as the key for stored overrides.
 * @param version     The parsed version, which the derivation reads.
 * @param overrides   Stored branch-name -> sequence-number overrides.
 */
export function resolveReleaseSequence(
  branchName: string,
  version: IReleaseVersion,
  overrides: ReadonlyMap<string, number> | undefined
): IReleaseSequence | null {
  const derived = deriveReleaseSequence(version)
  const stored = overrides?.get(branchName)

  if (stored !== undefined && parseReleaseSequence(stored) !== null) {
    return { value: stored, isOverridden: stored !== derived }
  }

  return derived === null ? null : { value: derived, isOverridden: false }
}
