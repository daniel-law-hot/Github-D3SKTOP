/**
 * What the buddy is like to be around.
 *
 * Read off mischief, which until now was a number that did nothing. Low is
 * encouraging, high is cheeky, and the middle is dry — the same buddy always
 * sounds like itself, because the stat never changes.
 *
 * In its own file so the three hundred lines can live in theirs without the
 * decision that picks between them being buried in the middle of them.
 */
export enum BuddyTone {
  Kind = 'kind',
  Dry = 'dry',
  Snarky = 'snarky',
}

/** Which band a mischief score falls into. */
export function toneFor(mischief: number): BuddyTone {
  if (mischief < 34) {
    return BuddyTone.Kind
  }

  return mischief < 67 ? BuddyTone.Dry : BuddyTone.Snarky
}
