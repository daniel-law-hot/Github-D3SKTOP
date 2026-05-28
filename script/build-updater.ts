/* eslint-disable no-sync */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import * as path from 'path'
import { getDistRoot } from './dist-info'

const repoRoot = path.join(__dirname, '..')
const updaterRoot = path.join(repoRoot, 'updater')
const distRoot = getDistRoot()

function run(cmd: string, args: string[], cwd: string) {
  console.log(`> ${cmd} ${args.join(' ')}  (in ${cwd})`)
  // shell: true is required on Windows for .cmd/.bat shims (e.g. tsc.cmd,
  // pkg.cmd in node_modules\.bin). Without it execFileSync fails with EINVAL.
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

if (!existsSync(distRoot)) {
  mkdirSync(distRoot, { recursive: true })
}

console.log('Compiling updater TypeScript…')
const tscBin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
run(tscBin, ['-p', updaterRoot], repoRoot)

console.log('Bundling updater into a single Windows executable via @yao-pkg/pkg…')
const pkgBin = process.platform === 'win32' ? 'pkg.cmd' : 'pkg'
const entry = path.join(updaterRoot, 'build', 'main.js')
const out = path.join(distRoot, 'updater.exe')
run(
  pkgBin,
  ['--targets', 'node22-win-x64', '--output', out, entry],
  repoRoot
)

console.log(`Updater bundled at ${out}`)
