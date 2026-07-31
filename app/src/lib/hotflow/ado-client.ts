import { IWorkItem } from '../../models/hotflow'
import { parseReleaseSequence } from './release-sequence'
import {
  AdoCredential,
  getAuthorizationHeader,
  invalidateCachedBearer,
} from './ado-auth'

/**
 * A very small Azure DevOps work item client — just enough for HotFlow's
 * "what's in this release" reconciliation.
 *
 * Note the host: `dev.azure.com`, never `houseoftravel.visualstudio.com`. The
 * latter serves a self-signed certificate that Electron's network stack rejects.
 */

export interface IAdoConfig {
  readonly organisation: string
  readonly project: string
}

export const defaultAdoConfig: IAdoConfig = {
  organisation: 'houseoftravel',
  project: 'Group',
}

const ApiVersion = '7.1'

/** Azure DevOps caps the work item batch endpoint at 200 ids per request. */
const MaxBatchSize = 200

/** How long a fetched result stays fresh before we'd re-request it. */
const CacheTtlMs = 5 * 60 * 1000

const RequestTimeoutMs = 20 * 1000

/** Thrown for responses we can distinguish, so the UI can react usefully. */
export class AdoError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null,
    /** True when the credential was rejected — prompts a reconnect. */
    public readonly isAuthFailure: boolean
  ) {
    super(message)
    this.name = 'AdoError'
  }
}

interface ICacheEntry<T> {
  readonly value: T
  readonly storedAt: number
}

const sequenceIdCache = new Map<string, ICacheEntry<ReadonlyArray<number>>>()
const workItemCache = new Map<number, ICacheEntry<IWorkItem>>()

function isFresh<T>(
  entry: ICacheEntry<T> | undefined
): entry is ICacheEntry<T> {
  return entry !== undefined && Date.now() - entry.storedAt < CacheTtlMs
}

/** Drops every cached response, so the next read hits the network. */
export function clearAdoCache(): void {
  sequenceIdCache.clear()
  workItemCache.clear()
}

async function postJson<T>(
  url: string,
  body: unknown,
  credential: AdoCredential
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RequestTimeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: getAuthorizationHeader(credential),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      // A stale bearer token is the likeliest cause; drop it so the next
      // attempt re-mints rather than replaying the same rejected credential.
      invalidateCachedBearer()
      throw new AdoError(
        'Azure DevOps rejected the credentials.',
        response.status,
        true
      )
    }

    // Azure DevOps answers an unauthenticated browser-ish request with an HTML
    // sign-in page and a 203, which would otherwise parse as garbage.
    if (response.status === 203) {
      invalidateCachedBearer()
      throw new AdoError(
        'Azure DevOps returned a sign-in page instead of data.',
        203,
        true
      )
    }

    if (!response.ok) {
      throw new AdoError(
        `Azure DevOps request failed (${response.status} ${response.statusText}).`,
        response.status,
        false
      )
    }

    return (await response.json()) as T
  } catch (e) {
    if (e instanceof AdoError) {
      throw e
    }

    if (e instanceof Error && e.name === 'AbortError') {
      throw new AdoError('Azure DevOps request timed out.', null, false)
    }

    throw new AdoError(e instanceof Error ? e.message : String(e), null, false)
  } finally {
    clearTimeout(timeout)
  }
}

interface IWiqlResponse {
  readonly workItems?: ReadonlyArray<{ readonly id: number }>
}

/**
 * The House of Travel field holding which release a work item belongs to.
 *
 * It shows as "Release sequence number" in a work item's Details, and holds the
 * `{year}{cycle:00}` value — 202617 for cycle 17 of 2026. It is a *number*, so
 * it's queried with equality rather than a string match.
 *
 * Not `System.Tags`: cycles were never recorded there. A real work item's tags
 * read like "CO Flights; Content Orchestration; DCPD; Phase 1" with no release
 * in sight, which is why a tag-based query found nothing.
 */
const ReleaseSequenceField = 'Custom.Releasesequencenumber'

/**
 * Returns the ids of every work item assigned to the given release sequence.
 *
 * WIQL only ever returns ids; detail comes from `getWorkItems`.
 */
export async function getWorkItemIdsForReleaseSequence(
  config: IAdoConfig,
  releaseSequence: number,
  credential: AdoCredential
): Promise<ReadonlyArray<number>> {
  // Interpolated into WIQL, so restrict it to exactly the shape expected.
  if (parseReleaseSequence(releaseSequence) === null) {
    throw new AdoError(
      `Invalid release sequence number: ${releaseSequence}`,
      null,
      false
    )
  }

  const sequence = releaseSequence
  const cacheKey = `${config.organisation}/${config.project}/${sequence}`
  const cached = sequenceIdCache.get(cacheKey)

  if (isFresh(cached)) {
    return cached.value
  }

  const url =
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `${encodeURIComponent(config.project)}/_apis/wit/wiql` +
    `?api-version=${ApiVersion}`

  const query =
    `SELECT [System.Id] FROM WorkItems ` +
    `WHERE [System.TeamProject] = '${config.project.replace(/'/g, "''")}' ` +
    `AND [${ReleaseSequenceField}] = ${sequence}`

  const response = await postJson<IWiqlResponse>(url, { query }, credential)

  const ids = (response.workItems ?? []).map(w => w.id)

  sequenceIdCache.set(cacheKey, { value: ids, storedAt: Date.now() })

  return ids
}

/** Exported alongside `extractLinkedCommitShas` so tests can build one. */
export interface IWorkItemRelation {
  readonly rel?: string
  readonly url?: string
  readonly attributes?: { readonly name?: string }
}

interface IWorkItemsBatchResponse {
  /**
   * Entries are `null` for ids Azure DevOps couldn't resolve — that's what
   * `errorPolicy: 'omit'` does instead of failing the batch. Typed as nullable so
   * the reader below has to account for them.
   */
  readonly value?: ReadonlyArray<{
    readonly id: number
    readonly fields?: Record<string, unknown>
    readonly relations?: ReadonlyArray<IWorkItemRelation>
  } | null>
}

/**
 * A GitHub commit link on a work item, as Azure DevOps stores it:
 *
 *   vstfs:///GitHub/Commit/<repo-guid>%2f<sha>
 *
 * Note the `%2f`. The separator between the repository guid and the sha is
 * percent-encoded in the stored value, unlike the slashes before it — a regex
 * expecting a literal slash there matches nothing at all, silently, and every
 * work item ends up looking like it has no commit links. The alternation keeps
 * both forms accepted in case the encoding ever changes.
 *
 * The guid identifies the repository, but nothing exposes a guid-to-name map —
 * `githubconnections/{id}/repos` returns names with the ids blank — so the sha is
 * the usable half. Resolving it against a local object database answers "is this
 * commit in this repository" without needing the guid at all.
 */
const gitHubCommitArtifactRegex =
  /^vstfs:\/{3}GitHub\/Commit\/[^/%]+(?:%2f|\/)([0-9a-f]{7,40})$/i

/**
 * Pulls the commit SHAs out of a work item's Development links.
 *
 * Exported for testing. Getting the `%2f` above wrong returns an empty list for
 * every work item rather than failing, which reads downstream as "nobody has
 * started any of this" — so the parsing is worth pinning down.
 */
export function extractLinkedCommitShas(
  relations: ReadonlyArray<IWorkItemRelation> | undefined
): ReadonlyArray<string> {
  if (relations === undefined) {
    return []
  }

  const shas = new Set<string>()

  for (const relation of relations) {
    if (relation.rel !== 'ArtifactLink' || relation.url === undefined) {
      continue
    }

    const match = gitHubCommitArtifactRegex.exec(relation.url)

    if (match !== null) {
      shas.add(match[1].toLowerCase())
    }
  }

  return [...shas]
}

function readStringField(
  fields: Record<string, unknown> | undefined,
  name: string
): string | null {
  const value = fields?.[name]

  if (typeof value === 'string') {
    return value
  }

  // Identity fields come back as objects with a displayName.
  if (value !== null && typeof value === 'object') {
    const displayName = (value as { displayName?: unknown }).displayName
    if (typeof displayName === 'string') {
      return displayName
    }
  }

  return null
}

/** Reads a numeric field, tolerating the API returning it as a string. */
function readNumberField(
  fields: Record<string, unknown> | undefined,
  name: string
): number | null {
  const value = fields?.[name]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10)
  }

  return null
}

/**
 * Fetches detail for the given work item ids, chunked to the API's limit.
 *
 * Ids that Azure DevOps doesn't return (deleted, or in another project) are
 * simply absent from the result — callers show the bare number for those.
 */
export async function getWorkItems(
  config: IAdoConfig,
  ids: ReadonlyArray<number>,
  credential: AdoCredential
): Promise<ReadonlyMap<number, IWorkItem>> {
  const result = new Map<number, IWorkItem>()
  const needed: Array<number> = []

  for (const id of new Set(ids)) {
    const cached = workItemCache.get(id)
    if (isFresh(cached)) {
      result.set(id, cached.value)
    } else {
      needed.push(id)
    }
  }

  if (needed.length === 0) {
    return result
  }

  const url =
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `_apis/wit/workitemsbatch?api-version=${ApiVersion}`

  for (let i = 0; i < needed.length; i += MaxBatchSize) {
    const chunk = needed.slice(i, i + MaxBatchSize)

    // `$expand` and an explicit `fields` list are mutually exclusive — asking for
    // both is a 400 — so this takes every field in exchange for the relations,
    // which are the only thing that says which repository a work item belongs to.
    //
    // `errorPolicy: 'omit'` is not optional. Without it a single id that Azure
    // DevOps can't resolve makes the *whole batch* 404, so one stray number in one
    // commit message wipes out the detail for every work item alongside it. VSO
    // numbers are read out of commit text, so stray numbers are a matter of when,
    // not if — HOTWebsites' 1.2026.10 carries a `1004496` that took the other nine
    // work items down with it.
    const response = await postJson<IWorkItemsBatchResponse>(
      url,
      { ids: chunk, $expand: 'relations', errorPolicy: 'omit' },
      credential
    )

    for (const item of response.value ?? []) {
      // An id that didn't resolve. The caller shows the bare number for it, which
      // is the honest outcome — we asked and Azure DevOps has nothing.
      if (item === null) {
        continue
      }

      const rawTags = readStringField(item.fields, 'System.Tags')

      const workItem: IWorkItem = {
        id: item.id,
        title: readStringField(item.fields, 'System.Title') ?? '(no title)',
        workItemType:
          readStringField(item.fields, 'System.WorkItemType') ?? 'Work Item',
        state: readStringField(item.fields, 'System.State') ?? 'Unknown',
        assignedTo: readStringField(item.fields, 'System.AssignedTo'),
        tags:
          rawTags === null
            ? []
            : rawTags
                .split(';')
                .map(t => t.trim())
                .filter(t => t.length > 0),
        releaseSequence: readNumberField(item.fields, ReleaseSequenceField),
        linkedCommitShas: extractLinkedCommitShas(item.relations),
      }

      result.set(item.id, workItem)
      workItemCache.set(item.id, { value: workItem, storedAt: Date.now() })
    }
  }

  return result
}

/** Builds the browser URL for a work item, for click-through. */
export function getWorkItemUrl(config: IAdoConfig, id: number): string {
  return (
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `${encodeURIComponent(config.project)}/_workitems/edit/${id}`
  )
}

/**
 * Verifies a credential by making the cheapest authenticated call we can.
 * Used by the connect dialog's "Test connection".
 */
export async function testAdoConnection(
  config: IAdoConfig,
  credential: AdoCredential
): Promise<void> {
  const url =
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `${encodeURIComponent(config.project)}/_apis/wit/wiql` +
    `?api-version=${ApiVersion}&$top=1`

  await postJson<IWiqlResponse>(
    url,
    { query: 'SELECT [System.Id] FROM WorkItems' },
    credential
  )
}
