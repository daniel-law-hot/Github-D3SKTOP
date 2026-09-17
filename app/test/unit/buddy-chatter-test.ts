import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  allChatter,
  BuddyTone,
  ChatterChance,
  ChatterCooldownMs,
  pickChatter,
  shouldChatter,
  toneFor,
} from '../../src/lib/buddy/chatter'

describe('buddy/chatter', () => {
  describe('toneFor', () => {
    it('reads the whole range of mischief', () => {
      assert.equal(toneFor(1), BuddyTone.Kind)
      assert.equal(toneFor(33), BuddyTone.Kind)
      assert.equal(toneFor(34), BuddyTone.Dry)
      assert.equal(toneFor(66), BuddyTone.Dry)
      assert.equal(toneFor(67), BuddyTone.Snarky)
      assert.equal(toneFor(99), BuddyTone.Snarky)
    })

    /**
     * The same buddy has to sound like itself every time. Mischief never
     * changes, so tone never changes — if this stopped holding, a companion
     * would drift from kind to cutting between one click and the next.
     */
    it('never disagrees with itself', () => {
      for (let mischief = 0; mischief <= 100; mischief++) {
        assert.equal(toneFor(mischief), toneFor(mischief))
      }
    })
  })

  describe('pickChatter', () => {
    it('picks from the right tone', () => {
      for (const tone of Object.values(BuddyTone)) {
        const lines = allChatter(tone)

        for (let i = 0; i < 20; i++) {
          assert.ok(
            lines.includes(pickChatter(tone, i / 20)),
            `${tone} produced something outside its own lines`
          )
        }
      }
    })

    it('can reach every line', () => {
      for (const tone of Object.values(BuddyTone)) {
        const lines = allChatter(tone)
        const seen = new Set<string>()

        for (let i = 0; i < 1000; i++) {
          seen.add(pickChatter(tone, i / 1000))
        }

        assert.equal(
          seen.size,
          lines.length,
          `${tone} only ever says ${seen.size} of its ${lines.length} lines`
        )
      }
    })

    /** A roll of exactly 1 must not fall off the end of the list. */
    it('survives the edges', () => {
      for (const tone of Object.values(BuddyTone)) {
        assert.ok(typeof pickChatter(tone, 0) === 'string')
        assert.ok(typeof pickChatter(tone, 1) === 'string')
        assert.ok(typeof pickChatter(tone, 0.999999) === 'string')
      }
    })

    it('says nothing longer than a bubble can hold', () => {
      for (const tone of Object.values(BuddyTone)) {
        for (const line of allChatter(tone)) {
          assert.ok(
            line.length <= 60,
            `"${line}" is too long for the bubble at ${line.length}`
          )
        }
      }
    })
  })

  describe('the lists themselves', () => {
    it('has a hundred of each tone', () => {
      for (const tone of Object.values(BuddyTone)) {
        assert.equal(
          allChatter(tone).length,
          100,
          tone + ' has ' + allChatter(tone).length + ' lines, not 100'
        )
      }
    })

    /**
     * A hundred lines with duplicates in is eighty lines and a mistake. Easy to
     * do when writing them in one sitting, and invisible afterwards.
     */
    it('never repeats a line within a tone', () => {
      for (const tone of Object.values(BuddyTone)) {
        const lines = allChatter(tone)
        const unique = new Set(lines)

        assert.equal(
          unique.size,
          lines.length,
          tone + ' repeats ' + (lines.length - unique.size) + ' of its lines'
        )
      }
    })

    /** And not across tones either: a kind line is not a snarky one. */
    it('never repeats a line across tones', () => {
      const seen = new Map()

      for (const tone of Object.values(BuddyTone)) {
        for (const line of allChatter(tone)) {
          const already = seen.get(line)

          assert.equal(
            already,
            undefined,
            '"' + line + '" is in both ' + already + ' and ' + tone
          )

          seen.set(line, tone)
        }
      }
    })

    it('says nothing empty', () => {
      for (const tone of Object.values(BuddyTone)) {
        for (const line of allChatter(tone)) {
          assert.ok(line.trim().length > 2, 'a line is empty or nearly so')
        }
      }
    })
  })

  describe('shouldChatter', () => {
    it('speaks the first time, if the roll allows', () => {
      assert.equal(
        shouldChatter({ lastSpokeAt: null, now: 1000, roll: 0 }),
        true
      )
    })

    it('stays quiet inside the cooldown however good the roll', () => {
      assert.equal(
        shouldChatter({ lastSpokeAt: 1000, now: 1000 + 1, roll: 0 }),
        false
      )
      assert.equal(
        shouldChatter({
          lastSpokeAt: 1000,
          now: 1000 + ChatterCooldownMs - 1,
          roll: 0,
        }),
        false
      )
    })

    it('may speak again once the cooldown has passed', () => {
      assert.equal(
        shouldChatter({
          lastSpokeAt: 1000,
          now: 1000 + ChatterCooldownMs,
          roll: 0,
        }),
        true
      )
    })

    /**
     * The second brake. Without it the thing speaks on a timer, and a pet that
     * responds to the clock rather than to you is just a notification.
     */
    it('stays quiet on a poor roll even when it could speak', () => {
      assert.equal(
        shouldChatter({ lastSpokeAt: null, now: 0, roll: ChatterChance }),
        false
      )
      assert.equal(
        shouldChatter({ lastSpokeAt: null, now: 0, roll: 0.99 }),
        false
      )
    })
  })
})
