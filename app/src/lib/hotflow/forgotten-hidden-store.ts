import { Repository } from '../../models/repository'
import { getObject, setObject } from '../local-storage'

/**
 * The branches somebody has asked not to be told about again.
 *
 * Keyed on the working tree path, lower-cased, for the same reason
 * `settings-store.ts` is: `repository.hash` changes when a repository is renamed
 * or goes missing and returns, which would quietly bring back everything hidden.
 */
const storageKeyPrefix = 'hotflow-forgotten-hidden'

function storageKey(repository: Repository): string {
  return `${storageKeyPrefix}-${repository.path.toLowerCase()}`
}

export function getHiddenForgottenBranches(
  repository: Repository
): ReadonlySet<string> {
  const stored = getObject<ReadonlyArray<unknown>>(storageKey(repository))

  return new Set(
    Array.isArray(stored)
      ? stored.filter((n): n is string => typeof n === 'string')
      : []
  )
}

export function hideForgottenBranch(
  repository: Repository,
  name: string
): void {
  const hidden = new Set(getHiddenForgottenBranches(repository))
  hidden.add(name)
  setObject(storageKey(repository), [...hidden])
}

export function unhideAllForgottenBranches(repository: Repository): void {
  setObject(storageKey(repository), [])
}
