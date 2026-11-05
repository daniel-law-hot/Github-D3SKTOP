import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  approveReleaseStage,
  bucketForStage,
  clearPipelineCache,
  getRepositoryPipelines,
  IPipelineStage,
  parseReleaseVersion,
  stageTone,
} from '../../../src/lib/hotflow/ado-pipelines'
import { AdoError } from '../../../src/lib/hotflow/ado-client'
import { AdoCredential } from '../../../src/lib/hotflow/ado-auth'

const config = { organisation: 'houseoftravel', project: 'Group' }
const credential: AdoCredential = { kind: 'pat', token: 'secret' }

function stage(
  status: string,
  approval: IPipelineStage['approval'] = null
): IPipelineStage {
  return {
    name: 'DEV',
    bucket: 'dev',
    status,
    completedOn: null,
    approval,
  }
}

interface ICall {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

/** Replaces fetch with canned answers chosen by URL, recording what was asked. */
function stubFetch(
  answer: (url: string, init: RequestInit) => { status?: number; body: unknown }
): Array<ICall> {
  const calls: Array<ICall> = []

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : null,
    })

    const { status = 200, body } = answer(url, init)

    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch

  return calls
}

describe('hotflow/ado-pipelines', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    clearPipelineCache()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  describe('bucketForStage', () => {
    it('sorts the stage names a pipeline actually uses', () => {
      assert.strictEqual(bucketForStage('DEV'), 'dev')
      assert.strictEqual(bucketForStage('Dev'), 'dev')
      assert.strictEqual(bucketForStage('UAT'), 'uat')
      assert.strictEqual(bucketForStage('UAT-LAN'), 'uat')
      assert.strictEqual(bucketForStage('UAT DMZ'), 'uat')
      assert.strictEqual(bucketForStage('Prod'), 'prod')
      assert.strictEqual(bucketForStage('PROD LAN'), 'prod')
      assert.strictEqual(bucketForStage('Prod-DMZ'), 'prod')
    })

    it('puts pre-prod with prod rather than uat or dev', () => {
      assert.strictEqual(bucketForStage('Pre-Prod'), 'prod')
    })

    it('leaves a stage that is none of them unbucketed', () => {
      assert.strictEqual(bucketForStage('Sandbox'), null)
    })
  })

  describe('parseReleaseVersion', () => {
    it('reads the version out of a release name', () => {
      assert.strictEqual(
        parseReleaseVersion('ContentOrchestrationApi 1.2026.26.28923'),
        '1.2026.26'
      )
    })

    it('ignores a retry suffix', () => {
      assert.strictEqual(
        parseReleaseVersion(
          'ContentOrchestrationApi 1.2026.26.28923 - Attempt 1'
        ),
        '1.2026.26'
      )
    })

    it('is null when the name carries no version', () => {
      assert.strictEqual(parseReleaseVersion('Release-42'), null)
    })
  })

  describe('stageTone', () => {
    it('calls a succeeded stage done', () => {
      assert.deepStrictEqual(stageTone(stage('succeeded')), {
        tone: 'ok',
        label: 'done',
      })
    })

    it('calls a running stage deploying', () => {
      assert.deepStrictEqual(stageTone(stage('inProgress')), {
        tone: 'run',
        label: 'deploying',
      })
    })

    it('calls a stage with an approval waiting, whatever it says itself', () => {
      // A stage waiting for sign-off reports inProgress. The approval is what
      // says it is waiting on a person, not running.
      const approval = { id: 7, type: 'postDeploy' as const }

      assert.deepStrictEqual(stageTone(stage('inProgress', approval)), {
        tone: 'wait',
        label: 'approve…',
      })
      assert.strictEqual(
        stageTone(stage('succeeded', { id: 7, type: 'preDeploy' })).tone,
        'wait'
      )
    })

    it('calls failures failed', () => {
      for (const status of ['failed', 'rejected', 'partiallySucceeded']) {
        assert.deepStrictEqual(stageTone(stage(status)), {
          tone: 'bad',
          label: 'failed',
        })
      }
    })

    it('calls nothing having happened not deployed', () => {
      for (const status of ['notDeployed', 'notStarted', 'canceled']) {
        assert.deepStrictEqual(stageTone(stage(status)), {
          tone: 'idle',
          label: 'not deployed',
        })
      }
    })
  })

  describe('getRepositoryPipelines', () => {
    function pipelineApi(
      releases: unknown,
      approvals: unknown
    ): (url: string) => { status?: number; body: unknown } {
      return url => {
        if (url.includes('/build/definitions')) {
          return { body: { value: [{ id: 10 }] } }
        }
        if (url.includes('/_apis/projects/')) {
          return { body: { id: 'project-guid' } }
        }
        if (url.includes('/release/definitions?')) {
          return { body: { value: [{ id: 165 }] } }
        }
        if (url.includes('/release/definitions/165')) {
          return { body: { name: 'ContentOrchestrationApi' } }
        }
        if (url.includes('/release/releases?')) {
          return { body: { value: releases } }
        }
        if (url.includes('/release/approvals')) {
          return { body: { value: approvals } }
        }
        return { status: 404, body: {} }
      }
    }

    const releases = [
      {
        id: 502,
        name: 'ContentOrchestrationApi 1.2026.27.30001',
        createdOn: '2026-11-05T01:00:00Z',
        environments: [
          { name: 'PROD', status: 'notStarted', rank: 3 },
          { name: 'DEV', status: 'inProgress', rank: 1 },
          { name: 'UAT', status: 'notStarted', rank: 2 },
        ],
      },
      {
        id: 501,
        name: 'ContentOrchestrationApi 1.2026.26.28923 - Attempt 1',
        createdOn: '2026-11-03T01:00:00Z',
        environments: [
          {
            name: 'DEV',
            status: 'succeeded',
            modifiedOn: '2026-11-03T02:00:00Z',
            rank: 1,
          },
          { name: 'UAT', status: 'inProgress', rank: 2 },
          {
            name: 'PROD',
            status: 'notStarted',
            modifiedOn: '0001-01-01',
            rank: 3,
          },
        ],
      },
    ]

    it('joins the pending approval onto the stage it holds up', async () => {
      stubFetch(
        pipelineApi(releases, [
          {
            id: 9001,
            approvalType: 'postDeploy',
            release: { id: 502 },
            releaseDefinition: { id: 165 },
            releaseEnvironment: { name: 'DEV' },
          },
        ])
      )

      const pipelines = await getRepositoryPipelines(
        config,
        credential,
        'house-of-travel',
        'ContentOrchestration',
        6
      )

      assert.strictEqual(pipelines.length, 1)
      assert.strictEqual(pipelines[0].name, 'ContentOrchestrationApi')

      const [newest, older] = pipelines[0].releases

      assert.strictEqual(newest.version, '1.2026.27')
      assert.deepStrictEqual(
        newest.stages.map(s => [s.name, s.approval]),
        [
          ['DEV', { id: 9001, type: 'postDeploy' }],
          ['UAT', null],
          ['PROD', null],
        ]
      )

      // The approval is on release 502; the older release's DEV is not blocked.
      assert.strictEqual(older.version, '1.2026.26')
      assert.ok(older.stages.every(s => s.approval === null))
    })

    it('orders stages dev, uat, prod whatever order they came in', async () => {
      stubFetch(pipelineApi(releases, []))

      const [pipeline] = await getRepositoryPipelines(
        config,
        credential,
        'house-of-travel',
        'ContentOrchestration',
        6
      )

      assert.deepStrictEqual(
        pipeline.releases[0].stages.map(s => s.bucket),
        ['dev', 'uat', 'prod']
      )
    })

    it('treats a never-completed stage as having no completion time', async () => {
      stubFetch(pipelineApi(releases, []))

      const [pipeline] = await getRepositoryPipelines(
        config,
        credential,
        'house-of-travel',
        'ContentOrchestration',
        6
      )

      const [dev, , prod] = pipeline.releases[1].stages

      assert.strictEqual(dev.completedOn, '2026-11-03T02:00:00Z')
      assert.strictEqual(prod.completedOn, null)
    })

    it('asks for the limit it was given, with the stages expanded', async () => {
      const calls = stubFetch(pipelineApi(releases, []))

      await getRepositoryPipelines(
        config,
        credential,
        'house-of-travel',
        'ContentOrchestration',
        4
      )

      const asked = calls.find(c => c.url.includes('/release/releases?'))

      assert.ok(asked !== undefined)
      assert.ok(
        asked.url.startsWith('https://vsrm.dev.azure.com/houseoftravel/Group/')
      )
      assert.ok(asked.url.includes('%24top=4'))
      assert.ok(asked.url.includes('%24expand=environments'))
    })

    it('returns nothing for a repository with no pipeline', async () => {
      stubFetch(url =>
        url.includes('/build/definitions')
          ? { body: { value: [] } }
          : { status: 404, body: {} }
      )

      const pipelines = await getRepositoryPipelines(
        config,
        credential,
        'house-of-travel',
        'SomethingElse',
        6
      )

      assert.deepStrictEqual(pipelines, [])
    })

    it('reports a token that cannot read pipelines as an auth failure', async () => {
      stubFetch(() => ({ status: 403, body: {} }))

      await assert.rejects(
        getRepositoryPipelines(
          config,
          credential,
          'house-of-travel',
          'ContentOrchestration',
          6
        ),
        (e: unknown) => e instanceof AdoError && e.isAuthFailure
      )
    })
  })

  describe('approveReleaseStage', () => {
    it('sends an approval as a PATCH to the approvals endpoint', async () => {
      const calls = stubFetch(() => ({ body: {} }))

      await approveReleaseStage(
        config,
        credential,
        9001,
        'Approved from HotFlow'
      )

      assert.strictEqual(calls.length, 1)
      assert.strictEqual(calls[0].method, 'PATCH')
      assert.strictEqual(
        calls[0].url,
        'https://vsrm.dev.azure.com/houseoftravel/Group/_apis/release/approvals/9001?api-version=7.1'
      )
      assert.deepStrictEqual(JSON.parse(calls[0].body ?? ''), {
        status: 'approved',
        comments: 'Approved from HotFlow',
      })
    })

    it('surfaces the reason Azure DevOps gives for refusing', async () => {
      stubFetch(() => ({
        status: 400,
        body: {
          message:
            'The release creator is not allowed to approve this release.',
        },
      }))

      await assert.rejects(
        approveReleaseStage(config, credential, 9001, 'ok'),
        (e: unknown) =>
          e instanceof AdoError &&
          e.message ===
            'The release creator is not allowed to approve this release.' &&
          e.status === 400 &&
          !e.isAuthFailure
      )
    })

    it('treats a 403 as a refusal to approve, not a bad credential', async () => {
      stubFetch(() => ({
        status: 403,
        body: { message: 'You are not an approver for this stage.' },
      }))

      await assert.rejects(
        approveReleaseStage(config, credential, 9001, 'ok'),
        (e: unknown) =>
          e instanceof AdoError &&
          e.message === 'You are not an approver for this stage.' &&
          !e.isAuthFailure
      )
    })

    it('falls back to the status when the body says nothing', async () => {
      stubFetch(() => ({ status: 500, body: {} }))

      await assert.rejects(
        approveReleaseStage(config, credential, 9001, 'ok'),
        (e: unknown) => e instanceof AdoError && e.message.includes('500')
      )
    })

    it('does not retry a write that failed', async () => {
      const calls = stubFetch(() => ({ status: 500, body: {} }))

      await approveReleaseStage(config, credential, 9001, 'ok').catch(
        () => undefined
      )

      assert.strictEqual(calls.length, 1)
    })

    it('drops the cached deployments, so the panel reads what changed', async () => {
      let releaseReads = 0

      stubFetch(url => {
        if (url.includes('/release/approvals/')) {
          return { body: {} }
        }
        if (url.includes('/build/definitions')) {
          return { body: { value: [{ id: 10 }] } }
        }
        if (url.includes('/_apis/projects/')) {
          return { body: { id: 'g' } }
        }
        if (url.includes('/release/definitions?')) {
          return { body: { value: [{ id: 165 }] } }
        }
        if (url.includes('/release/definitions/165')) {
          return { body: { name: 'P' } }
        }
        if (url.includes('/release/releases?')) {
          releaseReads++
          return { body: { value: [] } }
        }
        return { body: { value: [] } }
      })

      const read = () => getRepositoryPipelines(config, credential, 'o', 'r', 6)

      await read()
      await read()
      assert.strictEqual(releaseReads, 1, 'second read comes from the cache')

      await approveReleaseStage(config, credential, 1, 'ok')
      await read()
      assert.strictEqual(releaseReads, 2, 'approving drops the cache')
    })
  })
})
