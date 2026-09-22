/** Controlled, same-origin end-to-end comparison. Does not contact Amazon. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { localNetworkPolicy } from '@w2l/contracts'
import { W2L } from '@w2l/sdk'
import { createApp, createApiEngine } from '@w2l/api'

const count = 6
const minDelayMs = 250
const originLatencyMs = 1_000
const root = await mkdtemp(join(tmpdir(), 'w2l-origin-compare-'))
const activity = new Map<number, { active: number; peak: number; starts: number[] }>()
const server = createServer(async (req, res) => {
  if (req.url === '/robots.txt') { res.writeHead(200).end('User-agent: *\nAllow: /'); return }
  const match = /^\/item\/(1|2|4)\/(\d+)$/.exec(req.url ?? '')
  if (!match) { res.writeHead(404).end(); return }
  const limit = Number(match[1])
  const state = activity.get(limit)!
  state.active++; state.peak = Math.max(state.peak, state.active); state.starts.push(performance.now())
  try {
    await new Promise(resolve => setTimeout(resolve, originLatencyMs))
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<html><head><title>Controlled product ${match[2]}</title></head><body><main><article><h1>Controlled product ${match[2]}</h1><p>This controlled product page contains enough stable descriptive prose for extraction. It is deliberately served after a fixed delay so that the configured origin concurrency can be measured without provider variance or real-site rate limits.</p></article></main></body></html>`)
  } finally { state.active-- }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

async function arm(limit: 1 | 2 | 4) {
  activity.set(limit, { active: 0, peak: 0, starts: [] })
  const engine = createApiEngine({
    taskRoot: join(root, String(limit)), workerCount: 4,
    networkPolicy: { ...localNetworkPolicy(), perHostConcurrency: limit, perHostMinDelayMs: minDelayMs },
  })
  const app = createApp(engine)
  const client = new W2L({ baseUrl: 'http://w2l.test', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch })
  const start = performance.now()
  try {
    const accepted = await client.batchScrape(Array.from({ length: count }, (_, n) => `${origin}/item/${limit}/${n + 1}`))
    const report = await client.waitBatch(accepted.taskId)
    const items = []
    for await (const item of client.listBatchItems(accepted.taskId)) items.push(item)
    const detail = await engine.getCrawlWithSteps(accepted.taskId)
    const state = activity.get(limit)!
    const gaps = state.starts.slice(1).map((time, i) => time - state.starts[i]!)
    const healthy = report.status === 'completed' && report.completed === count && items.length === count
      && items.every(item => item.status === 'success') && state.peak <= limit
      && gaps.every(gap => gap >= minDelayMs - 1)
    return {
      concurrency: limit, healthy, clientTotalMs: performance.now() - start,
      requested: report.requested, completed: report.completed, remaining: report.remaining,
      statuses: items.map(item => item.status), peakActive: state.peak,
      minStartGapMs: gaps.length ? Math.min(...gaps) : null,
      maxStartGapMs: gaps.length ? Math.max(...gaps) : null,
      retryCount: (detail?.steps ?? []).reduce((sum, step) => sum + Math.max(0, (step.audit?.summary.attempts.length ?? 1) - 1), 0),
    }
  } finally { await engine.close() }
}

try {
  const one = await arm(1)
  const two = await arm(2)
  const arms = [one, two]
  if (one.healthy && two.healthy) arms.push(await arm(4))
  const output = {
    kind: 'controlled-same-origin-batch',
    at: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    node: process.version,
    count,
    originLatencyMs,
    minDelayMs,
    minStartGapThresholdMs: minDelayMs - 1,
    arms,
    conclusion: arms.length === 3 && arms.every(arm => arm.healthy)
      ? 'All controlled arms healthy; this is not an Amazon throughput claim.'
      : 'One or more controlled arms failed; concurrency 4 was withheld when 1/2 were unhealthy.',
  }
  await mkdir('docs/evidence', { recursive: true })
  await writeFile('docs/evidence/same-origin-concurrency-controlled.json', JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(output, null, 2))
  if (!arms.every(arm => arm.healthy)) process.exitCode = 1
} finally {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
