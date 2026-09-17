import { ChatterLines } from './chatter-lines'
import { BuddyTone, toneFor } from './chatter-tone'

export { BuddyTone, toneFor }

/** A line for the tone, chosen with the supplied randomness. */
export function pickChatter(tone: BuddyTone, roll: number): string {
  const lines = ChatterLines[tone]
  const index = Math.min(lines.length - 1, Math.floor(roll * lines.length))

  return lines[Math.max(0, index)]
}

/** Every line there is, for tests and for anybody auditing the tone. */
export function allChatter(tone: BuddyTone): ReadonlyArray<string> {
  return ChatterLines[tone]
}

/** How long it stays quiet after speaking, whatever anybody clicks. */
export const ChatterCooldownMs = 10 * 1000

/** How often it speaks once the cooldown has passed. */
export const ChatterChance = 0.35

export interface IChatterQuestion {
  /** When it last said something, or null if it never has. */
  readonly lastSpokeAt: number | null

  readonly now: number

  /** A number between 0 and 1, so the decision can be tested. */
  readonly roll: number
}

/**
 * Whether to say anything at all.
 *
 * Two brakes, because one is not enough. The cooldown stops a burst of clicking
 * turning into a burst of commentary, and the chance stops it being a reliable
 * response to clicking — something that answers on a timer is a machine, and
 * something that answers sometimes is a pet.
 */
export function shouldChatter(question: IChatterQuestion): boolean {
  const { lastSpokeAt, now, roll } = question

  if (lastSpokeAt !== null && now - lastSpokeAt < ChatterCooldownMs) {
    return false
  }

  return roll < ChatterChance
}
