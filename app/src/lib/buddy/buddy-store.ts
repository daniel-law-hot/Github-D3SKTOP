import { IBuddy } from '../../models/buddy'
import { getObject, setObject } from '../local-storage'
import { freshSeed, rollBuddy } from './roll'

export const buddyKey = 'buddy'

/**
 * What is written to disk.
 *
 * The seed and the count, and nothing derived from them. A buddy rebuilt from
 * its seed is the same buddy however the pools are reorganised later, whereas a
 * stored name and glyph would slowly drift out of step with the code that made
 * them.
 */
interface IStoredBuddy {
  readonly seed: number
  readonly rolledAt: number
  readonly rerolls: number
}

function read(): IStoredBuddy | undefined {
  const stored = getObject<IStoredBuddy>(buddyKey)

  if (
    stored === undefined ||
    typeof stored.seed !== 'number' ||
    typeof stored.rolledAt !== 'number'
  ) {
    return undefined
  }

  return stored
}

/**
 * The buddy, rolling one on first acquaintance.
 *
 * Everyone has one; there is no opting in. A companion you had to go and enable
 * is a feature, and this is supposed to be a small surprise in a dialog nobody
 * visits for fun.
 */
export function getBuddy(): IBuddy {
  const stored = read()

  if (stored !== undefined) {
    return rollBuddy(stored.seed, stored.rolledAt, stored.rerolls ?? 0)
  }

  const buddy = rollBuddy(freshSeed(), Date.now(), 0)

  setObject(buddyKey, {
    seed: buddy.seed,
    rolledAt: buddy.rolledAt,
    rerolls: buddy.rerolls,
  })

  return buddy
}

/**
 * Trades the current one in for whatever turns up next.
 *
 * The count carries over and never resets, which is the only real consequence
 * in the whole feature: the tab will tell you, quietly, how many you have sent
 * away to get the one you are looking at.
 */
export function rerollBuddy(): IBuddy {
  const previous = read()

  const buddy = rollBuddy(freshSeed(), Date.now(), (previous?.rerolls ?? 0) + 1)

  setObject(buddyKey, {
    seed: buddy.seed,
    rolledAt: buddy.rolledAt,
    rerolls: buddy.rerolls,
  })

  return buddy
}
