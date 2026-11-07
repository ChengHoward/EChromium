import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveRuntime, runtimeEnvironment } from './runtime.mjs'

await build({
  entryPoints: ['src/main/ui-review.ts'],
  outfile: 'dist/ui-review.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
})
const child = spawn(resolveRuntime(), [path.resolve('dist/ui-review.cjs')], {
  stdio: 'inherit',
  windowsHide: false,
  env: runtimeEnvironment(),
})
const timeout = setTimeout(() => {
  console.error('UI review timed out')
  child.kill()
}, 45000)
child.once('error', (error) => {
  console.error(error)
  clearTimeout(timeout)
  process.exitCode = 1
})
child.once('exit', (code) => {
  clearTimeout(timeout)
  process.exitCode = code ?? 1
})
