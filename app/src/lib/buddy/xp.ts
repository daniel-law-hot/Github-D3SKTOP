/**
 * The last level, and the one that unlocks polishing.
 *
 * Twenty rather than a hundred because every level has to feel like something.
 * A bar that moves a pixel a week is a bar nobody looks at twice.
 */
export const MaxLevel = 20

/** Every commit is worth something, even a one-line fix. */
export const CommitBaseXp = 8

/**
 * The most a single commit can be worth.
 *
 * Without it, one vendored dependency or one generated file finishes the whole
 * thing in an afternoon — and a reward for `node_modules` landing in a commit is
 * the wrong reward. A hundred and twelve changed lines earns as much as five
 * thousand do.
 */
export const MaxCommitXp = 120

/**
 * What a commit is worth, from the lines it touched.
 *
 * Added and deleted both count. Deleting four hundred lines of dead code is
 * work, frequently better work than adding them, and a scheme that only paid for
 * additions would be quietly arguing for the opposite.
 */
export function xpForCommit(linesChanged: number): number {
  return Math.min(CommitBaseXp + Math.max(0, linesChanged), MaxCommitXp)
}

/**
 * Total experience needed to reach a level.
 *
 * Quadratic, so the first few arrive quickly and the last few do not. Level 20
 * is 21,660 — around 360 ordinary commits, which at ten a week is the better
 * part of a year. That is the intent: a maxed buddy should mean somebody has
 * been here a long time, and there is no way to hurry it.
 */
export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MaxLevel, Math.floor(level)))

  return 60 * (clamped - 1) ** 2
}

/** The level a total belongs to. */
export function levelForXp(xp: number): number {
  for (let level = MaxLevel; level > 1; level--) {
    if (xp >= xpForLevel(level)) {
      return level
    }
  }

  return 1
}

export interface ILevelProgress {
  readonly level: number

  /** Experience earned since reaching this level. */
  readonly into: number

  /** Experience between this level and the next, or 0 at the top. */
  readonly needed: number

  /** 0 to 1, and 1 at the top so the bar reads as finished rather than empty. */
  readonly fraction: number

  readonly isMax: boolean
}

/** Where a total sits within its level, for the bar. */
export function levelProgress(xp: number): ILevelProgress {
  const level = levelForXp(xp)

  if (level >= MaxLevel) {
    return { level: MaxLevel, into: 0, needed: 0, fraction: 1, isMax: true }
  }

  const floor = xpForLevel(level)
  const ceiling = xpForLevel(level + 1)
  const needed = ceiling - floor
  const into = xp - floor

  return { level, into, needed, fraction: into / needed, isMax: false }
}
