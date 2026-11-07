import { build } from 'esbuild'
import { build as buildRenderer } from 'vite'

export async function buildMain() {
  for (const [entry, output] of [
    ['src/main/index.ts', 'dist/main.cjs'],
    ['src/preload/index.ts', 'dist/preload.cjs'],
  ]) {
    await build({
      entryPoints: [entry],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
      sourcemap: true,
    })
  }
}
if (process.argv[1]?.endsWith('build.mjs')) {
  await buildMain()
  await buildRenderer()
}
