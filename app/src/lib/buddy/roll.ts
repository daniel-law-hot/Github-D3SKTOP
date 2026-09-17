import { BuddyRarity, IBuddy, IBuddyStats } from '../../models/buddy'

/**
 * A small deterministic generator, so a seed always produces the same buddy.
 *
 * `Math.random` would do for rolling one, but then a buddy could only exist as
 * the record written at the moment it appeared. Being able to rebuild it from
 * the seed means the stored record can change shape without anybody's companion
 * silently becoming somebody else, and it means the distribution below can be
 * tested rather than hoped about.
 *
 * mulberry32, which is four lines and good enough for deciding that somebody
 * gets a goat.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * How often each tier turns up, out of a hundred.
 *
 * Legendary at one percent is the point of the whole thing: common enough that
 * somebody in the office will have one, rare enough that it is worth showing
 * people. The odds are not displayed anywhere, because knowing them makes it
 * arithmetic rather than luck.
 */
const RarityWeights: ReadonlyArray<readonly [BuddyRarity, number]> = [
  [BuddyRarity.Common, 55],
  [BuddyRarity.Uncommon, 25],
  [BuddyRarity.Rare, 13],
  [BuddyRarity.Epic, 6],
  [BuddyRarity.Legendary, 1],
]

/** The window each stat is rolled within, by tier. */
const StatRanges: { readonly [key in BuddyRarity]: readonly [number, number] } =
  {
    [BuddyRarity.Common]: [5, 45],
    [BuddyRarity.Uncommon]: [20, 60],
    [BuddyRarity.Rare]: [35, 75],
    [BuddyRarity.Epic]: [50, 88],
    [BuddyRarity.Legendary]: [70, 99],
  }

/**
 * The ordinary pool.
 *
 * Animals rather than anything cleverer, because the joke has to survive being
 * seen every day by somebody who did not ask for it.
 */
const Species: ReadonlyArray<readonly [string, string]> = [
  ['🦊', 'fox'],
  ['🦉', 'owl'],
  ['🦆', 'duck'],
  ['🐙', 'octopus'],
  ['🦀', 'crab'],
  ['🐢', 'tortoise'],
  ['🦎', 'gecko'],
  ['🐝', 'bee'],
  ['🦇', 'bat'],
  ['🐐', 'goat'],
  ['🦔', 'hedgehog'],
  ['🐌', 'snail'],
  ['🦩', 'flamingo'],
  ['🐳', 'whale'],
  ['🦌', 'deer'],
  ['🐿️', 'squirrel'],
  ['🦭', 'seal'],
  ['🐧', 'penguin'],
  ['🦡', 'badger'],
  ['🦞', 'lobster'],
]

/** Reserved for legendaries, so the tier is visible at a glance. */
const MythicSpecies: ReadonlyArray<readonly [string, string]> = [
  ['🐉', 'dragon'],
  ['🦄', 'unicorn'],
  ['🔥', 'phoenix'],
  ['🐙', 'kraken'],
  ['👾', 'cryptid'],
]

const Names: ReadonlyArray<string> = [
  'Pip',
  'Biscuit',
  'Noodle',
  'Waffle',
  'Sprocket',
  'Tuppence',
  'Gizmo',
  'Marlow',
  'Pickle',
  'Bramble',
  'Nutmeg',
  'Wren',
  'Fig',
  'Doris',
  'Kevin',
  'Barnaby',
  'Clementine',
  'Mabel',
  'Rusty',
  'Olive',
  'Crumpet',
  'Hector',
  'Winnie',
  'Basil',
]

function pick<T>(items: ReadonlyArray<T>, random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

/** Which tier a number between 0 and 1 falls into. */
export function rarityFor(roll: number): BuddyRarity {
  const total = RarityWeights.reduce((sum, [, weight]) => sum + weight, 0)
  let position = roll * total

  for (const [rarity, weight] of RarityWeights) {
    position -= weight

    if (position < 0) {
      return rarity
    }
  }

  // Only reachable for a roll of exactly 1, which `mulberry32` never returns.
  return BuddyRarity.Legendary
}

/**
 * Builds the buddy a seed describes.
 *
 * The order the generator is drawn from is part of the answer: changing it
 * reassigns everybody's companion, which is why the tests pin specific seeds to
 * specific buddies rather than only checking the shape.
 */
export function rollBuddy(
  seed: number,
  rolledAt: number,
  rerolls: number = 0
): IBuddy {
  const random = mulberry32(seed)

  const rarity = rarityFor(random())
  const [low, high] = StatRanges[rarity]

  const stats: IBuddyStats = {
    focus: between(random, low, high),
    stamina: between(random, low, high),
    luck: between(random, low, high),
    mischief: between(random, low, high),
  }

  const [glyph, species] = pick(
    rarity === BuddyRarity.Legendary ? MythicSpecies : Species,
    random
  )

  const name = pick(Names, random)

  // Drawn last, so every buddy rolled before this existed keeps the one it had.
  const isShiny = isShinyRoll(random())

  return {
    seed,
    name,
    species,
    glyph,
    rarity,
    stats,
    rolledAt,
    rerolls,
    isShiny,

    // A newly rolled buddy has done nothing yet; the store carries the numbers
    // for one that has.
    xp: 0,
    level: 1,
  }
}

/**
 * How often a buddy turns up in the wrong colours.
 *
 * The number every player of a certain game knows by heart, and chosen for
 * exactly that reason — it is meaningful to anybody who recognises it and
 * harmless to anybody who does not. Nothing tells you the odds.
 */
export const ShinyChance = 1 / 8192

/** Whether a number between 0 and 1 means shiny. */
export function isShinyRoll(roll: number): boolean {
  return roll < ShinyChance
}

/** A seed for a buddy nobody has met yet. */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
