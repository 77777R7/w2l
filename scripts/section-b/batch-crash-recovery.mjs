/** Kill the API mid-batch, restart it, and verify checkpoint recovery. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { W2L } from '@w2l/sdk'

async function freePort() {
  const probe = createTcpServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  return port
}

await mkdir('.w2l', { recursive: true })
const taskRoot = await mkdtemp('.w2l/batch-crash-')
let slow = true
let releaseSlow = () => {}
let secondStarted = () => {}
const secondRequest = new Promise(resolve => { secondStarted = resolve })
const hits = { first: 0, second: 0 }
const fixture = createServer(async (req, res) => {
  if (req.url === '/robots.txt') { res.writeHead(200).end('User-agent: *\nAllow: /'); return }
  if (req.url === '/item/1') hits.first++
  if (req.url === '/item/2') {
    hits.second++
    if (slow) { secondStarted(); await new Promise(resolve => { releaseSlow = resolve }) }
  }
  if (res.destroyed) return
  const n = req.url?.split('/').at(-1) ?? '0'
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<html><head><title>Crash fixture ${n}</title></head><body><main><article><h1>Crash fixture ${n}</h1><p>This controlled product page contains enough stable body text to be accepted by the extractor. It allows the first page to finish while the second stays in flight, then proves that a process crash only requires refetching the unfinished page.</p></article></main></body></html>`)
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
const apiPort = await freePort()
const baseUrl = `http://127.0.0.1:${apiPort}`
const client = new W2L({ baseUrl })
let child = null
function startApi() {
  const proc = spawn(globalThis.process.execPath, ['--import', 'tsx', 'packages/api/src/cli.ts', '--port', String(apiPort)], {
    env: { ...globalThis.process.env, W2L_TASK_ROOT: taskRoot, W2L_PER_HOST_CONCURRENCY: '1', W2L_PER_HOST_MIN_DELAY_MS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stderr.on('data', data => globalThis.process.stderr.write(data))
  proc.stdout.resume()
  child = proc
  return proc
}
async function ready(proc) {
  for (let n = 0; n < 100; n++) {
    if (proc.exitCode !== null) throw new Error(`API exited: ${proc.exitCode}`)
    try { await fetch(`${baseUrl}/missing`); return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('API not ready')
}
async function stop(proc, signal) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
  const exited = new Promise(resolve => proc.once('exit', resolve))
  proc.kill(signal)
  await exited
}

const startedAt = new Date().toISOString()
try {
  await ready(startApi())
  const { taskId } = await client.batchScrape([`${origin}/item/1`, `${origin}/item/2`])
  let timeout
  try {
    await Promise.race([secondRequest, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('second URL did not start')), 30_000) })])
  } finally { clearTimeout(timeout) }
  await stop(child, 'SIGKILL')
  slow = false
  releaseSlow()
  await ready(startApi())
  const report = await client.waitBatch(taskId, { signal: AbortSignal.timeout(60_000) })
  const items = [...(await client.getBatchItems(taskId)).items]
  const output = {
    kind: 'batch-actual-process-crash-recovery', startedAt, endedAt: new Date().toISOString(),
    taskId, firstProcessStoppedBy: 'SIGKILL', status: report.status,
    requested: report.requested, completed: report.completed,
    items: items.map(item => ({ url: item.url, status: item.status })),
    hits,
    passed: report.status === 'completed' && report.completed === 2 && items.length === 2
      && items.every(item => item.status === 'success') && hits.first === 1 && hits.second === 2,
  }
  await mkdir('docs/evidence', { recursive: true })
  await writeFile('docs/evidence/batch-crash-recovery.json', JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(output, null, 2))
  if (!output.passed) globalThis.process.exitCode = 1
} finally {
  releaseSlow()
  await stop(child, 'SIGTERM')
  fixture.closeAllConnections()
  await new Promise(resolve => fixture.close(resolve))
}
