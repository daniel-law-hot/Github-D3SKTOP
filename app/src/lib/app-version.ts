import { gt as semverGt, valid as semverValid } from 'semver'

/**
 * Version ordering for the fork's own releases.
 *
 * Upstream compares release tags with plain semver, which allows exactly three
 * numeric segments. That's the whole scheme for `desktop/desktop`, but it means a
 * fork wanting `major.minor.patch.build` has nowhere to put the build number:
 * `1.2026.12.2` fails `semver.valid()` outright, and `1.2026.12+build.2` passes but
 * compares *equal* to `1.2026.12`, because semver ignores build metadata when
 * ordering. Either way an installed app is told there's nothing newer.
 *
 * So this accepts up to four numeric segments and compares them left to right,
 * treating a missing segment as zero — which is what makes `1.2026.12.2` newer than
 * `1.2026.12` rather than malformed.
 *
 * Semver is still used whenever both versions are valid semver, so three-segment
 * comparisons behave exactly as they always did, and prerelease tags (`-beta.1`,
 * `-test.3`) keep their semver meaning of sorting *below* the release they precede.
 * The numeric path only takes over for the shapes semver can't express.
 *
 * The one-way constraint worth remembering: a build already installed compares
 * versions with *its own* copy of this code. Four-segment tags are therefore only
 * safe to publish once the installed base is on a build that ships this — which is
 * why 1.2026.12 is three-segment and the four-segment tags start after it.
 */

/** Up to four dot-separated numbers and nothing else. */
const numericVersionRegex = /^\d+(\.\d+){0,3}$/

/** Strips a leading `v`, so both `v1.2026.12` and `1.2026.12` are accepted. */
export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, '')
}

/**
 * Whether a string is a version this app can order against its own.
 *
 * Deliberately broader than `semver.valid()` — see the note above — but no less
 * strict about what it rejects. Anything that isn't numeric segments or valid
 * semver is refused, so a release tagged `latest` or `2026-08-01-hotfix` is treated
 * as unusable rather than silently sorted somewhere arbitrary.
 */
export function isComparableVersion(version: string): boolean {
  const stripped = stripVersionPrefix(version)

  return numericVersionRegex.test(stripped) || semverValid(stripped) !== null
}

/** Splits a numeric version into segments, padded to four with zeros. */
function toSegments(version: string): ReadonlyArray<number> {
  const parts = stripVersionPrefix(version).split('.').map(Number)

  return [0, 1, 2, 3].map(i => parts[i] ?? 0)
}

/**
 * Whether `candidate` is a newer version than `current`.
 *
 * Returns false when either side can't be ordered, so an unusable tag never
 * triggers an update. Callers wanting to *report* a bad tag should check
 * `isComparableVersion` first — this only answers the ordering question.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = stripVersionPrefix(candidate)
  const b = stripVersionPrefix(current)

  if (!isComparableVersion(a) || !isComparableVersion(b)) {
    return false
  }

  // Both plain semver: defer to it, so prereleases and existing three-segment
  // behaviour are untouched.
  if (semverValid(a) !== null && semverValid(b) !== null) {
    return semverGt(a, b)
  }

  // At least one side is a shape semver can't express — a four-segment build.
  // Anything with a prerelease or metadata suffix isn't purely numeric, so it
  // can't reach here alongside a four-segment version; comparing segments is safe.
  if (!numericVersionRegex.test(a) || !numericVersionRegex.test(b)) {
    return false
  }

  const left = toSegments(a)
  const right = toSegments(b)

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return left[i] > right[i]
    }
  }

  return false
}
