import { app, net } from 'electron'
import { EventEmitter } from 'events'
import {
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { isComparableVersion, isNewerVersion } from '../lib/app-version'
import { EndpointToken } from '../lib/endpoint-token'
import { getDotComAPIEndpoint } from '../lib/api'

/**
 * Drop-in replacement for Electron's `autoUpdater` that tracks GitHub
 * Releases on the fork repo (set via `__RELEASE_REPO__` at build time) and
 * delegates file replacement to the standalone `updater.exe` shipped
 * alongside the app.
 *
 * Emits the same event names as Electron's `autoUpdater` so the existing
 * IPC plumbing in `app-window.ts` works without modification:
 *   - 'checking-for-update'
 *   - 'update-available'
 *   - 'update-not-available'
 *   - 'update-downloaded'
 *   - 'error' (Error)
 */
export class GitHubReleaseUpdater extends EventEmitter {
  private checking = false
  private downloadInProgress = false
  private downloadedZipPath: string | null = null
  private downloadedVersion: string | null = null
  private dotComToken: string | null = null

  /**
   * Push the current set of signed-in accounts so the updater can use the
   * dotcom token for API requests (raises the rate limit from 60 to 5,000
   * requests/hour and unlocks private repos). Called from main.ts whenever
   * the renderer fires `update-accounts`.
   */
  public setAccounts(accounts: ReadonlyArray<EndpointToken>): void {
    const dotComEndpoint = getDotComAPIEndpoint()
    const dotCom = accounts.find(a => a.endpoint === dotComEndpoint)
    this.dotComToken = dotCom?.token ?? null
  }

  public async checkForUpdates(): Promise<void> {
    if (this.checking || this.downloadInProgress) {
      return
    }

    this.checking = true
    this.emit('checking-for-update')

    try {
      const release = await this.fetchLatestRelease()
      const currentVersion = app.getVersion()
      const latestVersion = stripTagPrefix(release.tag_name)

      if (!isComparableVersion(latestVersion)) {
        throw new Error(
          `Latest release tag "${release.tag_name}" is not a version this build ` +
            `can order — expected up to four numbers, or semver`
        )
      }

      if (!isNewerVersion(latestVersion, currentVersion)) {
        this.emit('update-not-available')
        return
      }

      this.emit('update-available')

      const asset = pickWindowsZipAsset(release.assets)
      if (!asset) {
        throw new Error(
          `Release ${release.tag_name} has no Windows .zip asset attached`
        )
      }

      const zipPath = await this.downloadAsset(
        asset.browser_download_url,
        asset.size,
        latestVersion
      )

      this.downloadedZipPath = zipPath
      this.downloadedVersion = latestVersion
      this.emit('update-downloaded')
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      log.error(
        `GitHubReleaseUpdater: check/download failed — ${err.message}`,
        err
      )
      this.emit('error', err)
    } finally {
      this.checking = false
    }
  }

  /**
   * Hands off to `updater.exe`, then quits the app. The updater takes over
   * from there: waits for our PID to exit, extracts the zip over the install
   * folder, relaunches the new exe.
   */
  public quitAndInstall(): void {
    if (!this.downloadedZipPath || !this.downloadedVersion) {
      log.warn(
        'GitHubReleaseUpdater: quitAndInstall called with no downloaded update'
      )
      return
    }

    const installDir = path.dirname(process.execPath)
    const exePath = process.execPath
    const bundledUpdater = path.join(installDir, 'updater.exe')

    if (!existsSync(bundledUpdater)) {
      const err = new Error(
        `updater.exe not found at ${bundledUpdater}; cannot apply update`
      )
      log.error(err.message)
      this.emit('error', err)
      return
    }

    const workDir = path.join(
      os.tmpdir(),
      `gd-update-${this.downloadedVersion}-${process.pid}`
    )
    mkdirSync(workDir, { recursive: true })

    // Copy the updater into the temp work dir so it isn't running from the
    // install folder we're about to overwrite.
    const stagedUpdater = path.join(workDir, 'updater.exe')
    copyFileSync(bundledUpdater, stagedUpdater)

    const logPath = path.join(app.getPath('userData'), 'update.log')

    log.info(
      `GitHubReleaseUpdater: spawning ${stagedUpdater} to apply ${this.downloadedVersion}`
    )

    const child = spawn(
      stagedUpdater,
      [
        '--pid',
        String(process.pid),
        '--zip',
        this.downloadedZipPath,
        '--target',
        installDir,
        '--relaunch',
        exePath,
        '--log',
        logPath,
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        // Critical: run the updater from a directory OUTSIDE the install
        // folder. A process's current directory is locked by Windows, so if
        // the updater inherited our cwd (the install dir) it could never
        // rename that folder — the rename fails with EBUSY.
        cwd: workDir,
      }
    )
    child.unref()

    // Give the OS a beat to actually start the child before we exit, then
    // quit. The updater itself waits for our PID, so this is just polite.
    setTimeout(() => app.quit(), 250)
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `GitHubDesktop/${app.getVersion()} (Windows)`,
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.dotComToken) {
      headers.Authorization = `token ${this.dotComToken}`
    }
    return headers
  }

  private async fetchLatestRelease(): Promise<GitHubRelease> {
    const repo = __RELEASE_REPO__
    const url = `https://api.github.com/repos/${repo}/releases/latest`

    log.info(
      `GitHubReleaseUpdater: GET ${url} (${
        this.dotComToken ? 'authenticated' : 'unauthenticated'
      })`
    )
    const res = await netFetch(url, {
      headers: this.buildHeaders(),
      // A proxy that accepts the connection and then never answers would
      // otherwise leave the check spinning for minutes, which reads as "the
      // app doesn't check for updates" rather than as a failure.
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const rateRemaining = res.headers.get('x-ratelimit-remaining')
      const hint =
        res.status === 403 && rateRemaining === '0'
          ? ' (rate-limited; sign into GitHub.com in the app to authenticate update checks and raise the limit)'
          : ''
      throw new Error(
        `GitHub Releases API returned ${res.status} ${res.statusText}${hint}`
      )
    }

    return (await res.json()) as GitHubRelease
  }

  private async downloadAsset(
    url: string,
    expectedSize: number,
    version: string
  ): Promise<string> {
    this.downloadInProgress = true
    try {
      const dir = path.join(os.tmpdir(), `gd-update-download-${version}`)
      mkdirSync(dir, { recursive: true })
      const zipPath = path.join(dir, 'update.zip')

      // Reuse a prior download if it's complete and matches expected size.
      if (existsSync(zipPath) && statSync(zipPath).size === expectedSize) {
        log.info(`GitHubReleaseUpdater: reusing cached download at ${zipPath}`)
        return zipPath
      }

      log.info(`GitHubReleaseUpdater: downloading ${url} -> ${zipPath}`)
      // Asset URLs redirect to a presigned S3 URL — only send our auth on the
      // first hop, not the redirect (S3 rejects unknown Authorization headers).
      const res = await netFetch(url, {
        headers: {
          'User-Agent': `GitHubDesktop/${app.getVersion()} (Windows)`,
        },
        redirect: 'follow',
      })

      if (!res.ok || !res.body) {
        throw new Error(
          `Download failed: ${res.status} ${res.statusText} (${url})`
        )
      }

      // Stream to disk so we don't hold the whole zip in memory.
      const out = createWriteStream(zipPath)
      await pipeline(Readable.fromWeb(res.body as any), out)

      const actualSize = statSync(zipPath).size
      if (actualSize !== expectedSize) {
        rmSync(zipPath, { force: true })
        throw new Error(
          `Download size mismatch: expected ${expectedSize}, got ${actualSize}`
        )
      }

      return zipPath
    } finally {
      this.downloadInProgress = false
    }
  }
}

interface GitHubRelease {
  tag_name: string
  name: string
  draft: boolean
  prerelease: boolean
  assets: ReadonlyArray<GitHubReleaseAsset>
}

interface GitHubReleaseAsset {
  name: string
  size: number
  browser_download_url: string
  content_type: string
}

/**
 * `fetch` in the main process is Node's (undici), which shares nothing with
 * the stack the rest of the app talks to GitHub over. It ignores the system
 * and PAC proxy configuration, can't do NTLM or Kerberos proxy auth, and
 * validates TLS against Node's bundled CA list rather than the Windows
 * certificate store. Behind a corporate proxy — or anything that re-signs
 * HTTPS on the way through — that combination fails while every renderer
 * request keeps working, so the app happily talks to GitHub but can't check
 * for updates, reporting only `fetch failed`.
 *
 * Electron's `net.fetch` goes through Chromium, which honours all of the
 * above. It requires the app to be ready, which it always is by the time an
 * update check can run.
 */
async function netFetch(url: string, init: RequestInit) {
  try {
    return await net.fetch(url, init)
  } catch (e) {
    throw explainNetworkError(e, url)
  }
}

/**
 * Transport failures surface as an opaque `TypeError: fetch failed` with the
 * reason that actually matters buried in `cause` — and `formatError` prints
 * only `stack`, so the cause reaches neither the log file nor the user. Every
 * proxy, DNS and certificate problem ends up looking identical. Unpack the
 * chain, lead with something the person reading it can act on, and keep the
 * raw codes on the end for whoever has to diagnose it.
 */
function explainNetworkError(e: unknown, url: string): Error {
  const err = e instanceof Error ? e : new Error(String(e))
  const details = [err.message]

  for (
    let cause: unknown = err.cause;
    cause instanceof Error && details.length < 5;
    cause = cause.cause
  ) {
    const { code } = cause as NodeJS.ErrnoException
    details.push(
      code && !cause.message.includes(code)
        ? `${cause.message} (${code})`
        : cause.message
    )
  }

  const summary = summarizeNetworkError(
    details.join(' ').toLowerCase(),
    hostFromUrl(url)
  )

  const explained = new Error(`${summary} (${details.join('; ')})`)
  explained.stack = err.stack
  return explained
}

function summarizeNetworkError(haystack: string, host: string): string {
  const saw = (...needles: ReadonlyArray<string>) =>
    needles.some(n => haystack.includes(n))

  if (saw('err_proxy', 'err_tunnel', 'proxy_config', 'proxy auth')) {
    return `Couldn't reach ${host} through this network's proxy.`
  }

  if (
    saw(
      'cert',
      'err_ssl',
      'self_signed',
      'self-signed',
      'unable_to_verify',
      'unable_to_get_issuer'
    )
  ) {
    return `Couldn't verify the secure connection to ${host} — something on this network may be inspecting HTTPS traffic.`
  }

  if (
    saw(
      'enotfound',
      'eai_again',
      'err_name_not_resolved',
      'err_name_resolution_failed',
      'getaddrinfo'
    )
  ) {
    return `Couldn't look up ${host}. You may be offline, or this network may block it.`
  }

  if (saw('timeout', 'timed out', 'timed_out', 'etimedout', 'abort')) {
    return `Timed out connecting to ${host}. This network may be blocking it, or the connection may be very slow.`
  }

  if (
    saw(
      'err_internet_disconnected',
      'err_network_changed',
      'enetunreach',
      'ehostunreach'
    )
  ) {
    return `No network connection while contacting ${host}.`
  }

  if (saw('econnrefused', 'econnreset', 'err_connection', 'epipe', 'socket')) {
    return `The connection to ${host} was refused or dropped — a firewall or proxy may be blocking it.`
  }

  return `Couldn't reach ${host}.`
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function stripTagPrefix(tag: string): string {
  return tag.replace(/^v/i, '')
}

function pickWindowsZipAsset(
  assets: ReadonlyArray<GitHubReleaseAsset>
): GitHubReleaseAsset | undefined {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  // Prefer an arch-matched zip, fall back to any GitHubDesktop*.zip.
  return (
    assets.find(
      a => a.name.toLowerCase().endsWith('.zip') && a.name.includes(arch)
    ) ?? assets.find(a => a.name.toLowerCase().endsWith('.zip'))
  )
}
