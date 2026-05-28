/**
 * GitHub Desktop fork updater.
 *
 * Bundled as a standalone Windows executable via @yao-pkg/pkg and shipped
 * inside the installed app folder. The main app copies this exe into a
 * temp folder, spawns it detached with the args below, then quits. From
 * there this process takes over the file-swap.
 *
 * Args (all required):
 *   --pid <number>        PID of the parent (GitHubDesktop.exe) to wait on
 *   --zip <path>          Path to the downloaded release zip
 *   --target <dir>        Install directory to overwrite (e.g. %LOCALAPPDATA%\GitHubDesktop\app-3.5.10)
 *   --relaunch <exe>      Executable to launch after update completes
 *   --log <path>          Path to a log file for diagnostics
 */

import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

interface Args {
  pid: number
  zip: string
  target: string
  relaunch: string
  log: string
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    if (i === -1 || i === argv.length - 1) {
      throw new Error(`missing required arg: ${flag}`)
    }
    return argv[i + 1]
  }
  return {
    pid: Number(get('--pid')),
    zip: get('--zip'),
    target: get('--target'),
    relaunch: get('--relaunch'),
    log: get('--log'),
  }
}

let logStream: fs.WriteStream | null = null

function initLog(args: Args) {
  try {
    fs.mkdirSync(path.dirname(args.log), { recursive: true })
    logStream = fs.createWriteStream(args.log, { flags: 'a' })
  } catch {
    // logging is best-effort
  }
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  if (logStream) {
    logStream.write(line)
  }
  process.stdout.write(line)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) {
      return true
    }
    await sleep(500)
  }
  return false
}

async function forceKill(pid: number): Promise<void> {
  try {
    await execFileAsync('taskkill.exe', ['/F', '/PID', String(pid)], {
      windowsHide: true,
    })
  } catch (e) {
    log(`taskkill failed (process may already be gone): ${String(e)}`)
  }
}

async function extractZipTo(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  // tar.exe ships with Windows 10 1803+ and handles .zip files natively.
  // It's faster and more reliable than PowerShell's Expand-Archive, and
  // doesn't trip ExecutionPolicy. windowsHide keeps tar's console window from
  // flashing up over the user's desktop during the update.
  await execFileAsync('tar.exe', ['-xf', zipPath, '-C', destDir], {
    windowsHide: true,
  })
}

function listEntries(dir: string): fs.Dirent[] {
  return fs.readdirSync(dir, { withFileTypes: true })
}

async function withRetry<T>(
  label: string,
  attempts: number,
  fn: () => Promise<T> | T
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      log(`${label} attempt ${i + 1}/${attempts} failed: ${String(e)}`)
      // Linear-ish backoff; locked files (EBUSY/EPERM/EACCES) usually free up
      // within a couple of seconds once helper processes exit.
      await sleep(750 * (i + 1))
    }
  }
  throw lastErr
}

async function copyTree(src: string, dest: string): Promise<void> {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of listEntries(src)) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyTree(from, to)
    } else if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(from)
      try {
        fs.unlinkSync(to)
      } catch {
        /* ignore */
      }
      fs.symlinkSync(linkTarget, to)
    } else {
      await withRetry(`copyFile ${to}`, 8, () => {
        // Overwriting a file that's mapped as an image (a running .exe/.dll)
        // can fail; removing it first sometimes succeeds where a plain
        // overwrite doesn't, so try unlink then copy.
        try {
          fs.copyFileSync(from, to)
        } catch (e) {
          try {
            fs.unlinkSync(to)
          } catch {
            /* fall through to rethrow original */
          }
          fs.copyFileSync(from, to)
          void e
        }
      })
    }
  }
}

function relaunch(exe: string): void {
  if (!fs.existsSync(exe)) {
    log(`cannot relaunch: ${exe} does not exist`)
    return
  }
  const child = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(exe),
  })
  child.unref()
  log(`relaunched ${exe} (pid ${child.pid})`)
}

function scheduleSelfDelete(): void {
  // Classic Windows trick: spawn a detached cmd that waits a beat then
  // deletes us and itself. We're running from %TEMP% so this is belt-and-
  // suspenders — Windows will clean up TEMP eventually regardless.
  const selfPath = process.execPath
  const selfDir = path.dirname(selfPath)
  const cmd = `ping 127.0.0.1 -n 2 > nul & rmdir /s /q "${selfDir}"`
  const child = spawn('cmd.exe', ['/c', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

async function main(): Promise<void> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`updater: ${String(e)}\n`)
    process.exit(2)
  }

  // Never run with the install directory (or anything we're about to modify)
  // as our current directory — Windows locks a process's cwd, which would
  // block overwriting/renaming. pkg binaries default cwd to wherever they
  // were launched from, so move somewhere neutral.
  try {
    process.chdir(os.tmpdir())
  } catch {
    /* best-effort */
  }

  initLog(args)
  log(
    `updater started; pid=${args.pid} zip=${args.zip} target=${args.target} relaunch=${args.relaunch}`
  )

  const exited = await waitForPidExit(args.pid, 60_000)
  if (!exited) {
    log(`parent PID ${args.pid} still alive after 60s; force-killing`)
    await forceKill(args.pid)
  }

  // Even once the main PID is gone, Electron's helper processes (GPU,
  // crashpad handler, utility) can keep file/directory handles open for a
  // moment. Wait for them to drain so the install folder isn't locked.
  log('waiting for file handles to settle…')
  await sleep(3000)

  if (!fs.existsSync(args.zip)) {
    log(`zip not found at ${args.zip}; aborting`)
    process.exit(3)
  }

  // Stage extraction in temp first so the install dir is only touched
  // once we have a known-good payload.
  const stagingDir = path.join(os.tmpdir(), `gd-update-stage-${process.pid}`)
  try {
    log(`extracting ${args.zip} to ${stagingDir}`)
    await extractZipTo(args.zip, stagingDir)
  } catch (e) {
    log(`extraction failed: ${String(e)}; aborting`)
    fs.rmSync(stagingDir, { recursive: true, force: true })
    process.exit(4)
  }

  // Some release tooling produces a zip with a single top-level folder
  // (e.g. "GitHub Desktop\..."). Flatten that one level if so.
  let payloadRoot = stagingDir
  const stagedEntries = listEntries(stagingDir)
  if (stagedEntries.length === 1 && stagedEntries[0].isDirectory()) {
    payloadRoot = path.join(stagingDir, stagedEntries[0].name)
    log(`flattening single top-level directory: ${stagedEntries[0].name}`)
  }

  // Overwrite the install folder in place. We deliberately do NOT rename the
  // target directory to a .bak first: on Windows that rename routinely fails
  // with EBUSY when any lingering handle (Electron helper, AV scanner,
  // Explorer preview) is still attached to the folder. Writing files into the
  // existing directory is far more tolerant — individual locked files just
  // get retried. The freshly extracted payload in `stagingDir` is our
  // rollback source if anything goes wrong.
  try {
    log(`copying payload into ${args.target}`)
    await copyTree(payloadRoot, args.target)
  } catch (e) {
    log(
      `copy failed: ${String(e)}; the install may be partially updated. ` +
        `Re-running the installer will repair it.`
    )
    fs.rmSync(stagingDir, { recursive: true, force: true })
    process.exit(6)
  }

  // Success — clean up staging.
  fs.rmSync(stagingDir, { recursive: true, force: true })
  try {
    fs.rmSync(args.zip, { force: true })
  } catch {
    /* ignore */
  }

  log('update applied successfully')
  relaunch(args.relaunch)

  if (logStream) {
    await new Promise<void>(r => logStream!.end(r))
  }

  scheduleSelfDelete()
  process.exit(0)
}

main().catch(e => {
  log(`unhandled error: ${String(e)}`)
  process.exit(1)
})
