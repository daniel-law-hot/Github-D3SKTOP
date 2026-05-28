import { app } from 'electron'
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
import { gt as semverGt, valid as semverValid } from 'semver'

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

      if (!semverValid(latestVersion)) {
        throw new Error(
          `Latest release tag "${release.tag_name}" is not a valid semver`
        )
      }

      if (!semverGt(latestVersion, currentVersion)) {
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
      log.error('GitHubReleaseUpdater: check/download failed', err)
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
      }
    )
    child.unref()

    // Give the OS a beat to actually start the child before we exit, then
    // quit. The updater itself waits for our PID, so this is just polite.
    setTimeout(() => app.quit(), 250)
  }

  private async fetchLatestRelease(): Promise<GitHubRelease> {
    const repo = __RELEASE_REPO__
    const url = `https://api.github.com/repos/${repo}/releases/latest`

    log.info(`GitHubReleaseUpdater: GET ${url}`)
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `GitHubDesktop/${app.getVersion()} (Windows)`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!res.ok) {
      throw new Error(
        `GitHub Releases API returned ${res.status} ${res.statusText}`
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
      const res = await fetch(url, {
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
