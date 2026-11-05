import {
  AdoCredential,
  getAdoCredential,
  getAuthorizationHeader,
  invalidateCachedBearer,
} from './ado-auth'
import { AdoError, IAdoConfig } from './ado-client'

/**
 * Where a repository's code has actually got to, and the one write that moves it
 * on: approving a stage that is waiting for sign-off.
 *
 * House of Travel deploys through classic Azure DevOps release pipelines, whose
 * stages are already named DEV, UAT and Prod. The release picture HotFlow draws
 * from git says what *would* ship; a stage says what did.
 *
 * Ported from the standalone HotFlow app, with two changes: it reads the last few
 * releases of each pipeline rather than the one release on screen, and each stage
 * that is waiting on a person carries the id of the approval, which is what
 * `approveReleaseStage` needs.
 */

/** How long a definition lookup stays fresh. Pipelines are reorganised rarely. */
const DefinitionCacheMs = 30 * 60 * 1000

/** How long a deployment answer stays fresh. This is the part that moves. */
const DeploymentCacheMs = 60 * 1000

const RequestTimeoutMs = 20 * 1000

const ApiVersion = '7.1'

/** The three columns every stage is sorted into. */
export type StageBucket = 'dev' | 'uat' | 'prod'

const BucketOrder: ReadonlyArray<StageBucket> = ['dev', 'uat', 'prod']

/**
 * Which bucket a stage name belongs to, or null when it is none of them.
 *
 * Matched on a normalised name so `UAT-LAN`, `UAT DMZ` and `uat` all land
 * together. Production is checked first because "pre-prod" contains both words
 * and belongs with prod; unmatched stages are not guessed into a bucket, since a
 * stage called "Sandbox" is a different question, not a lower environment.
 */
export function bucketForStage(name: string): StageBucket | null {
  const normalised = name.toLowerCase().replace(/[^a-z]/g, '')

  if (normalised.includes('prod')) {
    return 'prod'
  }

  if (normalised.includes('uat') || normalised.includes('test')) {
    return 'uat'
  }

  if (normalised.includes('dev')) {
    return 'dev'
  }

  return null
}

/** An approval waiting on someone, attached to the stage it is holding up. */
export interface IStageApproval {
  readonly id: number

  /**
   * `preDeploy` means the stage has not started; `postDeploy` means it deployed
   * and is waiting for sign-off before the next stage.
   */
  readonly type: 'preDeploy' | 'postDeploy'
}

export interface IPipelineStage {
  readonly name: string
  readonly bucket: StageBucket | null

  /**
   * Azure DevOps' own word for it: `succeeded`, `inProgress`, `notStarted`,
   * `notDeployed`, `failed`, `partiallySucceeded`, `canceled`, `rejected`.
   *
   * Kept raw, because the UI wants to tell "nothing has been sent here" from
   * "something went wrong" and any mapping would have to invent that line.
   */
  readonly status: string

  /** Null while the stage has not finished. */
  readonly completedOn: string | null

  /** Set only while somebody is being waited on. */
  readonly approval: IStageApproval | null
}

export interface IPipelineRelease {
  readonly id: number

  /** The release's own name, `ContentOrchestrationApi 1.2026.26.28923`. */
  readonly name: string

  /** `1.2026.26`, or null when the name carries no version. */
  readonly version: string | null

  readonly createdOn: string

  /** Ordered dev, uat, prod, then anything that fits none of them. */
  readonly stages: ReadonlyArray<IPipelineStage>
}

export interface IRepositoryPipeline {
  readonly definitionId: number
  readonly name: string

  /** Newest first. */
  readonly releases: ReadonlyArray<IPipelineRelease>
}

/**
 * The version in a release name.
 *
 * Azure DevOps embeds it in the name — `ContentOrchestrationApi 1.2026.26.28923
 * - Attempt 1` — as `major.year.cycle` followed by the build number, and there is
 * no field that holds it on its own. The build number is dropped, which means a
 * hotfix such as `1.2026.16.1` is indistinguishable from build `1` of 1.2026.16
 * here; the callers match on the three-part version.
 */
export function parseReleaseVersion(name: string): string | null {
  const match = /(?:^|[^\d.])(\d+\.\d{4}\.\d+)(?![\d])/.exec(name)

  return match === null ? null : match[1]
}

export type StageTone = 'ok' | 'run' | 'wait' | 'bad' | 'idle'

/** How a stage should be drawn, and the word to put on it. */
export function stageTone(stage: IPipelineStage): {
  readonly tone: StageTone
  readonly label: string
} {
  // A waiting stage reads as `inProgress` in the release itself, so the
  // approval is what says it is waiting on a person rather than running.
  if (stage.approval !== null) {
    return { tone: 'wait', label: 'approve…' }
  }

  switch (stage.status) {
    case 'succeeded':
      return { tone: 'ok', label: 'done' }
    case 'inProgress':
      return { tone: 'run', label: 'deploying' }
    case 'failed':
    case 'rejected':
    case 'partiallySucceeded':
      return { tone: 'bad', label: 'failed' }
    default:
      // notDeployed, notStarted, canceled and anything Azure DevOps adds later:
      // nothing is running there, and calling it an error would be a guess.
      return { tone: 'idle', label: 'not deployed' }
  }
}

interface ICacheEntry<T> {
  readonly value: T
  readonly storedAt: number
}

const definitionCache = new Map<string, ICacheEntry<ReadonlyArray<number>>>()
const pipelineCache = new Map<string, ICacheEntry<IRepositoryPipeline>>()
let approvalCache: ICacheEntry<ReadonlyArray<IPendingApproval>> | null = null
let projectIdCache: string | null = null

/** Drops everything, so the next read hits the network. */
export function clearPipelineCache(): void {
  definitionCache.clear()
  pipelineCache.clear()
  approvalCache = null
  projectIdCache = null
}

/**
 * Drops only what a deployment answer is built from.
 *
 * The definitions are untouched: approving a stage changes what is running, not
 * which pipelines a repository has.
 */
export function clearDeploymentCache(): void {
  pipelineCache.clear()
  approvalCache = null
}

function isFresh<T>(
  entry: ICacheEntry<T> | undefined | null,
  ttl: number
): entry is ICacheEntry<T> {
  return (
    entry !== undefined && entry !== null && Date.now() - entry.storedAt < ttl
  )
}

function vsrmBase(config: IAdoConfig): string {
  return (
    `https://vsrm.dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `${encodeURIComponent(config.project)}/_apis`
  )
}

function devBase(config: IAdoConfig): string {
  return (
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `${encodeURIComponent(config.project)}/_apis`
  )
}

/**
 * One request, with one retry on a different credential after an auth failure.
 *
 * The same shape as the work item client's: a credential the organisation
 * refuses — an Azure CLI bearer it will never accept — teaches
 * `getAdoCredential` to reach for the personal access token instead, so
 * re-resolving once after the refusal turns a dead feature into a working one.
 * Only auth failures retry, and only once.
 */
async function withCredentialRetry<T>(
  organisation: string,
  credential: AdoCredential,
  send: (credential: AdoCredential) => Promise<T>
): Promise<T> {
  try {
    return await send(credential)
  } catch (e) {
    if (!(e instanceof AdoError) || !e.isAuthFailure) {
      throw e
    }

    const replacement = await getAdoCredential(organisation)

    if (replacement === null || replacement.token === credential.token) {
      throw e
    }

    return await send(replacement)
  }
}

/** The message Azure DevOps put in an error body, when it put one. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown }

    return typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim()
      : null
  } catch {
    return null
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RequestTimeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AdoError('Azure DevOps request timed out.', null, false)
    }

    throw new AdoError(e instanceof Error ? e.message : String(e), null, false)
  } finally {
    clearTimeout(timeout)
  }
}

/** A read. Null for anything but success, so a missing pipeline is not an error. */
async function getJson<T>(
  url: string,
  credential: AdoCredential
): Promise<T | null> {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      Authorization: getAuthorizationHeader(credential),
    },
  })

  // A token scoped to work items and nothing else is refused here. Not a failure
  // worth surfacing beyond saying so: it means this feature is off for them.
  if (response.status === 401 || response.status === 403) {
    invalidateCachedBearer()
    throw new AdoError(
      'This Azure DevOps token cannot read pipelines. Release (read) and ' +
        'Build (read) scopes are needed.',
      response.status,
      true
    )
  }

  if (response.status === 203) {
    invalidateCachedBearer()
    throw new AdoError(
      'Azure DevOps returned a sign-in page instead of data.',
      203,
      true
    )
  }

  if (!response.ok) {
    return null
  }

  return (await response.json()) as T
}

interface IPendingApproval {
  readonly id: number
  readonly definitionId: number
  readonly releaseId: number
  readonly stage: string
  readonly type: 'preDeploy' | 'postDeploy'
}

/**
 * Every approval waiting on someone, across the whole project.
 *
 * One request for all of it: the endpoint has no per-definition filter worth
 * using, and the answer is the same for every repository on screen.
 */
async function getPendingApprovals(
  config: IAdoConfig,
  credential: AdoCredential
): Promise<ReadonlyArray<IPendingApproval>> {
  if (isFresh(approvalCache, DeploymentCacheMs)) {
    return approvalCache.value
  }

  const answer = await withCredentialRetry(config.organisation, credential, c =>
    getJson<{
      value?: Array<{
        id?: number
        approvalType?: string
        release?: { id?: number }
        releaseDefinition?: { id?: number }
        releaseEnvironment?: { name?: string }
      }>
    }>(
      `${vsrmBase(config)}/release/approvals?api-version=${ApiVersion}` +
        `&statusFilter=pending&%24top=200`,
      c
    )
  )

  const approvals: Array<IPendingApproval> = []

  for (const approval of answer?.value ?? []) {
    const id = approval.id
    const definitionId = approval.releaseDefinition?.id
    const releaseId = approval.release?.id
    const stage = approval.releaseEnvironment?.name
    const type = approval.approvalType

    if (
      id === undefined ||
      definitionId === undefined ||
      releaseId === undefined ||
      stage === undefined ||
      (type !== 'preDeploy' && type !== 'postDeploy')
    ) {
      continue
    }

    approvals.push({ id, definitionId, releaseId, stage, type })
  }

  approvalCache = { value: approvals, storedAt: Date.now() }

  return approvals
}

/**
 * The project's guid, which the artifact filter needs.
 *
 * An artifact source is identified as `{projectId}:{buildDefinitionId}`, and the
 * project is addressed by name everywhere else, so this is the one place the guid
 * is required. Fetched once.
 */
async function getProjectId(
  config: IAdoConfig,
  credential: AdoCredential
): Promise<string | null> {
  if (projectIdCache !== null) {
    return projectIdCache
  }

  const project = await withCredentialRetry(
    config.organisation,
    credential,
    c =>
      getJson<{ id?: string }>(
        `https://dev.azure.com/${encodeURIComponent(
          config.organisation
        )}/_apis/projects/${encodeURIComponent(
          config.project
        )}?api-version=${ApiVersion}`,
        c
      )
  )

  projectIdCache = project?.id ?? null

  return projectIdCache
}

/**
 * Which release definitions deploy a repository.
 *
 * Repository → build definition → release definition, three requests however big
 * the project is. The join has to go through the build definition: names do not
 * line up — release definition 165 is "ContentOrchestrationApi" and its artifact
 * is listed as "BookingOrchestrationApi" — so matching on names would quietly
 * pair the wrong pipeline with the wrong repository.
 */
async function findDefinitionIds(
  config: IAdoConfig,
  credential: AdoCredential,
  owner: string,
  repository: string
): Promise<ReadonlyArray<number>> {
  const key = `${owner}/${repository}`.toLowerCase()
  const cached = definitionCache.get(key)

  if (isFresh(cached, DefinitionCacheMs)) {
    return cached.value
  }

  const builds = await withCredentialRetry(config.organisation, credential, c =>
    getJson<{ value?: Array<{ id: number }> }>(
      `${devBase(config)}/build/definitions?api-version=${ApiVersion}` +
        `&repositoryType=GitHub` +
        `&repositoryId=${encodeURIComponent(`${owner}/${repository}`)}`,
      c
    )
  )

  const buildIds = (builds?.value ?? []).map(d => d.id)

  if (buildIds.length === 0) {
    definitionCache.set(key, { value: [], storedAt: Date.now() })

    return []
  }

  const projectId = await getProjectId(config, credential)

  if (projectId === null) {
    return []
  }

  const found = new Set<number>()

  // One request per build definition. Repositories have one or two, so this is
  // not the loop worth optimising.
  for (const buildId of buildIds) {
    const releases = await withCredentialRetry(
      config.organisation,
      credential,
      c =>
        getJson<{ value?: Array<{ id: number }> }>(
          `${vsrmBase(config)}/release/definitions?api-version=${ApiVersion}` +
            `&artifactType=Build` +
            `&artifactSourceId=${encodeURIComponent(
              `${projectId}:${buildId}`
            )}`,
          c
        )
    )

    for (const definition of releases?.value ?? []) {
      found.add(definition.id)
    }
  }

  const ids = [...found].sort((a, b) => a - b)
  definitionCache.set(key, { value: ids, storedAt: Date.now() })

  return ids
}

interface IReleaseEnvironment {
  readonly name?: string
  readonly status?: string
  readonly modifiedOn?: string
  readonly rank?: number
}

interface IReleaseListItem {
  readonly id: number
  readonly name?: string
  readonly createdOn?: string
  readonly environments?: ReadonlyArray<IReleaseEnvironment>
}

/**
 * Orders stages dev, uat, prod, with anything unmatched last.
 *
 * Stable within a bucket, so a pipeline with UAT-LAN and UAT-DMZ keeps them in
 * the order the pipeline runs them, which is the rank Azure DevOps reports.
 */
function orderStages(
  stages: ReadonlyArray<IPipelineStage>
): ReadonlyArray<IPipelineStage> {
  const position = (s: IPipelineStage) =>
    s.bucket === null ? BucketOrder.length : BucketOrder.indexOf(s.bucket)

  return stages
    .map((stage, index) => ({ stage, index }))
    .sort((a, b) => position(a.stage) - position(b.stage) || a.index - b.index)
    .map(e => e.stage)
}

function buildRelease(
  release: IReleaseListItem,
  approvals: ReadonlyArray<IPendingApproval>,
  definitionId: number
): IPipelineRelease {
  const name = release.name ?? String(release.id)

  const environments = [...(release.environments ?? [])].sort(
    (a, b) => (a.rank ?? 0) - (b.rank ?? 0)
  )

  const stages: Array<IPipelineStage> = []

  for (const environment of environments) {
    if (environment.name === undefined) {
      continue
    }

    // Approvals belong to the release they were raised on. Matching on the
    // release id as well as the stage is what stops an old release being shown
    // as blocked while a newer one waits for sign-off.
    const waiting = approvals.find(
      a =>
        a.definitionId === definitionId &&
        a.releaseId === release.id &&
        a.stage === environment.name
    )

    stages.push({
      name: environment.name,
      bucket: bucketForStage(environment.name),
      status: environment.status ?? 'notStarted',

      // Azure DevOps writes year 1 for something that never completed, which
      // would render as a date from antiquity.
      completedOn:
        environment.modifiedOn && !environment.modifiedOn.startsWith('0001')
          ? environment.modifiedOn
          : null,

      approval:
        waiting === undefined ? null : { id: waiting.id, type: waiting.type },
    })
  }

  return {
    id: release.id,
    name,
    version: parseReleaseVersion(name),
    createdOn: release.createdOn ?? '',
    stages: orderStages(stages),
  }
}

async function readPipeline(
  config: IAdoConfig,
  credential: AdoCredential,
  definitionId: number,
  limit: number
): Promise<IRepositoryPipeline | null> {
  const key = `${definitionId}@${limit}`
  const cached = pipelineCache.get(key)

  if (isFresh(cached, DeploymentCacheMs)) {
    return cached.value
  }

  const vsrm = vsrmBase(config)

  const [definition, list, approvals] = await Promise.all([
    withCredentialRetry(config.organisation, credential, c =>
      getJson<{ name?: string }>(
        `${vsrm}/release/definitions/${definitionId}?api-version=${ApiVersion}`,
        c
      )
    ),

    // Newest first, which is also what the API returns by default; asked for
    // outright so a change of default cannot reorder the panel.
    withCredentialRetry(config.organisation, credential, c =>
      getJson<{ value?: ReadonlyArray<IReleaseListItem> }>(
        `${vsrm}/release/releases?api-version=${ApiVersion}` +
          `&definitionId=${definitionId}&%24expand=environments` +
          `&queryOrder=descending&%24top=${Math.max(1, Math.floor(limit))}`,
        c
      )
    ),

    getPendingApprovals(config, credential),
  ])

  if (definition === null || list === null) {
    return null
  }

  const pipeline: IRepositoryPipeline = {
    definitionId,
    name: definition.name ?? String(definitionId),
    releases: (list.value ?? []).map(r =>
      buildRelease(r, approvals, definitionId)
    ),
  }

  pipelineCache.set(key, { value: pipeline, storedAt: Date.now() })

  return pipeline
}

/**
 * Every pipeline that deploys a repository, with its last `limit` releases.
 *
 * Best-effort by design: a repository with no pipeline, a token without the
 * scopes, or an organisation that deploys some other way all return an empty
 * list. The release picture stands on its own without this — it is an extra
 * panel, not a dependency. An auth failure after the credential retry is the one
 * thing that still throws, so the caller can offer to reconnect.
 */
export async function getRepositoryPipelines(
  config: IAdoConfig,
  credential: AdoCredential,
  owner: string,
  repository: string,
  limit: number
): Promise<ReadonlyArray<IRepositoryPipeline>> {
  const ids = await findDefinitionIds(config, credential, owner, repository)

  const pipelines = await Promise.all(
    ids.map(id => readPipeline(config, credential, id, limit))
  )

  return pipelines.filter((p): p is IRepositoryPipeline => p !== null)
}

/**
 * Approves a stage that is waiting for sign-off.
 *
 * The only write this module makes, and it moves a deployment on, so it is
 * deliberately plain: one PATCH, no retry except the credential refresh every
 * request in this client gets. Retrying a write that may have landed is how a
 * stage ends up approved twice, so a timeout or a server error is reported and
 * left for the person to look at.
 *
 * Azure DevOps explains a refusal in the body — "the release creator cannot
 * approve" — and that sentence is what the person needs, so it is carried as the
 * error's message rather than the status text. A 403 here is a refusal to
 * approve, not a bad credential, so it is not treated as an auth failure.
 */
export async function approveReleaseStage(
  config: IAdoConfig,
  credential: AdoCredential,
  approvalId: number,
  comment: string
): Promise<void> {
  const url =
    `${vsrmBase(config)}/release/approvals/${approvalId}` +
    `?api-version=${ApiVersion}`

  await withCredentialRetry(config.organisation, credential, async c => {
    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: getAuthorizationHeader(c),
      },
      body: JSON.stringify({ status: 'approved', comments: comment }),
    })

    if (response.status === 401 || response.status === 203) {
      invalidateCachedBearer()
      throw new AdoError(
        'Azure DevOps rejected the credentials.',
        response.status,
        true
      )
    }

    if (!response.ok) {
      const message = await readErrorMessage(response)

      throw new AdoError(
        message ??
          `Azure DevOps refused the approval (${response.status} ${response.statusText}).`,
        response.status,
        false
      )
    }
  })

  // The answer every cached pipeline was built from is now wrong.
  clearDeploymentCache()
}
