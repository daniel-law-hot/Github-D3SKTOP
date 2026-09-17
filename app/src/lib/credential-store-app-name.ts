/**
 * The name this app namespaces its entries with in the OS credential store
 * (Keychain on macOS, Credential Manager on Windows, libsecret on Linux).
 *
 * This must not match the names GitHub Desktop uses ('GitHub' and 'GitHub
 * Desktop'). Both apps can be installed side by side and share a single
 * credential store, so a shared name means one app overwrites the other's
 * credentials when it signs in, and deletes them when it signs out.
 */
export const credentialStoreAppName = __DEV__
  ? 'GitHub D3SKTOP Dev'
  : 'GitHub D3SKTOP'
