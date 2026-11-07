import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function resolveRuntime() {
  if (process.env.ECHROMIUM_ELECTRON) {
    const executable = path.resolve(process.env.ECHROMIUM_ELECTRON)
    if (!fs.existsSync(executable)) throw new Error(`Electron executable not found: ${executable}`)
    return executable
  }
  const lock = JSON.parse(fs.readFileSync(path.resolve('runtime-lock.json'), 'utf8'))
  const matches = (executable) =>
    crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex') === lock.executableSha256
  const prepared = path.resolve('.local/electron/runtime.json')
  if (fs.existsSync(prepared)) {
    const record = JSON.parse(fs.readFileSync(prepared, 'utf8'))
    if (record.executableSha256 !== lock.executableSha256)
      throw new Error(
        `Prepared runtime is outdated. Prepare ${lock.distribution} using runtime:prepare -- --source <electron.exe>.`,
      )
    if (!/^desktop-[a-f0-9]{12}$/.test(record.directory)) throw new Error('Invalid local runtime manifest')
    const executable = path.resolve('.local/electron', record.directory, 'electron.exe')
    if (fs.existsSync(executable)) {
      if (!matches(executable))
        throw new Error('Prepared executable checksum mismatch. Prepare the runtime again.')
      return executable
    }
  }
  const roots = [
    path.resolve('node_modules/electron'),
    'D:/electron/navora-harness/navora-desktop/node_modules/electron',
  ]
  for (const root of roots) {
    const pointer = path.join(root, 'path.txt')
    if (!fs.existsSync(pointer)) continue
    const executable = path.resolve(root, 'dist', fs.readFileSync(pointer, 'utf8').trim())
    if (fs.existsSync(executable) && matches(executable)) return executable
  }
  throw new Error(
    `Install and prepare ${lock.distribution}. See README.md, or explicitly set ECHROMIUM_ELECTRON for a custom development build.`,
  )
}

export function runtimeEnvironment(extra = {}) {
  const env = {
    ...process.env,
    ECHROMIUM_USER_DATA: process.env.ECHROMIUM_USER_DATA || path.resolve('.local/user-data'),
    ...extra,
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
