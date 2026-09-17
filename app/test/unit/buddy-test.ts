import { describe, it } from 'node:test'
import assert from 'node:assert'
import { rarityFor, rollBuddy } from '../../src/lib/buddy/roll'
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
      const mythic = new Set([
        'dragon',
        'unicorn',
        'phoenix',
        'kraken',
        'cryptid',
      ])

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
