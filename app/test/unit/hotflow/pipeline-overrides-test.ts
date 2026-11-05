import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IPipelineOverrides,
  NoPipelineOverrides,
  parseReleaseDefinitionId,
  pipelineIdsToRead,
  pipelineSource,
  withAddedPipeline,
  withHiddenPipeline,
  withRestoredPipeline,
  withoutAddedPipeline,
} from '../../../src/lib/hotflow/pipeline-overrides'

describe('hotflow/pipeline-overrides', () => {
  describe('parseReleaseDefinitionId', () => {
    it('takes a bare id', () => {
      assert.strictEqual(parseReleaseDefinitionId('165'), 165)
      assert.strictEqual(parseReleaseDefinitionId('  165  '), 165)
    })

    it('takes the address of the pipeline page', () => {
      assert.strictEqual(
        parseReleaseDefinitionId(
          'https://dev.azure.com/houseoftravel/Group/_release?definitionId=165'
        ),
        165
      )
    })

    it('finds the id among other parameters', () => {
      assert.strictEqual(
        parseReleaseDefinitionId(
          'https://dev.azure.com/o/p/_release?_a=releases&view=mine&definitionId=253'
        ),
        253
      )
      assert.strictEqual(
        parseReleaseDefinitionId(
          'https://dev.azure.com/o/p/_release?definitionId=77&_a=releases'
        ),
        77
      )
    })

    it('takes the API address', () => {
      assert.strictEqual(
        parseReleaseDefinitionId(
          'https://vsrm.dev.azure.com/houseoftravel/Group/_apis/release/definitions/165?api-version=7.1'
        ),
        165
      )
    })

    it('ignores case in the parameter name', () => {
      assert.strictEqual(
        parseReleaseDefinitionId('https://x/_release?DefinitionId=9'),
        9
      )
    })

    it('refuses a build definition, whose id is a different kind', () => {
      assert.strictEqual(
        parseReleaseDefinitionId(
          'https://dev.azure.com/o/p/_build?definitionId=165'
        ),
        null
      )
    })

    it('refuses what has no id', () => {
      assert.strictEqual(parseReleaseDefinitionId(''), null)
      assert.strictEqual(parseReleaseDefinitionId('RetailB2B'), null)
      assert.strictEqual(
        parseReleaseDefinitionId('https://dev.azure.com/o/p/_release'),
        null
      )
    })

    it('refuses nonsense numbers', () => {
      assert.strictEqual(parseReleaseDefinitionId('0'), null)
      assert.strictEqual(parseReleaseDefinitionId('-5'), null)
      assert.strictEqual(parseReleaseDefinitionId('1.5'), null)
      assert.strictEqual(parseReleaseDefinitionId('99999999999999'), null)
    })
  })

  describe('pipelineIdsToRead', () => {
    it('is what was found when nothing is overridden', () => {
      assert.deepStrictEqual(
        pipelineIdsToRead([165, 253], NoPipelineOverrides),
        [165, 253]
      )
    })

    it('adds the added, once, in order', () => {
      const o: IPipelineOverrides = {
        added: [
          { id: 300, label: null },
          { id: 165, label: null },
        ],
        hidden: [],
      }

      assert.deepStrictEqual(pipelineIdsToRead([253, 165], o), [165, 253, 300])
    })

    it('drops the hidden', () => {
      const o: IPipelineOverrides = {
        added: [],
        hidden: [{ id: 253, name: 'EU Geo' }],
      }

      assert.deepStrictEqual(pipelineIdsToRead([165, 253], o), [165])
    })

    it('reads an added one even if it was found and hidden', () => {
      const o: IPipelineOverrides = {
        added: [{ id: 253, label: null }],
        hidden: [{ id: 253, name: 'EU Geo' }],
      }

      assert.deepStrictEqual(pipelineIdsToRead([253], o), [253])
    })

    it('reads added ones when nothing was found, which is the point', () => {
      const o: IPipelineOverrides = {
        added: [{ id: 410, label: 'RetailB2B' }],
        hidden: [],
      }

      assert.deepStrictEqual(pipelineIdsToRead([], o), [410])
    })
  })

  describe('pipelineSource', () => {
    it('is found for one the lookup returned', () => {
      assert.strictEqual(
        pipelineSource(165, [165], NoPipelineOverrides),
        'found'
      )
    })

    it('is added for one it did not', () => {
      assert.strictEqual(
        pipelineSource(
          410,
          [165],
          withAddedPipeline(NoPipelineOverrides, 410, null)
        ),
        'added'
      )
    })

    it('is added when someone added one the lookup also found', () => {
      assert.strictEqual(
        pipelineSource(
          165,
          [165],
          withAddedPipeline(NoPipelineOverrides, 165, null)
        ),
        'added'
      )
    })
  })

  describe('editing', () => {
    it('adding replaces an earlier addition and un-hides it', () => {
      const first = withHiddenPipeline(
        withAddedPipeline(NoPipelineOverrides, 5, 'old'),
        6,
        'Six'
      )
      const next = withAddedPipeline(first, 6, 'new')

      assert.deepStrictEqual(next.added, [
        { id: 5, label: 'old' },
        { id: 6, label: 'new' },
      ])
      assert.deepStrictEqual(next.hidden, [])
    })

    it('hiding drops an addition of the same pipeline', () => {
      const next = withHiddenPipeline(
        withAddedPipeline(NoPipelineOverrides, 5, null),
        5,
        'Five'
      )

      assert.deepStrictEqual(next.added, [])
      assert.deepStrictEqual(next.hidden, [{ id: 5, name: 'Five' }])
    })

    it('removing an addition leaves the hidden alone', () => {
      const o = withHiddenPipeline(
        withAddedPipeline(NoPipelineOverrides, 5, null),
        9,
        'Nine'
      )
      const next = withoutAddedPipeline(o, 5)

      assert.deepStrictEqual(next.added, [])
      assert.deepStrictEqual(next.hidden, [{ id: 9, name: 'Nine' }])
    })

    it('restoring brings a hidden pipeline back', () => {
      const next = withRestoredPipeline(
        withHiddenPipeline(NoPipelineOverrides, 9, 'Nine'),
        9
      )

      assert.deepStrictEqual(next.hidden, [])
    })

    it('does not change what it was given', () => {
      const before = withAddedPipeline(NoPipelineOverrides, 5, null)

      withHiddenPipeline(before, 5, 'Five')

      assert.deepStrictEqual(before.added, [{ id: 5, label: null }])
      assert.deepStrictEqual(before.hidden, [])
    })
  })
})
