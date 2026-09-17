import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  hatArtFor,
  hatDropFor,
  hatFitFor,
  HatRise,
  measuredSpecies,
} from '../../src/lib/buddy/hat-fit'
import { allHats, allMythicSpecies, allSpecies } from '../../src/lib/buddy/roll'

/**
 * What `--buddy-headroom` in _buddy.scss leaves above the animal.
 *
 * The strip clips, so a hat that reaches higher than this is a hat with its top
 * sliced off in the toolbar. The two numbers have to move together, which is
 * what the test below is for.
 */
const Headroom = 0.4

const everySpecies = [...allSpecies(), ...allMythicSpecies()].map(
  ([, name]) => name
)

describe('buddy/hat-fit', () => {
  it('has measured every species', () => {
    for (const species of everySpecies) {
      assert.ok(
        measuredSpecies().includes(species),
        `${species} has no hat placement, so it would wear the default`
      )
    }
  })

  /** A row left behind by a renamed species is a row nobody will ever see. */
  it('has no placement for a species that does not exist', () => {
    for (const measured of measuredSpecies()) {
      assert.ok(
        everySpecies.includes(measured),
        `${measured} is not a species any more`
      )
    }
  })

  it('puts every hat on the animal rather than beside it', () => {
    for (const species of everySpecies) {
      const fit = hatFitFor(species)

      assert.ok(fit.x > 0 && fit.x < 1, `${species} wears it off to one side`)
      assert.ok(fit.y > 0 && fit.y < 1, `${species} wears it above or below`)
      assert.ok(
        fit.scale > 0.15 && fit.scale < 0.6,
        `${species} wears one the wrong size entirely`
      )
    }
  })

  /**
   * The one that matters when somebody adds a species in a hurry.
   *
   * A hat hangs upwards from the brim, so a high anchor and a big hat together
   * reach above the animal's own box — and the strip it walks in only leaves
   * `--buddy-headroom`. Getting this wrong is invisible in Options, where there
   * is room to spare, and shears the top off the hat in the toolbar.
   */
  it('keeps every hat inside the headroom the strip leaves', () => {
    for (const species of everySpecies) {
      const fit = hatFitFor(species)
      const rise = HatRise * fit.scale - fit.y

      assert.ok(
        rise <= Headroom,
        `${species} wears it ${rise.toFixed(
          2
        )}em above its own head, and the strip only clears ${Headroom}em`
      )
    }
  })

  describe('hatDropFor', () => {
    it('leaves alone the hats that end where they should', () => {
      assert.equal(hatDropFor('top hat'), 0)
      assert.equal(hatDropFor('army helmet'), 0)
    })

    it('brings the cap down onto the head', () => {
      assert.ok(hatDropFor('cap') > 0)
    })

    it('only corrects hats that exist', () => {
      const names = allHats().map(hat => hat.name)

      for (const name of ['cap']) {
        assert.ok(names.includes(name), `${name} is not a hat any more`)
      }
    })

    it('has nothing to say about a hat it has never met', () => {
      assert.equal(hatDropFor('sombrero'), 0)
    })
  })

  describe('hatArtFor', () => {
    /**
     * The one that stops the wizard quietly coming back.
     *
     * Without a picture the pool's wizard hat falls back to 🧙, which is a whole
     * robed man — and he stands on the buddy's head looking like a bug.
     */
    it('draws the wizard hat, which no emoji provides', () => {
      assert.notEqual(hatArtFor('wizard hat'), null)
    })

    it('leaves every other hat to its character', () => {
      for (const hat of allHats()) {
        if (hat.name !== 'wizard hat') {
          assert.equal(hatArtFor(hat.name), null, `${hat.name} has a picture`)
        }
      }
    })

    /** A src that resolves to nothing is a hat nobody sees until it ships. */
    it('names a file that is actually there', () => {
      for (const hat of allHats()) {
        const art = hatArtFor(hat.name)
        if (art === null) {
          continue
        }

        assert.ok(
          art.src.startsWith('static/'),
          `${hat.name} is drawn from ${art.src}, which is not a packaged asset`
        )

        const file = join(
          __dirname,
          '../../static/common',
          art.src.slice('static/'.length)
        )

        assert.ok(
          existsSync(file),
          `${art.src} is missing from app/static/common`
        )
      }
    })

    /**
     * The drop corrects a glyph whose ink stops short of its baseline. A picture
     * is trimmed to its own ink, so correcting it too would push it into the
     * animal's head.
     */
    it('does not also drop a hat it draws', () => {
      for (const hat of allHats()) {
        if (hatArtFor(hat.name) !== null) {
          assert.equal(hatDropFor(hat.name), 0)
        }
      }
    })

    it('has nothing to draw for a hat it has never met', () => {
      assert.equal(hatArtFor('sombrero'), null)
    })
  })
})
