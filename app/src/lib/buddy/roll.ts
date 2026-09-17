import { BuddyRarity, IBuddy, IBuddyHat, IBuddyStats } from '../../models/buddy'

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

/**
 * Species added after buddies were already in the wild.
 *
 * Kept apart from the list above rather than appended to it, and folded in by
 * `foldIn` at the end of the roll. Appending would have been simpler and would
 * have changed what nine per cent of the company owns: the species is chosen as
 * `floor(roll × length)`, so growing the list re-maps every seed. Basil was a
 * gecko before frogs existed, and adding them the obvious way made him a bee.
 */
const AddedSpecies: ReadonlyArray<readonly [string, string]> = [
  ['🐸', 'frog'],
  ['🐱', 'cat'],
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

/**
 * The hats.
 *
 * Headwear only — no sunglasses, no scarves — because a thing on top of the head
 * is the one accessory that reads at sixteen pixels. They do nothing, confer
 * nothing, and are not tied to rarity: a common snail in a crown is funnier than
 * any system of matched sets would be.
 */
const Hats: ReadonlyArray<readonly [string, string]> = [
  ['🎩', 'top hat'],
  ['👑', 'crown'],
  ['🧢', 'cap'],
  ['🎓', 'mortarboard'],
  ['⛑️', 'safety helmet'],
  ['🪖', 'army helmet'],
  ['👒', 'sun hat'],
  ['🎧', 'headphones'],
]

/**
 * Hats added later, folded in the same way and for the same reason.
 *
 * The wizard hat is drawn from a picture rather than this character — Unicode
 * has a mage and no hat, and 🧙 put a whole robed man on the buddy's head. The
 * glyph stays here as what a buddy holds and as the fallback if the picture
 * ever goes missing; `hatArtFor` in hat-fit.ts has the drawing.
 */
const AddedHats: ReadonlyArray<readonly [string, string]> = [
  ['🧙', 'wizard hat'],
]

/** How often a buddy turns up wearing something. */
export const HatChance = 1 / 3

/** Whether a number between 0 and 1 means a hat. */
export function isHatRoll(roll: number): boolean {
  return roll < HatChance
}

/** Every hat there is, for tests and for anybody cataloguing them. */
export function allHats(): ReadonlyArray<IBuddyHat> {
  return [...Hats, ...AddedHats].map(([glyph, name]) => ({ glyph, name }))
}

/** Every ordinary species, original and added, for cataloguing. */
export function allSpecies(): ReadonlyArray<readonly [string, string]> {
  return [...Species, ...AddedSpecies]
}

/** The legendary-only pool. */
export function allMythicSpecies(): ReadonlyArray<readonly [string, string]> {
  return MythicSpecies
}

function pick<T>(items: ReadonlyArray<T>, random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

/**
 * Adds later entries to a pool without moving what the original ones map to.
 *
 * The additions are offered by a draw taken at the very end of the sequence,
 * after everything that existed before. A buddy keeps what it already had unless
 * that final draw lands on one of the new entries, which happens exactly as often
 * as uniform choice over the whole pool would give them — every entry, old and
 * new, ends up equally likely.
 *
 * So adding an animal moves some buddies and leaves most alone, instead of
 * reshuffling the lot. It is the difference between a few people meeting a frog
 * and everybody losing the companion they had.
 */
function foldIn<T>(
  original: T,
  originalCount: number,
  added: ReadonlyArray<T>,
  random: () => number
): T {
  if (added.length === 0) {
    return original
  }

  const draw = random() * (originalCount + added.length)

  return draw < added.length ? added[Math.floor(draw)] : original
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

  const isLegendary = rarity === BuddyRarity.Legendary

  const rolledSpecies = pick(isLegendary ? MythicSpecies : Species, random)

  const name = pick(Names, random)

  // Drawn last, so every buddy rolled before this existed keeps the one it had.
  const isShiny = isShinyRoll(random())

  /*
   * And the hat after that, for the same reason.
   *
   * Every addition goes on the end. The draws above decide who the buddy is, and
   * anything inserted among them quietly hands somebody else's companion to
   * everyone in the company.
   */
  const rolledHat = isHatRoll(random()) ? pick(Hats, random) : null

  /*
   * The tail draws, where anything added later gets its turn.
   *
   * Last of all, so every buddy that existed before these lists grew keeps what
   * it had unless it is one of the few that lands on something new. Legendaries
   * are left out of the species fold: the mythic pool is what makes the tier
   * obvious at a glance, and a legendary cat would undo that.
   */
  const [glyph, species] = isLegendary
    ? rolledSpecies
    : foldIn(rolledSpecies, Species.length, AddedSpecies, random)

  const hat =
    rolledHat === null
      ? null
      : foldIn(rolledHat, Hats.length, AddedHats, random)

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
    grownStats: stats,
    hidden: false,
    hat: hat === null ? null : { glyph: hat[0], name: hat[1] },
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
