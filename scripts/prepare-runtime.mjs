import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolveRuntime } from './runtime.mjs'

const sourceIndex = process.argv.indexOf('--source')
if (sourceIndex >= 0 && !process.argv[sourceIndex + 1])
  throw new Error('--source requires an executable path')
const source = sourceIndex >= 0 ? path.resolve(process.argv[sourceIndex + 1]) : resolveRuntime()
if (!fs.existsSync(source)) throw new Error(`Runtime executable not found: ${source}`)
const stageOnly = process.argv.includes('--stage-only')
const root = path.resolve('.local/electron')
const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
const lock = JSON.parse(fs.readFileSync(path.resolve('runtime-lock.json'), 'utf8'))
if (digest !== lock.executableSha256)
  throw new Error(
    `Runtime does not match ${lock.distribution}. Prepare the matching executable with --source.`,
  )
const directory = `desktop-${digest.slice(0, 12)}`
const destination = path.join(root, directory)
if (!fs.existsSync(destination)) fs.cpSync(path.dirname(source), destination, { recursive: true })
// Only local runtime binaries receive read/execute access. Never alter the source installation.
if (process.platform === 'win32') {
  const result = spawnSync('icacls', [destination, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0)
    throw new Error(`Could not grant sandbox read access: ${result.stderr || result.stdout}`)
}
const manifest = path.join(root, stageOnly ? 'candidate.json' : 'runtime.json')
const temporary = `${manifest}.${crypto.randomUUID()}.tmp`
fs.writeFileSync(
  temporary,
  JSON.stringify(
    {
      directory,
      source,
      distribution: lock.distribution,
      executableSha256: digest,
      preparedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
)
fs.renameSync(temporary, manifest)
console.log(`${stageOnly ? 'Candidate' : 'Project'} runtime ready: ${path.join(destination, 'electron.exe')}`)
