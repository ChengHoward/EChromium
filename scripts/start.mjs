import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveRuntime, runtimeEnvironment } from './runtime.mjs'
import { buildMain } from './build.mjs'

const dev = process.argv.includes('--dev')
let server
if (dev) {
  await buildMain()
  const { createServer } = await import('vite')
  server = await createServer()
  await server.listen()
  console.log('Renderer ready at http://127.0.0.1:5188. Main-process edits require a restart.')
}
const child = spawn(resolveRuntime(), [path.resolve('.')], {
  stdio: 'inherit',
  // Electron is the visible desktop application, not a background console helper.
  windowsHide: false,
  env: runtimeEnvironment(dev ? { ECHROMIUM_RENDERER_URL: 'http://127.0.0.1:5188/' } : {}),
})
child.on('error', async (error) => {
  console.error(error)
  await server?.close()
  process.exitCode = 1
})
child.on('exit', async (code) => {
  await server?.close()
  process.exitCode = code ?? 1
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill())
