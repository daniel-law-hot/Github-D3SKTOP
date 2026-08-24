import { IWorkItem } from '../../models/hotflow'
import { parseReleaseSequence } from './release-sequence'
import {
  AdoCredential,
  getAdoCredential,
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
  credential: AdoCredential,
  organisation: string
): Promise<T> {
  return sendJson<T>(
    url,
    'POST',
    'application/json',
    body,
    credential,
    organisation
  )
}

/**
 * The one write this client makes, and the only place a JSON Patch is sent.
 *
 * Azure DevOps will not accept `application/json` on a work item update — it
 * answers 400 and says nothing useful — so the content type is part of the
 * request rather than a detail of it.
 */
async function patchJson<T>(
  url: string,
  body: unknown,
  credential: AdoCredential,
  organisation: string
): Promise<T> {
  return sendJson<T>(
    url,
    'PATCH',
    'application/json-patch+json',
    body,
    credential,
    organisation
  )
}

/**
 * One request, with one retry on a different credential.
 *
 * The retry exists because the first credential can be one this organisation
 * will never accept: an Azure CLI bearer token gets a sign-in page rather than
 * data, and refusing it teaches `getAdoCredential` to reach for the personal
 * access token instead. Re-resolving after the refusal turns what used to be an
 * empty work item list into a working one, with nothing for anyone to do.
 *
 * Only the auth failures retry, and only once — a rejected personal access token
 * re-resolves to itself, so there is nothing to gain from going round again.
 */
async function sendJson<T>(
  url: string,
  method: 'POST' | 'PATCH',
  contentType: string,
  body: unknown,
  credential: AdoCredential,
  organisation: string
): Promise<T> {
  try {
    return await sendJsonOnce<T>(url, method, contentType, body, credential)
  } catch (e) {
    if (!(e instanceof AdoError) || !e.isAuthFailure) {
      throw e
    }

    // `invalidateCachedBearer` has already run by here, so this resolves past
    // the refused bearer rather than re-minting it.
    const replacement = await getAdoCredential(organisation)

    if (replacement === null || replacement.token === credential.token) {
      throw e
    }

    return await sendJsonOnce<T>(url, method, contentType, body, replacement)
  }
}

async function sendJsonOnce<T>(
  url: string,
  method: 'POST' | 'PATCH',
  contentType: string,
  body: unknown,
  credential: AdoCredential
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RequestTimeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': contentType,
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

  const response = await postJson<IWiqlResponse>(
    url,
    { query },
    credential,
    config.organisation
  )

  const ids = (response.workItems ?? []).map(w => w.id)

  sequenceIdCache.set(cacheKey, { value: ids, storedAt: Date.now() })

  return ids
}

interface IWorkItemsBatchResponse {
  /**
   * Entries can be `null` for ids Azure DevOps couldn't resolve — that's what
   * `errorPolicy: 'omit'` does instead of failing the batch. Typed nullable so the
   * reader below has to account for them.
   */
  readonly value?: ReadonlyArray<{
    readonly id: number
    readonly fields?: Record<string, unknown>
  } | null>
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

  const fields = [
    'System.Id',
    'System.Title',
    'System.WorkItemType',
    'System.State',
    'System.AssignedTo',
    'System.Tags',
    ReleaseSequenceField,
  ]

  for (let i = 0; i < needed.length; i += MaxBatchSize) {
    const chunk = needed.slice(i, i + MaxBatchSize)

    // `errorPolicy: 'omit'` is not optional. Without it a single id Azure DevOps
    // can't resolve makes the *whole batch* 404, so one stray number in one commit
    // message wipes out the detail for every work item beside it. VSO numbers are
    // read out of commit text, so stray numbers are a matter of when rather than
    // if — HOTWebsites' 1.2026.10 carries an `AB#1004496` that took its other nine
    // work items down with it. Unresolvable ids come back absent or as null.
    const response = await postJson<IWorkItemsBatchResponse>(
      url,
      { ids: chunk, fields, errorPolicy: 'omit' },
      credential,
      config.organisation
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

/** What happened to one work item in a bulk assignment. */
export interface IReleaseSequenceAssignment {
  readonly id: number

  /**
   * `assigned` — the field was empty and now holds the sequence.
   * `already` — it already held this sequence, so nothing was sent.
   * `conflict` — it holds a *different* sequence, and was left alone.
   * `failed` — Azure DevOps refused the write.
   */
  readonly outcome: 'assigned' | 'already' | 'conflict' | 'failed'

  /** The sequence found on a conflict, so the caller can say what it was. */
  readonly existingSequence: number | null

  readonly error: string | null

  /**
   * The HTTP status behind a failure, when there was one.
   *
   * Kept because the single likeliest cause of a refused write is a token that
   * can read but not write, and 401/403 is what separates that from a work item
   * Azure DevOps would not accept the change to. Without it every failure reads
   * the same and the fix — a wider token — isn't discoverable.
   */
  readonly status: number | null
}

/**
 * Sets a work item's Release sequence number.
 *
 * `add` rather than `replace` because JSON Patch's `replace` requires the field
 * to already have a value, and the whole point here is the ones that don't.
 * Azure DevOps treats `add` on an existing field as an overwrite, which is why
 * the caller checks for a conflicting value first rather than relying on the
 * request to fail.
 */
export async function setWorkItemReleaseSequence(
  config: IAdoConfig,
  id: number,
  releaseSequence: number,
  credential: AdoCredential
): Promise<void> {
  if (parseReleaseSequence(releaseSequence) === null) {
    throw new AdoError(
      `Invalid release sequence number: ${releaseSequence}`,
      null,
      false
    )
  }

  const url =
    `https://dev.azure.com/${encodeURIComponent(config.organisation)}/` +
    `${encodeURIComponent(config.project)}/_apis/wit/workitems/${id}` +
    `?api-version=${ApiVersion}`

  await patchJson(
    url,
    [
      {
        op: 'add',
        path: `/fields/${ReleaseSequenceField}`,
        value: releaseSequence,
      },
    ],
    credential,
    config.organisation
  )

  // What we just wrote is now wrong in two caches: this item's detail, and the
  // list of ids assigned to the sequence it just joined. Dropping the entries is
  // enough — the next read repopulates them.
  workItemCache.delete(id)
  sequenceIdCache.delete(
    `${config.organisation}/${config.project}/${releaseSequence}`
  )
}

/**
 * Assigns a sequence number to many work items, reporting each one separately.
 *
 * Never throws for a single item: a bulk action across a dozen work items where
 * one is locked or deleted should tell you which one, not lose the other eleven.
 * The caller is expected to show the failures rather than a single "it worked".
 *
 * An item already carrying a *different* sequence is skipped rather than
 * overwritten. Reassigning someone else's release is not a thing to do silently,
 * and the interesting case — a work item merged here but planned for the next
 * cycle — is exactly the one that reads as a mistake if it moves on its own.
 */
export async function assignReleaseSequence(
  config: IAdoConfig,
  ids: ReadonlyArray<number>,
  releaseSequence: number,
  credential: AdoCredential,
  current: ReadonlyMap<number, number | null>,

  /** Reassign work items that already belong to a different release. */
  overwrite: boolean = false
): Promise<ReadonlyArray<IReleaseSequenceAssignment>> {
  const { write, skip } = planReleaseSequenceAssignment(
    ids,
    releaseSequence,
    current,
    overwrite
  )

  const results: Array<IReleaseSequenceAssignment> = [...skip]

  // Serial, not concurrent. This is a handful of items at human pace, and the
  // work item API rate-limits hard enough that a burst is a worse trade than a
  // second of waiting.
  for (const id of write) {
    try {
      await setWorkItemReleaseSequence(config, id, releaseSequence, credential)
      results.push({
        id,
        outcome: 'assigned',
        existingSequence: null,
        error: null,
        status: null,
      })
    } catch (e) {
      results.push({
        id,
        outcome: 'failed',
        existingSequence: null,
        error: e instanceof Error ? e.message : String(e),
        status: e instanceof AdoError ? e.status : null,
      })
    }
  }

  return results.sort((a, b) => a.id - b.id)
}

/**
 * Decides which work items to write to, before anything is written.
 *
 * Separated from the writing so the rule can be tested without a network: which
 * items get touched, and why the others don't, is the whole substance of a bulk
 * edit against a system HotFlow otherwise only reads.
 */
export function planReleaseSequenceAssignment(
  ids: ReadonlyArray<number>,
  releaseSequence: number,

  /**
   * What each work item currently holds. Ids absent from the map are treated as
   * unknown and attempted, because being wrong the other way — not assigning
   * something that needed it — is the failure this exists to fix.
   */
  current: ReadonlyMap<number, number | null>,

  /**
   * Reassign work items already carrying a different sequence.
   *
   * Off by default, and deliberately a separate argument rather than a mode: the
   * skip is the safety property of this whole feature, so turning it off has to be
   * something a caller says out loud.
   */
  overwrite: boolean = false
): {
  readonly write: ReadonlyArray<number>
  readonly skip: ReadonlyArray<IReleaseSequenceAssignment>
} {
  const write: Array<number> = []
  const skip: Array<IReleaseSequenceAssignment> = []

  for (const id of new Set(ids)) {
    const existing = current.get(id) ?? null

    if (existing === releaseSequence) {
      skip.push({
        id,
        outcome: 'already',
        existingSequence: existing,
        error: null,
        status: null,
      })
    } else if (existing !== null && !overwrite) {
      skip.push({
        id,
        outcome: 'conflict',
        existingSequence: existing,
        error: null,
        status: null,
      })
    } else {
      write.push(id)
    }
  }

  return { write, skip }
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
    credential,
    config.organisation
  )
}
