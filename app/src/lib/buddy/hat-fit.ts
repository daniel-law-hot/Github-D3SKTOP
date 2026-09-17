/**
 * Where a hat sits on each animal.
 *
 * The emoji are not drawn to a common plan. A fox is a face filling the square,
 * a goat is a whole animal in profile with its head in the left third, a bat
 * hangs with its face near the floor, and a snail's is behind a pair of
 * eyestalks. One centred position serves the faces and puts a crown on a
 * badger's shoulder, a helmet through a flamingo's neck, and a top hat in mid
 * air above a tortoise.
 *
 * So every species says where its own head is. Read off the artwork at 150px
 * against an eighths grid, one animal at a time.
 */

/** A head, in fractions of the figure's box, measured from its top left. */
export interface IHatFit {
  /** The centre of the head, across. */
  readonly x: number

  /** The line the brim rests on. */
  readonly y: number

  /** How big the hat is, in the same units — a snail cannot carry an owl's. */
  readonly scale: number
}

/**
 * How far above the brim line a hat reaches, per unit of scale.
 *
 * An emoji's ink runs from 0.93em above its baseline to 0.15em below, and the
 * tilt lifts the leading corner another 0.11em. Placing by the brim means that
 * whole height goes upwards, which is what the strip has to leave room for —
 * see `--buddy-headroom`, and the test that holds the two in step.
 */
export const HatRise = 1.19

const Fits: { readonly [species: string]: IHatFit } = {
  // Faces that fill the square: the hat goes between the ears.
  fox: { x: 0.5, y: 0.26, scale: 0.46 },
  owl: { x: 0.5, y: 0.22, scale: 0.46 },
  frog: { x: 0.5, y: 0.26, scale: 0.44 },
  cat: { x: 0.5, y: 0.28, scale: 0.44 },
  penguin: { x: 0.5, y: 0.26, scale: 0.42 },
  octopus: { x: 0.5, y: 0.26, scale: 0.46 },

  // Heads in the left third, the animal facing left.
  duck: { x: 0.31, y: 0.22, scale: 0.38 },
  goat: { x: 0.22, y: 0.3, scale: 0.36 },
  deer: { x: 0.2, y: 0.32, scale: 0.34 }, // between the antlers
  squirrel: { x: 0.29, y: 0.32, scale: 0.36 },
  seal: { x: 0.27, y: 0.36, scale: 0.36 },
  snail: { x: 0.24, y: 0.4, scale: 0.34 }, // on the head, under the eyestalks
  badger: { x: 0.2, y: 0.46, scale: 0.34 },
  hedgehog: { x: 0.24, y: 0.54, scale: 0.34 }, // the spines start behind it
  tortoise: { x: 0.1, y: 0.62, scale: 0.24 }, // the head, low and left of the shell
  gecko: { x: 0.37, y: 0.3, scale: 0.38 },
  flamingo: { x: 0.47, y: 0.22, scale: 0.32 }, // a small head on a long neck

  // The rest, each its own shape.
  crab: { x: 0.5, y: 0.44, scale: 0.42 }, // on the shell, between the claws
  lobster: { x: 0.5, y: 0.42, scale: 0.36 },
  bee: { x: 0.24, y: 0.48, scale: 0.34 }, // the head, below the wing
  bat: { x: 0.56, y: 0.66, scale: 0.36 }, // hanging, so the face is low
  whale: { x: 0.45, y: 0.36, scale: 0.42 }, // beside the spout

  // Legendaries.
  dragon: { x: 0.33, y: 0.28, scale: 0.36 },
  unicorn: { x: 0.58, y: 0.34, scale: 0.38 }, // behind the horn
  phoenix: { x: 0.5, y: 0.3, scale: 0.4 }, // no head; the flame will do
  kraken: { x: 0.5, y: 0.26, scale: 0.46 },
  cryptid: { x: 0.5, y: 0.3, scale: 0.42 },
}

/**
 * Somewhere sensible for a species nobody has measured yet.
 *
 * Centred and low enough to stay inside the headroom, so a species added in a
 * hurry looks approximately dressed rather than decapitated.
 */
const Default: IHatFit = { x: 0.5, y: 0.3, scale: 0.42 }

/** Where this species wears its hat. */
export function hatFitFor(species: string): IHatFit {
  return Fits[species] ?? Default
}

/**
 * How far a hat has to be dropped to land on the brim line, in its own ems.
 *
 * Hanging every hat by the bottom of its ink only works while the ink agrees
 * with the baseline, and the cap's does not: its artwork stops 0.02em above the
 * baseline where the others end 0.15em below it, so left alone it floats a
 * sixth of its height over every head in the company. The figures here are that
 * difference, measured off the glyphs rather than guessed.
 */
const Drops: { readonly [hat: string]: number } = {
  cap: 0.17,
}

/** How far to drop this hat so its brim rests where the species says. */
export function hatDropFor(hat: string): number {
  return Drops[hat] ?? 0
}

/**
 * A hat drawn rather than typed.
 *
 * `width` is how wide to draw it, in figure ems, standing in for the 1.01em of
 * ink an emoji hat gives you. A wide, low hat needs more of it to carry the
 * same weight as a helmet: this one is twice as wide as it is tall, so at the
 * emoji's own 1.01em it looked like something the animal had sat on.
 *
 * It still rises less than a glyph does — `width * 88/183` against `HatRise` —
 * so a drawn hat always fits in headroom sized for a typed one.
 */
export interface IHatArt {
  readonly src: string
  readonly width: number
}

/**
 * The hats that no emoji provides.
 *
 * Unicode has a mage, 🧙, and no wizard hat — so the pool's wizard hat was a
 * whole robed man standing on the buddy's head. This is his hat and nothing
 * else: cut from Microsoft's Fluent Emoji mage (MIT licensed, and the same
 * artwork Windows draws every other hat here from, so it sits among them
 * instead of beside them), with the staff and the wizard himself taken out.
 *
 * Kept out of the pool in roll.ts on purpose: the roll draws `['🧙', 'wizard
 * hat']` exactly as it always has, so nobody's hat changes into somebody
 * else's. Only the drawing of it changes.
 */
const Art: { readonly [hat: string]: IHatArt } = {
  'wizard hat': { src: 'static/wizard-hat.png', width: 1.55 },
}

/** The picture for this hat, where there is one. */
export function hatArtFor(hat: string): IHatArt | null {
  return Art[hat] ?? null
}

/** Every measured species, for the test that checks none has been missed. */
export function measuredSpecies(): ReadonlyArray<string> {
  return Object.keys(Fits)
}
