import { Account } from '../models/account'
import { credentialStoreAppName } from './credential-store-app-name'

/** Get the auth key for the user. */
export function getKeyForAccount(account: Account): string {
  return getKeyForEndpoint(account.endpoint)
}

/** Get the auth key for the endpoint. */
export function getKeyForEndpoint(endpoint: string): string {
  return `${credentialStoreAppName} - ${endpoint}`
}
