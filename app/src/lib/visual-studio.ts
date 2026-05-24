import { spawn } from 'child_process'
import { readdir } from 'fs/promises'
import * as Path from 'path'
import { pathExists } from '../ui/lib/path-exists'

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
  if (!(await pathExists(VSWHERE_PATH))) {
    return null
  }

  const args = [
    '-latest',
    '-prerelease',
    '-products',
    '*',
    '-format',
    'json',
    '-utf8',
  ]

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(VSWHERE_PATH, args, {
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

  let parsed: ReadonlyArray<{
    installationPath?: string
    displayName?: string
    productPath?: string
  }>

  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null
  }

  const first = parsed[0]
  if (!first.installationPath) {
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
 * Find the first .sln file inside the given directory, searching up to
 * `maxDepth` levels deep (depth 0 = repository root only).
 */
export async function findSolutionFile(
  repositoryPath: string,
  maxDepth = 2
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
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.sln')) {
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
 * Launches Visual Studio with the given target (a .sln path or a folder).
 */
export function launchVisualStudio(
  install: IVisualStudioInstall,
  target: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(install.productPath, [target], {
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
