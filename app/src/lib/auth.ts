import { Account } from '../models/account'

/** Get the auth key for the user. */
export function getKeyForAccount(account: Account): string {
  return getKeyForEndpoint(account.endpoint)
}

/** Get the auth key for the endpoint. */
export function getKeyForEndpoint(endpoint: string): string {
  // These must not collide with the keys GitHub Desktop uses ('GitHub' and
  // 'GitHub Desktop Dev'). Both apps can be installed side by side, and the
  // OS credential store is shared between them, so a shared key means signing
  // in to one app overwrites the other's token and signing out deletes it.
  const appName = __DEV__ ? 'GitHub D3SKTOP Dev' : 'GitHub D3SKTOP'

  return `${appName} - ${endpoint}`
}
