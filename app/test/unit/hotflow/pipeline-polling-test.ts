import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  FastPollMs,
  FastPollWindowMs,
  SlowPollMs,
  mergePipelineReleases,
  nextPollDelay,
} from '../../../src/lib/hotflow/pipeline-polling'
import {
  IPipelineRelease,
  IRepositoryPipeline,
} from '../../../src/lib/hotflow/ado-pipelines'

function release(id: number, version = '1.2026.26'): IPipelineRelease {
  return { id, name: `Api ${version}`, version, createdOn: '', stages: [] }
}

function pipeline(
  definitionId: number,
  releases: ReadonlyArray<IPipelineRelease>
): IRepositoryPipeline {
  return { definitionId, name: `Pipeline ${definitionId}`, releases }
}

describe('hotflow/pipeline-polling', () => {
  describe('nextPollDelay', () => {
    it('is five seconds, then a minute, as asked', () => {
      assert.strictEqual(FastPollMs, 5000)
      assert.strictEqual(SlowPollMs, 60000)
      assert.strictEqual(FastPollWindowMs, 10 * 60 * 1000)
    })

    it('is slow when nothing has happened', () => {
      assert.strictEqual(nextPollDelay(1000, null), SlowPollMs)
    })

    it('is fast until the burst ends', () => {
      const start = 1_000_000
      const until = start + FastPollWindowMs

      assert.strictEqual(nextPollDelay(start, until), FastPollMs)
      assert.strictEqual(nextPollDelay(until - 1, until), FastPollMs)
    })

    it('goes back to slow once the burst is over', () => {
      const until = 1_000_000 + FastPollWindowMs

      assert.strictEqual(nextPollDelay(until, until), SlowPollMs)
      assert.strictEqual(nextPollDelay(until + 1, until), SlowPollMs)
    })
  })

  describe('mergePipelineReleases', () => {
    it('replaces a release the poll saw', () => {
      const moved = { ...release(30), name: 'moved' }
      const merged = mergePipelineReleases(
        [pipeline(1, [release(30), release(29)])],
        [pipeline(1, [moved])]
      )

      assert.strictEqual(
        merged[0].releases.find(r => r.id === 30)?.name,
        'moved'
      )
    })

    it('keeps the earlier releases a short poll did not return', () => {
      const merged = mergePipelineReleases(
        [pipeline(1, [release(30), release(29), release(28)])],
        [pipeline(1, [release(31), release(30)])]
      )

      assert.deepStrictEqual(
        merged[0].releases.map(r => r.id),
        [31, 30, 29, 28]
      )
    })

    it('adds a pipeline it has not seen', () => {
      const merged = mergePipelineReleases(
        [pipeline(1, [release(5)])],
        [pipeline(1, [release(5)]), pipeline(2, [release(9)])]
      )

      assert.deepStrictEqual(
        merged.map(p => p.definitionId),
        [1, 2]
      )
    })

    it('keeps a pipeline the poll did not return', () => {
      const merged = mergePipelineReleases(
        [pipeline(1, [release(5)]), pipeline(2, [release(9)])],
        [pipeline(1, [release(6), release(5)])]
      )

      assert.deepStrictEqual(
        merged.map(p => p.definitionId),
        [1, 2]
      )
      assert.deepStrictEqual(
        merged[1].releases.map(r => r.id),
        [9]
      )
    })

    it('starts from nothing', () => {
      const merged = mergePipelineReleases([], [pipeline(1, [release(2)])])

      assert.strictEqual(merged.length, 1)
    })
  })
})
