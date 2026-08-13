import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import * as Path from 'path'

/**
 * Authenticode signing for the Windows build.
 *
 * Opt-in, and off unless `WINDOWS_CODE_SIGNING_THUMBPRINT` names a code-signing
 * certificate in the signer's personal store — so an ordinary build needs no
 * certificate and produces the same unsigned output it always did.
 *
 * The certificate is selected by thumbprint rather than by subject name because
 * a renewed certificate lives alongside the one it replaces for a while, and
 * `/n` would let signtool pick whichever it found first. See
 * docs/technical/code-signing.md for where the certificate comes from.
 */

/** The thumbprint to sign with, or undefined when signing is off. */
export function getSigningThumbprint(): string | undefined {
  // Copied out of the certificate dialog, the thumbprint arrives full of spaces
  // and sometimes a leading zero-width mark; signtool wants neither.
  const thumbprint = process.env.WINDOWS_CODE_SIGNING_THUMBPRINT?.replace(
    /[^0-9a-fA-F]/g,
    ''
  )

  return thumbprint === undefined || thumbprint.length === 0
    ? undefined
    : thumbprint
}

/**
 * Where to get a countersignature saying when the signing happened.
 *
 * Not optional in practice. Without it the signature stops validating the day
 * the certificate expires, taking every build already installed with it. An
 * internal CA doesn't run a timestamp authority, and it doesn't need to — a
 * timestamp is independent of who issued the signing certificate.
 */
function getTimestampUrl(): string {
  return (
    process.env.WINDOWS_CODE_SIGNING_TIMESTAMP_URL ??
    'http://timestamp.digicert.com'
  )
}

/** Compares dotted version directory names numerically, oldest first. */
function compareVersions(a: string, b: string): number {
  const as = a.split('.').map(n => parseInt(n, 10))
  const bs = b.split('.').map(n => parseInt(n, 10))

  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0)
    if (diff !== 0 && Number.isFinite(diff)) {
      return diff
    }
  }

  return 0
}

/**
 * The newest `signtool.exe` from the installed Windows SDKs.
 *
 * Sorted numerically rather than lexicographically: `10.0.9000.0` would
 * otherwise sort above `10.0.26100.0`.
 */
export function findSignTool(): string {
  const fromEnv = process.env.SIGNTOOL_PATH

  if (fromEnv !== undefined && existsSync(fromEnv)) {
    return fromEnv
  }

  const candidates = new Array<{ version: string; path: string }>()

  for (const root of [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin',
  ]) {
    if (!existsSync(root)) {
      continue
    }

    for (const version of readdirSync(root)) {
      const path = Path.join(root, version, 'x64', 'signtool.exe')

      if (existsSync(path)) {
        candidates.push({ version, path })
      }
    }
  }

  candidates.sort((a, b) => compareVersions(a.version, b.version))

  const newest = candidates.at(-1)

  if (newest === undefined) {
    throw new Error(
      'Code signing was requested but signtool.exe could not be found. ' +
        'Install the Windows SDK, or point SIGNTOOL_PATH at it.'
    )
  }

  return newest.path
}

/**
 * The signtool *options*, shared so that what we run by hand and what
 * electron-winstaller runs for the installer cannot drift apart.
 *
 * The `sign` subcommand is deliberately not included: electron-winstaller
 * prepends its own, so `signWithParams` must carry options only. Direct callers
 * add it themselves.
 */
export function getSignToolArgs(thumbprint: string): ReadonlyArray<string> {
  return [
    '/v',
    '/fd',
    'SHA256',
    '/sha1',
    thumbprint,
    '/tr',
    getTimestampUrl(),
    '/td',
    'SHA256',
  ]
}

/** The same, as the single string electron-winstaller's `signWithParams` wants. */
export function getSignWithParams(thumbprint: string): string {
  return getSignToolArgs(thumbprint)
    .map(arg => (arg.includes(' ') ? `"${arg}"` : arg))
    .join(' ')
}

/**
 * Signs a file in place, doing nothing when signing is off.
 *
 * Throws when signing was asked for and didn't happen: a build that quietly
 * produces unsigned output is worse than one that stops, because nothing
 * downstream looks.
 */
export function signWindowsFile(file: string): void {
  const thumbprint = getSigningThumbprint()

  if (thumbprint === undefined) {
    return
  }

  if (!existsSync(file)) {
    throw new Error(`Cannot sign ${file} — it doesn't exist.`)
  }

  console.log(`  Signing ${Path.basename(file)}…`)

  execFileSync(findSignTool(), ['sign', ...getSignToolArgs(thumbprint), file], {
    stdio: 'inherit',
  })
}

/** Checks a signature against the default Authenticode policy. */
export function verifyWindowsSignature(file: string): void {
  if (getSigningThumbprint() === undefined) {
    return
  }

  console.log(`  Verifying ${Path.basename(file)}…`)

  execFileSync(findSignTool(), ['verify', '/pa', '/v', file], {
    stdio: 'inherit',
  })
}
