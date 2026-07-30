import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  buildFeatureBranchName,
  extractVsoNumbers,
  isFeatureBranchName,
  isRecommendedFeatureBranchName,
  isReleaseBranchName,
  parseFeatureBranchName,
  parseReleaseBranchName,
  slugifyDescription,
} from '../../../src/lib/hotflow/branch-patterns'

describe('hotflow/branch-patterns', () => {
  describe('parseFeatureBranchName', () => {
    it('parses the convention', () => {
      const parsed = parseFeatureBranchName('feature/100712-fix-login-redirect')

      assert.deepStrictEqual(parsed, {
        vso: 100712,
        slug: 'fix-login-redirect',
      })
    })

    it('parses a remote-prefixed branch', () => {
      const parsed = parseFeatureBranchName(
        'origin/feature/100712-fix-login-redirect'
      )

      assert.strictEqual(parsed?.vso, 100712)
    })

    it('rejects names that are not feature branches', () => {
      assert.strictEqual(parseFeatureBranchName('feature/no-vso-here'), null)
      assert.strictEqual(parseFeatureBranchName('feature/100712'), null)
      assert.strictEqual(parseFeatureBranchName('bugfix/100712-thing'), null)
      assert.strictEqual(parseFeatureBranchName('develop'), null)
    })

    it('accepts capitals, as real branches use them', () => {
      // Five of the thirteen feature branches in ContentOrchestration carry
      // capitals. Rejecting them made HotFlow blind to real work in flight.
      const realNames = [
        'feature/86270-Add-missing-hotel-RQ-validation',
        'feature/104599-Accommodation-Amadeus-book-v2',
        'feature/105172-add-BookingItemId-to-amadeus-hotel-cancel-mapping',
        'feature/106237-align-onRequestHotels-with-other-supplier-services',
        'feature/107091-Accommodation-Structured-Messaging-Interception',
      ]

      for (const name of realNames) {
        assert.notStrictEqual(
          parseFeatureBranchName(name),
          null,
          `expected ${name} to be recognised`
        )
      }

      assert.strictEqual(
        parseFeatureBranchName('feature/86270-Add-missing-hotel-RQ-validation')
          ?.vso,
        86270
      )
    })

    it('accepts underscores and dots in the description', () => {
      assert.strictEqual(
        parseFeatureBranchName('feature/100712-fix_login.v2')?.vso,
        100712
      )
    })

    it('agrees with isFeatureBranchName', () => {
      assert.ok(isFeatureBranchName('feature/1-a'))
      assert.ok(isFeatureBranchName('feature/86270-Add-Missing-Validation'))
      assert.ok(!isFeatureBranchName('main'))
    })
  })

  describe('isRecommendedFeatureBranchName', () => {
    it('accepts the house style', () => {
      assert.ok(
        isRecommendedFeatureBranchName('feature/100712-fix-login-redirect')
      )
    })

    it('rejects capitals and underscores', () => {
      // The nudge stays strict even though detection is permissive.
      assert.ok(
        !isRecommendedFeatureBranchName('feature/100712-Fix-Login-Redirect')
      )
      assert.ok(!isRecommendedFeatureBranchName('feature/100712-fix_login'))
    })

    it('is stricter than detection, never the reverse', () => {
      // Anything the nudge accepts must also be detectable, or a correctly named
      // branch could be invisible to the very feature recommending the name.
      const names = [
        'feature/1-a',
        'feature/100712-fix-login-redirect',
        'feature/86270-Add-missing-hotel-RQ-validation',
        'feature/100712-fix_login',
        'main',
        'develop',
      ]

      for (const name of names) {
        if (isRecommendedFeatureBranchName(name)) {
          assert.ok(
            isFeatureBranchName(name),
            `${name} is recommended but not detected`
          )
        }
      }
    })
  })

  describe('parseReleaseBranchName', () => {
    it('parses a release branch into its version', () => {
      assert.strictEqual(
        parseReleaseBranchName('release/1.2026.9')?.raw,
        '1.2026.9'
      )
    })

    it('parses a remote-prefixed release branch', () => {
      assert.strictEqual(
        parseReleaseBranchName('origin/release/1.2026.9')?.raw,
        '1.2026.9'
      )
    })

    it('returns null for non-release branches', () => {
      assert.strictEqual(parseReleaseBranchName('development'), null)
      assert.strictEqual(parseReleaseBranchName('feature/1-a'), null)
    })

    it('recognises an unparseable release branch as still being one', () => {
      // We want it listed, just never selected as the current release.
      assert.ok(isReleaseBranchName('release/candidate'))
      assert.strictEqual(parseReleaseBranchName('release/candidate'), null)
    })
  })

  describe('extractVsoNumbers', () => {
    it('reads a VSO from a merge commit subject', () => {
      const subject =
        'Merge pull request #412 from HouseOfTravel/feature/100712-fix-login'

      assert.deepStrictEqual(extractVsoNumbers(subject), [100712])
    })

    it('reads a VSO from a squash commit subject', () => {
      assert.deepStrictEqual(
        extractVsoNumbers('feature/100712-fix-login (#412)'),
        [100712]
      )
    })

    it('reads the AB# convention', () => {
      assert.deepStrictEqual(extractVsoNumbers('Fixes AB#100712'), [100712])
    })

    it('reads written-out VSO references', () => {
      assert.deepStrictEqual(extractVsoNumbers('VSO 100712'), [100712])
      assert.deepStrictEqual(extractVsoNumbers('VSO-100712'), [100712])
      assert.deepStrictEqual(extractVsoNumbers('vso #100712'), [100712])
    })

    it('ignores bare numbers', () => {
      // This is the whole point of being conservative: PR numbers, dates and
      // ticket-like strings must not inflate "what is in this release".
      assert.deepStrictEqual(extractVsoNumbers('Bump version to 100712'), [])
      assert.deepStrictEqual(extractVsoNumbers('Fixes #412'), [])
      assert.deepStrictEqual(extractVsoNumbers('Released on 20260714'), [])
    })

    it('deduplicates repeated references', () => {
      const text = 'feature/100712-fix-login and AB#100712 and VSO 100712'

      assert.deepStrictEqual(extractVsoNumbers(text), [100712])
    })

    it('finds several distinct references', () => {
      const found = extractVsoNumbers('AB#100712 and AB#100833')

      assert.deepStrictEqual(
        [...found].sort((a, b) => a - b),
        [100712, 100833]
      )
    })

    it('is reusable across calls', () => {
      // Guards a real hazard: the patterns are module-level and carry the global
      // flag, so a stale lastIndex would make the second call miss.
      const first = extractVsoNumbers('AB#100712')
      const second = extractVsoNumbers('AB#100712')

      assert.deepStrictEqual(first, second)
    })

    it('handles empty input', () => {
      assert.deepStrictEqual(extractVsoNumbers(''), [])
    })
  })

  describe('slugifyDescription', () => {
    it('lower-kebabs free text', () => {
      assert.strictEqual(
        slugifyDescription('Fix login redirect'),
        'fix-login-redirect'
      )
    })

    it('drops punctuation and collapses separators', () => {
      assert.strictEqual(
        slugifyDescription("Fix  the user's   login!!"),
        'fix-the-user-s-login'
      )
    })

    it('strips accents rather than dropping the letter', () => {
      assert.strictEqual(slugifyDescription('Kororā penguin'), 'korora-penguin')
    })

    it('trims leading and trailing separators', () => {
      assert.strictEqual(slugifyDescription('  -- hello -- '), 'hello')
    })

    it('returns an empty string when there is nothing usable', () => {
      assert.strictEqual(slugifyDescription('!!!'), '')
    })
  })

  describe('buildFeatureBranchName', () => {
    it('produces a name that parses back', () => {
      const name = buildFeatureBranchName(100712, 'Fix login redirect')

      assert.strictEqual(name, 'feature/100712-fix-login-redirect')
      assert.strictEqual(parseFeatureBranchName(name)?.vso, 100712)
    })
  })
})
