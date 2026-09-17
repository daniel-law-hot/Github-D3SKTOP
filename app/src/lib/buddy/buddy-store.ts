import { Disposable, Emitter } from 'event-kit'
import { IBuddy } from '../../models/buddy'
import { getObject, setObject } from '../local-storage'
import { freshSeed, rollBuddy } from './roll'
import { levelForXp, MaxLevel, xpForCommit } from './xp'
import { pickChatter, shouldChatter, toneFor } from './chatter'

export const buddyKey = 'buddy'

/**
 * What is written to disk.
 *
 * The seed and what has happened since. Everything about the buddy itself is
 * rebuilt from the seed, so the record can change shape without anybody's
 * companion silently becoming somebody else; the experience and the polish are
 * the only things that cannot be derived and so are the only things stored.
 */
interface IStoredBuddy {
  readonly seed: number
  readonly rolledAt: number
  readonly rerolls: number
  readonly xp: number

  /** Whether the shine was earned at max level rather than rolled. */
  readonly polished: boolean
}

const emitter = new Emitter()

/**
 * Anybody showing the buddy wants to know when it changes.
 *
 * The tab, the card and the companion in the toolbar are in different parts of
 * the tree with a dialog between them, and experience arrives from a commit in a
 * different part again. A module emitter rather than threading state through the
 * app store: this is a decoration with no bearing on anything, and giving it a
 * seat in the application state would imply otherwise.
 */
export function onBuddyChanged(fn: (buddy: IBuddy | null) => void): Disposable {
  return emitter.on('changed', fn)
}

/** Fires when the buddy has something to say, with the line it said. */
export function onBuddySpoke(fn: (line: string) => void): Disposable {
  return emitter.on('spoke', fn)
}

/** When it last spoke, so the cooldown survives a re-render but not a restart. */
let lastSpokeAt: number | null = null

/**
 * Gives the buddy a chance to say something.
 *
 * Called when somebody clicks about in HotFlow. Most clicks get nothing: the
 * cooldown and the chance in `shouldChatter` are both deliberate, because a
 * companion that comments on every action is a companion people disable on the
 * first afternoon.
 *
 * What it says comes from mischief, which is otherwise a number that does
 * nothing — a placid buddy is encouraging and a mischievous one takes the
 * mickey, and since the stat never moves, the same buddy always sounds like
 * itself.
 */
export function maybeChatter(now: number = Date.now()): string | null {
  const buddy = getBuddy()

  if (buddy === null) {
    return null
  }

  if (!shouldChatter({ lastSpokeAt, now, roll: Math.random() })) {
    return null
  }

  lastSpokeAt = now

  const line = pickChatter(toneFor(buddy.stats.mischief), Math.random())
  emitter.emit('spoke', line)

  return line
}

function read(): IStoredBuddy | null {
  const stored = getObject<IStoredBuddy>(buddyKey)

  if (
    stored === undefined ||
    typeof stored.seed !== 'number' ||
    typeof stored.rolledAt !== 'number'
  ) {
    return null
  }

  return stored
}

/** Rebuilds the buddy a record describes. */
function hydrate(stored: IStoredBuddy): IBuddy {
  const xp = typeof stored.xp === 'number' ? stored.xp : 0
  const rolled = rollBuddy(stored.seed, stored.rolledAt, stored.rerolls ?? 0)

  return {
    ...rolled,
    xp,
    level: levelForXp(xp),

    // Rolled at one in 8192, or earned by getting to the top. Both are the same
    // colours; only the tab says which it was.
    isShiny: rolled.isShiny || stored.polished === true,
  }
}

function write(stored: IStoredBuddy): IBuddy {
  setObject(buddyKey, stored)

  const buddy = hydrate(stored)
  emitter.emit('changed', buddy)

  return buddy
}

/**
 * The buddy, or nothing at all.
 *
 * Nothing, until somebody goes looking. A companion that appeared unbidden on
 * first launch is a thing the application does to you; one you had to go and
 * find is a thing you did, and the difference is most of why it is worth having.
 */
export function getBuddy(): IBuddy | null {
  const stored = read()

  return stored === null ? null : hydrate(stored)
}

/** The first one. Does nothing if somebody already has one. */
export function spawnBuddy(): IBuddy {
  const existing = getBuddy()

  if (existing !== null) {
    return existing
  }

  return write({
    seed: freshSeed(),
    rolledAt: Date.now(),
    rerolls: 0,
    xp: 0,
    polished: false,
  })
}

/**
 * Trades the current one in for whatever turns up next.
 *
 * Everything goes: the level, the experience behind it, and any shine that was
 * earned rather than rolled. That is the cost, and it is what stops the re-roll
 * being a slot machine somebody pulls until a dragon falls out — after a few
 * hundred commits, trading a buddy in is a real decision.
 *
 * The count of how many have been sent away is the one thing that carries over,
 * because that part is a history rather than a possession.
 */
export function rerollBuddy(): IBuddy {
  const previous = read()

  return write({
    seed: freshSeed(),
    rolledAt: Date.now(),
    rerolls: (previous?.rerolls ?? 0) + 1,
    xp: 0,
    polished: false,
  })
}

/**
 * Earns experience for a commit.
 *
 * Silent when nobody has a buddy: the commit is the point and this is a
 * decoration on top of it, so it never asks for attention and never fails in a
 * way anybody has to read.
 */
export function recordCommitXp(linesChanged: number): IBuddy | null {
  const stored = read()

  if (stored === null) {
    return null
  }

  const xp =
    (typeof stored.xp === 'number' ? stored.xp : 0) + xpForCommit(linesChanged)

  return write({ ...stored, xp })
}

/**
 * Makes a maxed buddy shine.
 *
 * The one thing levelling is for. Refused below the top, and refused for one
 * that is already shiny, so the button can never be a way of spending a level on
 * nothing.
 */
export function polishBuddy(): IBuddy | null {
  const stored = read()

  if (stored === null) {
    return null
  }

  const buddy = hydrate(stored)

  if (buddy.level < MaxLevel || buddy.isShiny) {
    return buddy
  }

  return write({ ...stored, polished: true })
}
