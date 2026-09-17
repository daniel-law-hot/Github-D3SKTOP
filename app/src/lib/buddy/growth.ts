import { IBuddyStats } from '../../models/buddy'
import { MaxLevel } from './xp'

/** What a growing stat climbs towards, and never passes. */
export const StatCeiling = 100

/**
 * What a stat has grown to at a given level.
 *
 * The gap to a hundred closes in proportion to how far up the levels you are, so
 * a maxed buddy reaches a hundred whatever it rolled. The roll decides where you
 * start — and how quickly the early levels feel like progress — rather than where
 * you end up, which keeps a common buddy worth raising instead of a consolation
 * prize you are stuck with.
 */
export function grownStat(base: number, level: number): number {
  const clamped = Math.max(1, Math.min(MaxLevel, Math.floor(level)))
  const progress = (clamped - 1) / (MaxLevel - 1)

  return Math.min(StatCeiling, Math.round(base + (StatCeiling - base) * progress))
}

/**
 * The stats as they stand at a level.
 *
 * Focus, stamina and luck climb. Mischief does not, and that is the whole reason
 * it is left out: it decides what the buddy sounds like, and one that grew out of
 * its own voice would stop being the one you met. A placid companion stays
 * placid however far it gets.
 */
export function growStats(stats: IBuddyStats, level: number): IBuddyStats {
  return {
    focus: grownStat(stats.focus, level),
    stamina: grownStat(stats.stamina, level),
    luck: grownStat(stats.luck, level),
    mischief: stats.mischief,
  }
}

/** Which stats move, for anywhere that needs to say so. */
export const GrowingStats: ReadonlyArray<keyof IBuddyStats> = [
  'focus',
  'stamina',
  'luck',
]
