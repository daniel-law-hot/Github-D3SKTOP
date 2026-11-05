import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  distinctReleases,
  maxEarlierReleases,
} from '../../../src/ui/hotflow/release-pipeline'
import {
  IPipelineRelease,
  IRepositoryPipeline,
} from '../../../src/lib/hotflow/ado-pipelines'

function release(
  id: number,
  version: string | null,
  name = `Api ${version}`
): IPipelineRelease {
  return { id, name, version, createdOn: '2026-10-01T00:00:00Z', stages: [] }
}

describe('hotflow/release-pipeline', () => {
  describe('distinctReleases', () => {
    it('keeps the newest attempt of a version', () => {
      const result = distinctReleases([
        release(30, '1.2026.24'),
        release(29, '1.2026.24'),
        release(28, '1.2026.23'),
      ])

      assert.deepStrictEqual(
        result.map(r => r.id),
        [30, 28]
      )
    })

    it('keeps order', () => {
      const result = distinctReleases([
        release(3, '1.2026.26'),
        release(2, '1.2026.25'),
        release(1, '1.2026.24'),
      ])

      assert.deepStrictEqual(
        result.map(r => r.id),
        [3, 2, 1]
      )
    })

    it('tells releases with no parsed version apart by name', () => {
      const result = distinctReleases([
        release(2, null, 'Nightly A'),
        release(1, null, 'Nightly B'),
      ])

      assert.strictEqual(result.length, 2)
    })

    it('handles none', () => {
      assert.deepStrictEqual(distinctReleases([]), [])
    })
  })

  describe('maxEarlierReleases', () => {
    const pipeline = (
      versions: ReadonlyArray<string>
    ): IRepositoryPipeline => ({
      definitionId: 1,
      name: 'Api',
      releases: versions.map((v, i) => release(i + 1, v)),
    })

    it('is one fewer than the distinct versions, since the newest is current', () => {
      assert.strictEqual(
        maxEarlierReleases([pipeline(['1.2026.26', '1.2026.25', '1.2026.24'])]),
        2
      )
    })

    it('counts a redeployed version once', () => {
      assert.strictEqual(
        maxEarlierReleases([pipeline(['1.2026.26', '1.2026.26', '1.2026.25'])]),
        1
      )
    })

    it('takes the pipeline with the most', () => {
      assert.strictEqual(
        maxEarlierReleases([
          pipeline(['1.2026.26']),
          pipeline(['1.2026.26', '1.2026.25', '1.2026.24', '1.2026.23']),
        ]),
        3
      )
    })

    it('is none for no pipelines or one release', () => {
      assert.strictEqual(maxEarlierReleases([]), 0)
      assert.strictEqual(maxEarlierReleases([pipeline(['1.2026.26'])]), 0)
    })
  })
})
