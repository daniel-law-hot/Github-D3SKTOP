import { spawn } from 'child_process'
import { readdir } from 'fs/promises'
import * as Path from 'path'
import { pathExists } from './path-exists'

/**
 * Information about a Visual Studio installation as reported by vswhere.
 */
export interface IVisualStudioInstall {
  readonly installationPath: string
  readonly displayName: string
  readonly productPath: string
}

const VSWHERE_PATH = Path.join(
  process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe'
)

/**
 * Run vswhere.exe (shipped with the VS Installer since 2017) and return
 * details about the latest Visual Studio install, or null if none is found.
 */
async function findLatestVisualStudio(): Promise<IVisualStudioInstall | null> {
  const first = await runVswhereFirst([
    '-latest',
    '-prerelease',
    '-products',
    'Microsoft.VisualStudio.Product.Enterprise',
    'Microsoft.VisualStudio.Product.Professional',
    'Microsoft.VisualStudio.Product.Community',
    '-requires',
    'Microsoft.VisualStudio.Workload.CoreEditor',
  ])

  if (!first) {
    return null
  }

  const productPath =
    first.productPath ??
    Path.join(first.installationPath, 'Common7', 'IDE', 'devenv.exe')

  if (!(await pathExists(productPath))) {
    return null
  }

  return {
    installationPath: first.installationPath,
    displayName: first.displayName ?? 'Visual Studio',
    productPath,
  }
}

let cachedInstall: Promise<IVisualStudioInstall | null> | null = null

/** Memoized lookup of the latest Visual Studio install. */
export function getLatestVisualStudio(): Promise<IVisualStudioInstall | null> {
  if (!__WIN32__) {
    return Promise.resolve(null)
  }
  if (cachedInstall === null) {
    cachedInstall = findLatestVisualStudio()
  }
  return cachedInstall
}

/**
 * Run vswhere with the given args and return the first installation entry, or
 * null if vswhere isn't installed, nothing matches, or parsing fails.
 */
async function runVswhereFirst(
  args: ReadonlyArray<string>
): Promise<{
  installationPath: string
  displayName?: string
  productPath?: string
} | null> {
  if (!(await pathExists(VSWHERE_PATH))) {
    return null
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(VSWHERE_PATH, [...args, '-format', 'json', '-utf8'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    child.stdout.on('data', chunk => (buf += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', code =>
      code === 0 ? resolve(buf) : reject(new Error(`vswhere exited ${code}`))
    )
  }).catch(() => '')

  if (!stdout) {
    return null
  }

  try {
    const parsed = JSON.parse(stdout)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].installationPath) {
      return parsed[0]
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * Information about a SQL Server Management Studio installation.
 */
export interface ISsmsInstall {
  readonly installationPath: string
  readonly displayName: string
  readonly productPath: string
}

const SSMS_LEGACY_VERSIONS: ReadonlyArray<number> = [20, 19, 18]

/**
 * Find SSMS 21+ via vswhere (it's built on the VS shell and registered with
 * the VS Installer), or fall back to known install paths for SSMS 18/19/20.
 */
async function findLatestSsms(): Promise<ISsmsInstall | null> {
  const fromVswhere = await runVswhereFirst([
    '-latest',
    '-prerelease',
    '-products',
    'Microsoft.SqlServer.SSMS',
  ])

  if (fromVswhere && fromVswhere.productPath) {
    if (await pathExists(fromVswhere.productPath)) {
      return {
        installationPath: fromVswhere.installationPath,
        displayName: fromVswhere.displayName ?? 'SQL Server Management Studio',
        productPath: fromVswhere.productPath,
      }
    }
  }

  // Legacy SSMS 18/19/20 ships as a standalone install under Program Files (x86).
  const programFilesX86 =
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'

  for (const version of SSMS_LEGACY_VERSIONS) {
    const installRoot = Path.join(
      programFilesX86,
      `Microsoft SQL Server Management Studio ${version}`
    )
    const exePath = Path.join(installRoot, 'Common7', 'IDE', 'Ssms.exe')
    if (await pathExists(exePath)) {
      return {
        installationPath: installRoot,
        displayName: `SQL Server Management Studio ${version}`,
        productPath: exePath,
      }
    }
  }

  return null
}

let cachedSsmsInstall: Promise<ISsmsInstall | null> | null = null

/** Memoized lookup of the latest SSMS install. */
export function getLatestSsms(): Promise<ISsmsInstall | null> {
  if (!__WIN32__) {
    return Promise.resolve(null)
  }
  if (cachedSsmsInstall === null) {
    cachedSsmsInstall = findLatestSsms()
  }
  return cachedSsmsInstall
}

/**
 * Find the first file with one of the given extensions inside the given
 * directory, searching up to `maxDepth` levels deep (depth 0 = repository root
 * only). Extensions are matched case-insensitively and must include the dot
 * (e.g. ['.sln']).
 */
async function findFileWithExtension(
  repositoryPath: string,
  extensions: ReadonlyArray<string>,
  maxDepth: number
): Promise<string | null> {
  const skipDirs = new Set([
    '.git',
    'node_modules',
    'bin',
    'obj',
    '.vs',
    'dist',
    'out',
    'build',
  ])

  const search = async (dir: string, depth: number): Promise<string | null> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }
      const lower = entry.name.toLowerCase()
      if (extensions.some(ext => lower.endsWith(ext))) {
        return Path.join(dir, entry.name)
      }
    }

    if (depth >= maxDepth) {
      return null
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skipDirs.has(entry.name)) {
        continue
      }
      const found = await search(Path.join(dir, entry.name), depth + 1)
      if (found) {
        return found
      }
    }

    return null
  }

  return search(repositoryPath, 0)
}

/**
 * Find the first .sln file inside the given directory, searching up to
 * `maxDepth` levels deep (depth 0 = repository root only).
 */
export function findSolutionFile(
  repositoryPath: string,
  maxDepth = 2
): Promise<string | null> {
  return findFileWithExtension(repositoryPath, ['.sln'], maxDepth)
}

/**
 * Find the first SSMS solution/project file (.ssmssln or .ssmssqlproj) inside
 * the given directory. These are the SSMS-specific solution formats and are a
 * strong signal that a repo is database-script focused rather than code.
 */
export function findSsmsSolutionFile(
  repositoryPath: string,
  maxDepth = 2
): Promise<string | null> {
  return findFileWithExtension(
    repositoryPath,
    ['.ssmssln', '.ssmssqlproj'],
    maxDepth
  )
}

function launchDetached(
  productPath: string,
  args: ReadonlyArray<string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(productPath, args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * Launches Visual Studio with the given target (a .sln path or a folder).
 */
export function launchVisualStudio(
  install: IVisualStudioInstall,
  target: string
): Promise<void> {
  return launchDetached(install.productPath, [target])
}

/**
 * Launches SSMS. If `target` is provided it's passed as a positional argument
 * (e.g. a .ssmssln or .sql file); otherwise SSMS starts with its connect
 * dialog since SSMS has no folder/workspace concept.
 */
export function launchSsms(
  install: ISsmsInstall,
  target?: string
): Promise<void> {
  return launchDetached(install.productPath, target ? [target] : [])
}
