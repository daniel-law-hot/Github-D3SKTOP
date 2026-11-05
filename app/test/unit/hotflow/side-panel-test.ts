import { describe, it } from 'node:test'
import assert from 'node:assert'
import { earlierCountForDrag } from '../../../src/ui/hotflow/side-panel'

describe('hotflow/side-panel', () => {
  describe('earlierCountForDrag', () => {
    it('stays put until the divider has moved far enough for a release', () => {
      assert.strictEqual(earlierCountForDrag(3, 10, 64, 10), 3)
    })

    it('adds a release once past halfway to the next row', () => {
      assert.strictEqual(earlierCountForDrag(3, 40, 64, 10), 4)
    })

    it('removes releases when dragged up', () => {
      assert.strictEqual(earlierCountForDrag(3, -130, 64, 10), 1)
    })

    it('never goes below none', () => {
      assert.strictEqual(earlierCountForDrag(1, -5000, 64, 10), 0)
    })

    it('never goes past what there is room or releases for', () => {
      assert.strictEqual(earlierCountForDrag(3, 5000, 64, 6), 6)
    })

    it('copes with no releases at all', () => {
      assert.strictEqual(earlierCountForDrag(0, 300, 64, 0), 0)
    })

    it('does not divide by nothing', () => {
      assert.strictEqual(earlierCountForDrag(2, 3, 0, 10), 5)
    })
  })
})
