import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

await build({
  entryPoints: ['tests/domain.test.ts'],
  outfile: 'dist-tests/domain.test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
})
const result = spawnSync(process.execPath, ['--test', path.resolve('dist-tests/domain.test.mjs')], {
  stdio: 'inherit',
})
process.exitCode = result.status ?? 1
