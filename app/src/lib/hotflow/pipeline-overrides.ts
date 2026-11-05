/**
 * What a person has told HotFlow about a repository's release pipelines, when the
 * automatic lookup gets them wrong.
 *
 * The lookup goes repository → build definition → release definition, which finds
 * most pipelines and misses or invents some: a repository that builds several apps
 * (HOTWebsites builds RetailB2B, MixAndMatch, HOBT…) can have a release definition
 * whose artifact is not obviously its own. So two corrections are kept per
 * repository: release definitions to add that were not found, and ones to hide
 * that were found and do not belong.
 */

export interface IAddedPipeline {
  readonly id: number

  /** What to call it, or null to use the name it has in Azure DevOps. */
  readonly label: string | null
}

export interface IHiddenPipeline {
  readonly id: number

  /** Its name when it was hidden, since a hidden pipeline is not read to ask. */
  readonly name: string
}

export interface IPipelineOverrides {
  readonly added: ReadonlyArray<IAddedPipeline>
  readonly hidden: ReadonlyArray<IHiddenPipeline>
}

export const NoPipelineOverrides: IPipelineOverrides = {
  added: [],
  hidden: [],
}

/** Where a pipeline in the panel came from. */
export type PipelineSource = 'found' | 'added'

const LargestSaneId = 1_000_000_000

function asDefinitionId(text: string): number | null {
  if (!/^\d+$/.test(text)) {
    return null
  }

  const id = parseInt(text, 10)

  return id > 0 && id < LargestSaneId ? id : null
}

/**
 * The release definition id in whatever someone pasted: the bare number, the
 * address of the pipeline's page in Azure DevOps, or its API address.
 *
 *   165
 *   https://dev.azure.com/houseoftravel/Group/_release?definitionId=165
 *   https://dev.azure.com/houseoftravel/Group/_release?_a=releases&view=mine&definitionId=165
 *   https://vsrm.dev.azure.com/houseoftravel/Group/_apis/release/definitions/165
 *
 * Null when there is no id to be had, so the caller can say so rather than
 * guessing. A build's address (`_build?definitionId=…`) carries an id too, but it
 * is a different kind of id and would add the wrong pipeline, so it is refused.
 */
export function parseReleaseDefinitionId(text: string): number | null {
  const trimmed = text.trim()

  const bare = asDefinitionId(trimmed)

  if (bare !== null) {
    return bare
  }

  // A build definition's page uses the same parameter for a different thing.
  if (/\/_build\b|\/_apis\/build\//i.test(trimmed)) {
    return null
  }

  const query = /[?&#]definitionId=(\d+)(?:[&#]|$)/i.exec(trimmed)

  if (query !== null) {
    return asDefinitionId(query[1])
  }

  const path = /\/release\/definitions\/(\d+)(?:[/?#]|$)/i.exec(trimmed)

  return path === null ? null : asDefinitionId(path[1])
}

/**
 * Which release definitions to read: the ones found, without the hidden, plus the
 * ones added.
 *
 * An added one is read even if it is also hidden — adding is the later, more
 * deliberate act, and `withAddedPipeline` takes it out of the hidden list anyway.
 * Ascending, and each once, so the panel's order does not depend on which route a
 * pipeline arrived by.
 */
export function pipelineIdsToRead(
  foundIds: ReadonlyArray<number>,
  overrides: IPipelineOverrides
): ReadonlyArray<number> {
  const hidden = new Set(overrides.hidden.map(h => h.id))
  const ids = new Set<number>([
    ...foundIds.filter(id => !hidden.has(id)),
    ...overrides.added.map(a => a.id),
  ])

  return [...ids].sort((a, b) => a - b)
}

/** Whether a pipeline being read was found automatically or added by hand. */
export function pipelineSource(
  id: number,
  foundIds: ReadonlyArray<number>,
  overrides: IPipelineOverrides
): PipelineSource {
  return foundIds.includes(id) && !overrides.added.some(a => a.id === id)
    ? 'found'
    : 'added'
}

/** The overrides with a pipeline added, replacing any earlier addition of it. */
export function withAddedPipeline(
  overrides: IPipelineOverrides,
  id: number,
  label: string | null
): IPipelineOverrides {
  return {
    added: [...overrides.added.filter(a => a.id !== id), { id, label }],
    hidden: overrides.hidden.filter(h => h.id !== id),
  }
}

/** The overrides without an added pipeline. */
export function withoutAddedPipeline(
  overrides: IPipelineOverrides,
  id: number
): IPipelineOverrides {
  return {
    added: overrides.added.filter(a => a.id !== id),
    hidden: overrides.hidden,
  }
}

/** The overrides with a pipeline hidden, and any addition of it dropped. */
export function withHiddenPipeline(
  overrides: IPipelineOverrides,
  id: number,
  name: string
): IPipelineOverrides {
  return {
    added: overrides.added.filter(a => a.id !== id),
    hidden: [...overrides.hidden.filter(h => h.id !== id), { id, name }],
  }
}

/** The overrides with a hidden pipeline shown again. */
export function withRestoredPipeline(
  overrides: IPipelineOverrides,
  id: number
): IPipelineOverrides {
  return {
    added: overrides.added,
    hidden: overrides.hidden.filter(h => h.id !== id),
  }
}
