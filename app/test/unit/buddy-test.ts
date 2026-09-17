import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  allHats,
  allMythicSpecies,
  allSpecies,
  HatChance,
  isHatRoll,
  isShinyRoll,
  rarityFor,
  rollBuddy,
  ShinyChance,
} from '../../src/lib/buddy/roll'
import { BuddyRarity } from '../../src/models/buddy'

describe('buddy', () => {
  describe('rollBuddy', () => {
    /**
     * The seed is the buddy. If this stops holding, everybody's companion is
     * quietly replaced by somebody else's on the next release — which is a
     * worse outcome than it sounds for a feature whose entire appeal is that it
     * is yours.
     */
    it('is the same buddy every time for a given seed', () => {
      const first = rollBuddy(12345, 0)
      const second = rollBuddy(12345, 999)

      assert.equal(first.name, second.name)
      assert.equal(first.species, second.species)
      assert.equal(first.glyph, second.glyph)
      assert.equal(first.rarity, second.rarity)
      assert.equal(first.isShiny, second.isShiny)
      assert.deepStrictEqual(first.stats, second.stats)
    })

    it('gives different seeds different buddies', () => {
      const buddies = new Set(
        Array.from({ length: 50 }, (_, i) =>
          JSON.stringify(rollBuddy(i * 7919, 0))
        )
      )

      // Collisions are possible from a small pool; wholesale sameness is not.
      assert.ok(buddies.size > 40, `only ${buddies.size} distinct in 50`)
    })

    it('keeps every stat within its tier', () => {
      const ranges = {
        [BuddyRarity.Common]: [5, 45],
        [BuddyRarity.Uncommon]: [20, 60],
        [BuddyRarity.Rare]: [35, 75],
        [BuddyRarity.Epic]: [50, 88],
        [BuddyRarity.Legendary]: [70, 99],
      }

      for (let seed = 0; seed < 2000; seed++) {
        const buddy = rollBuddy(seed, 0)
        const [low, high] = ranges[buddy.rarity]

        for (const [name, value] of Object.entries(buddy.stats)) {
          assert.ok(
            value >= low && value <= high,
            `${buddy.rarity} ${name} was ${value}, outside ${low}-${high}`
          )
        }
      }
    })

    /** A legendary has to be recognisable across the room. */
    it('only gives the mythic species to legendaries', () => {
      const mythic = new Set(allMythicSpecies().map(([, name]) => name))

      for (let seed = 0; seed < 2000; seed++) {
        const buddy = rollBuddy(seed, 0)

        assert.equal(
          mythic.has(buddy.species),
          buddy.rarity === BuddyRarity.Legendary,
          `${buddy.rarity} got ${buddy.species}`
        )
      }
    })

    it('carries the reroll count through', () => {
      assert.equal(rollBuddy(1, 0, 4).rerolls, 4)
      assert.equal(rollBuddy(1, 0).rerolls, 0)
    })
  })

  /**
   * The promise the whole seed scheme rests on.
   *
   * These four were captured from the implementation before shiny existed. If a
   * draw is ever inserted ahead of the ones deciding rarity, stats, species or
   * name, every buddy in the company silently becomes somebody else — and these
   * are what notice.
   */
  describe('seeds already in the wild', () => {
    const known = [
      [12345, 'Biscuit', 'gecko', 'epic', [61, 68, 81, 69]],
      [1034720879, 'Basil', 'gecko', 'rare', [45, 69, 73, 69]],
      [7, 'Wren', 'bat', 'common', [7, 45, 33, 26]],
      [999999, 'Nutmeg', 'crab', 'common', [24, 25, 37, 21]],
    ] as const

    for (const [seed, name, species, rarity, stats] of known) {
      it(`still gives seed ${seed} the same buddy`, () => {
        const buddy = rollBuddy(seed, 0)

        assert.equal(buddy.name, name)
        assert.equal(buddy.species, species)
        assert.equal(buddy.rarity, rarity)
        assert.deepStrictEqual(
          [
            buddy.stats.focus,
            buddy.stats.stamina,
            buddy.stats.luck,
            buddy.stats.mischief,
          ],
          [...stats]
        )
      })
    }
  })

  describe('shiny', () => {
    it('is one in 8192', () => {
      assert.equal(ShinyChance, 1 / 8192)
    })

    it('takes everything below the threshold and nothing above it', () => {
      assert.equal(isShinyRoll(0), true)
      assert.equal(isShinyRoll(ShinyChance / 2), true)
      assert.equal(isShinyRoll(ShinyChance), false)
      assert.equal(isShinyRoll(0.5), false)
      assert.equal(isShinyRoll(1), false)
    })

    it('sticks to the seed like everything else', () => {
      for (let seed = 0; seed < 200; seed++) {
        assert.equal(rollBuddy(seed, 0).isShiny, rollBuddy(seed, 999).isShiny)
      }
    })

    /**
     * Wide bounds on purpose. Twenty-four expected in two hundred thousand is a
     * small enough number that a tight assertion would fail on nothing but luck.
     * This is here to catch a threshold wrong by orders of magnitude, which is
     * the mistake actually worth catching.
     */
    it('turns up at roughly the right rate over a long sweep', () => {
      let count = 0

      for (let seed = 0; seed < 200000; seed++) {
        if (rollBuddy(seed, 0).isShiny) {
          count++
        }
      }

      assert.ok(count > 4, `only ${count} shinies in 200000`)
      assert.ok(count < 70, `${count} shinies in 200000 is far too many`)
    })
  })

  describe('folding in later additions', () => {
    /**
     * Every entry equally likely, however many rounds of additions there have
     * been. If the fold were wrong the newcomers would be rarer or commoner
     * than the originals, and nobody would notice by eye.
     */
    it('gives the newcomers the same odds as everybody else', () => {
      const counts = new Map()
      const total = 60000
      let ordinary = 0

      for (let seed = 0; seed < total; seed++) {
        const buddy = rollBuddy(seed, 0)

        if (buddy.rarity !== BuddyRarity.Legendary) {
          ordinary++
          counts.set(buddy.species, (counts.get(buddy.species) ?? 0) + 1)
        }
      }

      const expected = ordinary / allSpecies().length

      for (const [, name] of allSpecies()) {
        const seen = counts.get(name) ?? 0

        assert.ok(
          Math.abs(seen - expected) < expected * 0.25,
          name +
            ' turned up ' +
            seen +
            ' times, expected about ' +
            Math.round(expected)
        )
      }
    })

    it('lets every ordinary species turn up', () => {
      const seen = new Set()

      for (let seed = 0; seed < 20000; seed++) {
        seen.add(rollBuddy(seed, 0).species)
      }

      for (const [, name] of allSpecies()) {
        assert.ok(seen.has(name), name + ' never turns up')
      }
    })
  })

  describe('hats', () => {
    it('is one in three', () => {
      assert.equal(HatChance, 1 / 3)
    })

    it('takes everything below the threshold and nothing above it', () => {
      assert.equal(isHatRoll(0), true)
      assert.equal(isHatRoll(0.33), true)
      assert.equal(isHatRoll(HatChance), false)
      assert.equal(isHatRoll(0.9), false)
    })

    it('only ever wears a hat from the wardrobe', () => {
      const wardrobe = new Set(allHats().map(h => h.name))

      for (let seed = 0; seed < 3000; seed++) {
        const { hat } = rollBuddy(seed, 0)

        if (hat !== null) {
          assert.ok(wardrobe.has(hat.name), hat.name + ' is not a hat we have')
          assert.ok(hat.glyph.length > 0, hat.name + ' has no glyph')
        }
      }
    })

    it('sticks to the seed like everything else', () => {
      for (let seed = 0; seed < 200; seed++) {
        const first = rollBuddy(seed, 0).hat
        const second = rollBuddy(seed, 999).hat

        assert.deepStrictEqual(first, second)
      }
    })

    it('turns up on roughly a third of them', () => {
      let hatted = 0

      for (let seed = 0; seed < 30000; seed++) {
        if (rollBuddy(seed, 0).hat !== null) {
          hatted++
        }
      }

      const share = (hatted / 30000) * 100

      assert.ok(
        Math.abs(share - 33.3) < 2,
        'hats came out at ' + share.toFixed(2) + ' per cent'
      )
    })

    it('can reach every hat in the wardrobe', () => {
      const seen = new Set()

      for (let seed = 0; seed < 20000; seed++) {
        const { hat } = rollBuddy(seed, 0)
        if (hat !== null) {
          seen.add(hat.name)
        }
      }

      assert.equal(seen.size, allHats().length, 'some hat never turns up')
    })
  })

  describe('rarityFor', () => {
    it('puts the boundaries where the weights say', () => {
      assert.equal(rarityFor(0), BuddyRarity.Common)
      assert.equal(rarityFor(0.54), BuddyRarity.Common)
      assert.equal(rarityFor(0.56), BuddyRarity.Uncommon)
      assert.equal(rarityFor(0.79), BuddyRarity.Uncommon)
      assert.equal(rarityFor(0.81), BuddyRarity.Rare)
      assert.equal(rarityFor(0.92), BuddyRarity.Rare)
      assert.equal(rarityFor(0.95), BuddyRarity.Epic)
      assert.equal(rarityFor(0.999), BuddyRarity.Legendary)
    })

    /**
     * A boundary belongs to the tier above it: the bands are 0–55, 55–80,
     * 80–93, 93–99, 99–100, and each opens at its lower number. Worth pinning,
     * because an off-by-one here is invisible and would quietly make one tier a
     * percentage point rarer than intended.
     */
    it('opens each band at its lower number', () => {
      assert.equal(rarityFor(0.55), BuddyRarity.Uncommon)
      assert.equal(rarityFor(0.8), BuddyRarity.Rare)
      assert.equal(rarityFor(0.93), BuddyRarity.Epic)
      assert.equal(rarityFor(0.99), BuddyRarity.Legendary)
    })

    /**
     * The odds are the feature. A legendary that turned up for one person in
     * five would not be worth showing anybody.
     */
    it('rolls roughly one legendary in a hundred', () => {
      const counts = new Map<BuddyRarity, number>()

      for (let seed = 0; seed < 20000; seed++) {
        const { rarity } = rollBuddy(seed, 0)
        counts.set(rarity, (counts.get(rarity) ?? 0) + 1)
      }

      const share = (rarity: BuddyRarity) =>
        ((counts.get(rarity) ?? 0) / 20000) * 100

      assert.ok(
        Math.abs(share(BuddyRarity.Legendary) - 1) < 0.5,
        `legendary came out at ${share(BuddyRarity.Legendary).toFixed(2)}%`
      )
      assert.ok(
        Math.abs(share(BuddyRarity.Common) - 55) < 3,
        `common came out at ${share(BuddyRarity.Common).toFixed(2)}%`
      )
      assert.ok(
        Math.abs(share(BuddyRarity.Epic) - 6) < 1.5,
        `epic came out at ${share(BuddyRarity.Epic).toFixed(2)}%`
      )
    })

    it('never returns anything outside the tiers', () => {
      for (let i = 0; i <= 1000; i++) {
        assert.ok(Object.values(BuddyRarity).includes(rarityFor(i / 1000)))
      }
    })
  })
})
