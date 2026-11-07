import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveRuntime, runtimeEnvironment } from './runtime.mjs'

const directory = path.resolve('test-results')
fs.mkdirSync(directory, { recursive: true })
const report = path.join(directory, 'smoke.json')
const fixture = (request, response) => {
  if (request.url === '/sw.js') {
    response.writeHead(200, { 'content-type': 'application/javascript' })
    response.end(
      'self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(clients.claim()))',
    )
    return
  }
  if (request.url === '/download') {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="fixture.txt"',
    })
    response.end('EChromium download fixture')
    return
  }
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' })
    response.end(
      `<!doctype html><html><head><title>${request.url === '/two' ? 'Fixture two' : 'Fixture one'}</title></head><body><h1>Browser fixture</h1><p id="result"></p><button id="activate">Activate</button><a href="/two">Second page</a><input id="input"><script>document.getElementById('result').textContent=${JSON.stringify(request.method + ' ' + body)};</script></body></html>`,
    )
  })
}
const server = http.createServer(fixture),
  otherServer = http.createServer(fixture)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
await new Promise((resolve) => otherServer.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const otherOrigin = `http://127.0.0.1:${otherServer.address().port}`
async function run(extra = {}) {
  const child = spawn(resolveRuntime(), [path.resolve('.')], {
    stdio: 'inherit',
    windowsHide: true,
    env: runtimeEnvironment({
      ECHROMIUM_USER_DATA: path.resolve(`.local/smoke-${Date.now()}`),
      ECHROMIUM_SMOKE: '1',
      ECHROMIUM_SMOKE_ORIGIN: origin,
      ECHROMIUM_SMOKE_OTHER_ORIGIN: otherOrigin,
      ECHROMIUM_SMOKE_REPORT: report,
      ...extra,
    }),
  })
  const timeout = setTimeout(() => {
    console.error('Electron smoke timed out')
    child.kill()
  }, 90000)
  const code = await new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', (error) => {
      console.error(error)
      resolve(1)
    })
  })
  clearTimeout(timeout)
  return code
}
let code = await run()
if (code === 0) {
  console.log(fs.readFileSync(report, 'utf8'))
  const profile = path.resolve(`.local/session-smoke-${Date.now()}`)
  for (const phase of ['write', 'read', 'closed', 'disabled']) {
    code = await run({ ECHROMIUM_USER_DATA: profile, ECHROMIUM_SESSION_SMOKE: phase })
    if (code !== 0) break
  }
  if (fs.existsSync(path.join(directory, 'session-restore.json')))
    console.log(fs.readFileSync(path.join(directory, 'session-restore.json'), 'utf8'))
}
server.close()
otherServer.close()
if (code !== 0) process.exitCode = 1
