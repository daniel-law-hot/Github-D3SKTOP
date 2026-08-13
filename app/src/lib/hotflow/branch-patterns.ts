import { Commit } from '../../models/commit'
import { IReleaseVersion } from '../../models/hotflow'
import { parseReleaseVersion } from './version'

/**
 * Recognises a feature or hotfix branch and pulls out its VSO number.
 *
 * Deliberately permissive: anything after `feature/{digits}-` counts. Real
 * branches in the House of Travel repositories are full of capitals
 * (`feature/86270-Add-missing-hotel-RQ-validation`), and a branch that doesn't
 * follow the house style is still a feature branch carrying a VSO — refusing to
 * recognise it just makes HotFlow blind to real work.
 *
 * `hotfix/` counts on the same terms. A hotfix carries a VSO and is work in
 * flight like any other; leaving it out would drop it from the diagram and
 * leave its work item unattributed, which is exactly the moment you'd want to
 * be able to see it.
 */
export const featureBranchRegex = /^(?:feature|hotfix)\/(\d+)-(.+)$/i

/**
 * The *recommended* format — lower-kebab-case only.
 *
 * Used solely to nudge people when creating a branch. Detection must never use
 * this, or work already in flight under a different style becomes invisible.
 */
const recommendedFeatureBranchRegex =
  /^(?:feature|hotfix)\/\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Release branches: `release/{version}`, e.g. `release/1.2026.9`. */
const releaseBranchRegex = /^release\/(.+)$/

/** Strips a leading `origin/` (or any remote) so both branch types compare. */
function withoutRemotePrefix(name: string): string {
  const match = name.match(/^[^/]+\/(release\/.+|feature\/.+|hotfix\/.+)$/)
  return match ? match[1] : name
}

/**
 * What Start feature is being asked to cut.
 *
 * A feature and a hotfix are named the same way and differ only in where they
 * start; a release is named from a version and has no description at all.
 */
export type StartBranchKind = 'feature' | 'hotfix' | 'release'

export interface IParsedFeatureBranch {
  readonly vso: number
  readonly slug: string
}

/** Parses a feature branch name, or null if it doesn't match the convention. */
export function parseFeatureBranchName(
  name: string
): IParsedFeatureBranch | null {
  const match = withoutRemotePrefix(name).match(featureBranchRegex)

  if (match === null) {
    return null
  }

  return { vso: parseInt(match[1], 10), slug: match[2] }
}

/** True when a branch name is a feature branch, whatever its style. */
export function isFeatureBranchName(name: string): boolean {
  return parseFeatureBranchName(name) !== null
}

/**
 * True when a branch name follows the recommended lower-kebab-case style.
 *
 * Only for the create-branch nudge. Anything that answers `isFeatureBranchName`
 * is treated as a feature branch regardless of what this returns.
 */
export function isRecommendedFeatureBranchName(name: string): boolean {
  return recommendedFeatureBranchRegex.test(withoutRemotePrefix(name))
}

/**
 * Parses a release branch name into its version, or null when the name isn't a
 * release branch or its version can't be ordered.
 */
export function parseReleaseBranchName(name: string): IReleaseVersion | null {
  const match = withoutRemotePrefix(name).match(releaseBranchRegex)

  if (match === null) {
    return null
  }

  return parseReleaseVersion(match[1])
}

/** True when a branch name looks like a release branch, parseable or not. */
export function isReleaseBranchName(name: string): boolean {
  return releaseBranchRegex.test(withoutRemotePrefix(name))
}

/**
 * Patterns that identify a VSO (Azure DevOps work item) reference.
 *
 * Deliberately conservative: a bare five-or-six digit number is NOT treated as a
 * VSO, because PR numbers, dates, and ticket-like strings in commit messages would
 * produce false positives and quietly inflate "what's in this release". Every
 * pattern here requires explicit context.
 *
 * Both surviving patterns mean something beyond a number being present. A feature
 * branch name is structural — it's how the merge got its subject. `AB#` is Azure
 * DevOps' own linking syntax, so writing it *is* the act of linking.
 *
 * A third pattern, `/VSO[\s-]?#?(\d+)/`, used to cover the hand-written form
 * (`VSO 100712`, `vso #100712`). It's gone, because "someone typed VSO near a
 * number" isn't a claim about this commit — prose discusses other people's work
 * items. A ContentOrchestration commit explaining a root cause ended with "…the
 * display fallbacks added for VSO 105730 in NimbleObt", and 105730 duly appeared in
 * ContentOrchestration's release, attributed to a repository the sentence was
 * pointing away from. The `[\s-]?` even matched the newline the line had wrapped on.
 */
const vsoPatterns: ReadonlyArray<RegExp> = [
  // A merged feature or hotfix branch name, as it appears in merge and squash
  // commits:
  //   Merge pull request #412 from HouseOfTravel/feature/100712-fix-login
  //   feature/100712-fix-login (#412)
  /(?:feature|hotfix)\/(\d+)-/gi,

  // Azure DevOps' own git linking convention.
  /AB#(\d+)/gi,
]

/**
 * Extracts VSO numbers from a block of text (a commit subject or body).
 *
 * Exported for direct testing; prefer `extractVsoNumbersFromCommits` for real
 * use so subject and body are both covered.
 */
export function extractVsoNumbers(text: string): ReadonlyArray<number> {
  if (text.length === 0) {
    return []
  }

  const found = new Set<number>()

  for (const pattern of vsoPatterns) {
    // Patterns are module-level and carry the global flag, so reset lastIndex
    // rather than relying on a fresh regex each call.
    pattern.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const vso = parseInt(match[1], 10)
      if (Number.isFinite(vso) && vso > 0) {
        found.add(vso)
      }
    }
  }

  return [...found]
}

/**
 * Extracts the distinct VSO numbers referenced by a set of commits, ascending.
 */
export function extractVsoNumbersFromCommits(
  commits: ReadonlyArray<Commit>
): ReadonlyArray<number> {
  const found = new Set<number>()

  for (const commit of commits) {
    for (const vso of extractVsoNumbers(commit.summary)) {
      found.add(vso)
    }
    if (commit.body.length > 0) {
      for (const vso of extractVsoNumbers(commit.body)) {
        found.add(vso)
      }
    }
  }

  return [...found].sort((a, b) => a - b)
}

/** Builds a feature branch name from a VSO number and free-text description. */
export function buildFeatureBranchName(
  vso: number,
  description: string
): string {
  return `feature/${vso}-${slugifyDescription(description)}`
}

/** The same, under `hotfix/`. */
export function buildHotfixBranchName(
  vso: number,
  description: string
): string {
  return `hotfix/${vso}-${slugifyDescription(description)}`
}

/**
 * Converts free text into the lower-kebab-case slug the convention expects.
 * Accents are stripped, punctuation dropped, and runs of separators collapsed.
 */
export function slugifyDescription(description: string): string {
  return description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Builds a release branch name from a version string. */
export function buildReleaseBranchName(version: string): string {
  return `release/${version.trim()}`
}
