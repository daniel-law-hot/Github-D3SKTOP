import { TokenStore } from '../stores/token-store'
import { execFile } from '../exec-file'

/**
 * Authentication for the Azure DevOps work item API.
 *
 * Two paths, in order:
 *
 *  1. The Azure CLI. If the user is already logged in with `az`, we can mint a
 *     bearer token on demand with nothing to store and nothing to expire from
 *     HotFlow's point of view. Most people at House of Travel already have this.
 *  2. A personal access token, entered once and kept in the OS credential vault.
 *     The fallback for machines without the CLI.
 *
 * If neither is available HotFlow degrades to showing VSO numbers as links. The
 * git side of the view never depends on this succeeding.
 */

/** The well-known Azure DevOps resource id, for `az account get-access-token`. */
const AdoResourceId = '499b84ac-1321-427f-aa17-267ca6975798'

const TokenStoreKey = 'hotflow/azure-devops'

/** Bearer tokens last an hour; refresh a little early to avoid edge misses. */
const TokenCacheMs = 50 * 60 * 1000

/** How long to wait on the az CLI before deciding it isn't going to answer. */
const AzTimeoutMs = 10 * 1000

export type AdoCredential =
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'pat'; readonly token: string }

interface ICachedBearer {
  readonly token: string
  readonly obtainedAt: number
}

let cachedBearer: ICachedBearer | null = null

/**
 * Builds the Authorization header value for a credential.
 *
 * PATs authenticate as HTTP basic with an empty username, which is Azure
 * DevOps' documented scheme for them.
 */
export function getAuthorizationHeader(credential: AdoCredential): string {
  if (credential.kind === 'bearer') {
    return `Bearer ${credential.token}`
  }

  const encoded = Buffer.from(`:${credential.token}`, 'utf8').toString('base64')
  return `Basic ${encoded}`
}

/**
 * Attempts to get a bearer token from the Azure CLI.
 *
 * Returns null whenever the CLI is missing, not logged in, or slow — all of
 * which are ordinary conditions, not errors worth surfacing.
 */
async function getAzBearerToken(): Promise<string | null> {
  if (cachedBearer !== null) {
    if (Date.now() - cachedBearer.obtainedAt < TokenCacheMs) {
      return cachedBearer.token
    }
    cachedBearer = null
  }

  try {
    const { stdout } = await execFile(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        AdoResourceId,
        '--query',
        'accessToken',
        '-o',
        'tsv',
      ],
      {
        timeout: AzTimeoutMs,
        // az is a batch script on Windows, so it needs a shell to resolve.
        shell: __WIN32__,
        windowsHide: true,
      }
    )

    const token = stdout.toString().trim()

    if (token.length === 0) {
      return null
    }

    cachedBearer = { token, obtainedAt: Date.now() }

    return token
  } catch {
    // Missing CLI, not logged in, proxy failure, timeout — all the same to us.
    return null
  }
}

/** Reads the stored personal access token, if the user has set one. */
export async function getStoredPat(
  organisation: string
): Promise<string | null> {
  try {
    return await TokenStore.getItem(TokenStoreKey, organisation)
  } catch {
    return null
  }
}

/** Stores a personal access token in the OS credential vault. */
export async function setStoredPat(
  organisation: string,
  pat: string
): Promise<void> {
  await TokenStore.setItem(TokenStoreKey, organisation, pat)
}

/** Removes the stored personal access token. */
export async function deleteStoredPat(organisation: string): Promise<void> {
  try {
    await TokenStore.deleteItem(TokenStoreKey, organisation)
  } catch {
    // Nothing stored, nothing to do.
  }
}

/**
 * Resolves a credential for the organisation, preferring the Azure CLI.
 *
 * Returns null when neither path is available — the caller should then leave
 * ADO status as `unconfigured` and prompt, rather than reporting an error.
 */
export async function getAdoCredential(
  organisation: string
): Promise<AdoCredential | null> {
  const bearer = await getAzBearerToken()

  if (bearer !== null) {
    return { kind: 'bearer', token: bearer }
  }

  const pat = await getStoredPat(organisation)

  if (pat !== null && pat.length > 0) {
    return { kind: 'pat', token: pat }
  }

  return null
}

/** Clears the in-memory bearer cache. Used after an auth failure. */
export function invalidateCachedBearer(): void {
  cachedBearer = null
}
