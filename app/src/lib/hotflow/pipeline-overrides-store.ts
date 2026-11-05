import { Repository } from '../../models/repository'
import { getObject, setObject } from '../local-storage'
import { IPipelineOverrides, NoPipelineOverrides } from './pipeline-overrides'

/**
 * Per repository, keyed on the working tree path lower-cased for the same reason
 * `forgotten-hidden-store.ts` is: `repository.hash` changes when a repository is
 * renamed or goes missing and returns, which would quietly drop the corrections.
 */
const storageKeyPrefix = 'hotflow-pipeline-overrides'

function storageKey(repository: Repository): string {
  return `${storageKeyPrefix}-${repository.path.toLowerCase()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * What is stored, checked entry by entry: it is read back from local storage,
 * which anything could have written, and a malformed entry should cost that entry
 * and not the panel.
 */
export function getPipelineOverrides(
  repository: Repository
): IPipelineOverrides {
  const stored = getObject<unknown>(storageKey(repository))

  if (!isRecord(stored)) {
    return NoPipelineOverrides
  }

  const added = Array.isArray(stored.added) ? stored.added : []
  const hidden = Array.isArray(stored.hidden) ? stored.hidden : []

  return {
    added: added.flatMap(a =>
      isRecord(a) && typeof a.id === 'number'
        ? [
            {
              id: a.id,
              label: typeof a.label === 'string' ? a.label : null,
            },
          ]
        : []
    ),
    hidden: hidden.flatMap(h =>
      isRecord(h) && typeof h.id === 'number'
        ? [{ id: h.id, name: typeof h.name === 'string' ? h.name : `#${h.id}` }]
        : []
    ),
  }
}

export function setPipelineOverrides(
  repository: Repository,
  overrides: IPipelineOverrides
): void {
  setObject(storageKey(repository), overrides)
}
