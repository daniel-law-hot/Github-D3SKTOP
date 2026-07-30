import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IntegrationBranchAliases,
  ProductionBranchAliases,
} from '../../../src/models/hotflow'

/**
 * The alias lists are load-bearing: every House of Travel repository uses
 * `develop`, while the Desktop fork itself uses `development`. Order matters
 * because the first match wins.
 */
describe('hotflow/branch aliases', () => {
  describe('IntegrationBranchAliases', () => {
    it('covers the names actually in use', () => {
      assert.ok(IntegrationBranchAliases.includes('develop'))
      assert.ok(IntegrationBranchAliases.includes('development'))
      assert.ok(IntegrationBranchAliases.includes('dev'))
    })

    it('prefers develop over development', () => {
      // Every HoT repository uses `develop`; only the fork uses `development`.
      assert.ok(
        IntegrationBranchAliases.indexOf('develop') <
          IntegrationBranchAliases.indexOf('development')
      )
    })

    it('tries dev last', () => {
      // A stray `dev` is far more likely to be a scratch branch than the real
      // integration branch, so it must never beat `develop` in a repo with both.
      assert.strictEqual(
        IntegrationBranchAliases.indexOf('dev'),
        IntegrationBranchAliases.length - 1
      )
    })
  })

  describe('ProductionBranchAliases', () => {
    it('prefers main over master', () => {
      assert.deepStrictEqual([...ProductionBranchAliases], ['main', 'master'])
    })
  })

  it('shares no names between the two lists', () => {
    // A branch that could be read as both integration and production would make
    // every measurement in the view meaningless.
    const overlap = IntegrationBranchAliases.filter(a =>
      ProductionBranchAliases.includes(a)
    )

    assert.deepStrictEqual(overlap, [])
  })
})
