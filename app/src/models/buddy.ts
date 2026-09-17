/**
 * How rare a buddy is.
 *
 * Ordered worst to best, and the order is relied upon — stat ranges are indexed
 * by it, so inserting a tier in the middle shifts everything below it.
 */
export enum BuddyRarity {
  Common = 'common',
  Uncommon = 'uncommon',
  Rare = 'rare',
  Epic = 'epic',
  Legendary = 'legendary',
}

/**
 * The four numbers, which mean nothing.
 *
 * Deliberately: a buddy that conferred an advantage would make the re-roll a
 * chore rather than a joke, and nobody should feel they have to grind for a
 * better one before they can get on with their work.
 */
export interface IBuddyStats {
  readonly focus: number
  readonly stamina: number
  readonly luck: number
  readonly mischief: number
}

export interface IBuddy {
  /**
   * What it was rolled from.
   *
   * Kept so the same buddy can be rebuilt from nothing but this number, which is
   * what makes the roll testable and means a stored buddy survives changes to
   * the shape of the record.
   */
  readonly seed: number

  readonly name: string
  readonly species: string

  /** The emoji it is drawn as. */
  readonly glyph: string

  readonly rarity: BuddyRarity
  readonly stats: IBuddyStats

  /** When it turned up, so the tab can say how long you have had it. */
  readonly rolledAt: number

  /** How many have been traded in before this one. Worn with pride or shame. */
  readonly rerolls: number
}
