/**
 * Run after `npm run typecheck`:
 *   node --import tsx scripts/section-b/monitor-claim-race.ts
 *
 * Two real Node processes open the same initially absent SQLite file and claim
 * the same trigger after one IPC barrier. No mocked clock, claim, or assessment.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import Database from 'better-sqlite3'
import { MonitorStore, runConfiguredMonitor } from '@w2l/runtime'
import { ResilientHttpSubject } from '@w2l/bench'
import type { MonitorRevision } from '@w2l/contracts'

const self = fileURLToPath(import.meta.url)
const triggerKey = 'same-concurrent-trigger'
const monitorId = 'concurrent-claim'
type Start = { type: 'start'; startAt: number; dbPath: string; revision: MonitorRevision }
type Message = { type: string; pid: number; at: number; [key: string]: unknown }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)))
const send = (message: Message) => new Promise<void>((resolve, reject) => {
  if (!process.send) { reject(new Error('worker requires IPC')); return }
  process.send(message, error => error ? reject(error) : resolve())
})

if (process.argv[2] === 'worker') {
  const startMessage = new Promise<Start>(resolve => {
    process.once('message', message => resolve(message as Start))
  })
  await send({ type: 'ready', pid: process.pid, at: Date.now() })
  let store: MonitorStore | undefined
  const subject = new ResilientHttpSubject()
  try {
    const start = await startMessage
    assert.equal(start.type, 'start')
    await sleep(start.startAt - Date.now())
    await send({ type: 'starting', pid: process.pid, at: Date.now() })
    store = MonitorStore.open(start.dbPath)
    await send({ type: 'db-opened', pid: process.pid, at: Date.now() })
    const view = await runConfiguredMonitor(store, start.revision, async options => {
      await send({ type: 'capture-starting', pid: process.pid, at: Date.now() })
      const result = await subject.fetch(start.revision.url, options.deadlineAt, options.signal, options, options.onRetryAfter)
      return { result, links: result.links ?? [] }
    }, triggerKey)
    await send({
      type: 'result', pid: process.pid, at: Date.now(),
      runIds: view.runs.map(run => run.id), states: view.runs.map(run => run.state),
      eventIds: view.events.map(event => event.id), baselineVersion: view.baseline?.version ?? null,
    })
  } catch (error) {
    await send({ type: 'failure', pid: process.pid, at: Date.now(), error: error instanceof Error ? error.stack : String(error) })
    process.exitCode = 1
  } finally {
    store?.close()
    await subject.teardown()
    process.disconnect?.()
  }
} else {
  const root = resolve(process.env.W2L_GATE2_CLAIM_RACE_ROOT ?? `.w2l/gate2-claim-race-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const dbPath = join(root, 'section-b-control.sqlite')
  assert.equal(existsSync(dbPath), false, 'experiment requires an initially absent SQLite database')
  const output = resolve('research/gate2-claim-race.generated.json')
  const messages: Message[] = []
  const requests: { at: number; path: string; remotePort: number | undefined }[] = []
  const heldResponses = new Set<ServerResponse>()
  const source = createServer((req, res) => {
    requests.push({ at: Date.now(), path: req.url ?? '', remotePort: req.socket.remotePort })
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /\n')
      return
    }
    if (req.url !== '/product') { res.writeHead(404).end(); return }
    heldResponses.add(res)
    // Keep the winning capture active while the other process attempts claim.
    setTimeout(() => {
      heldResponses.delete(res)
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' })
      res.end('<html><head><title>Product</title></head><body><main><article><h1>Product</h1><h2>Price</h2><p>10.00</p><h2>Description</h2><p>This controlled source provides a public product document with a stable decimal price field. Both workers use the production HTTP extractor and configured document assessment, including its title and required-field checks. The source body is held briefly so that the second process sees the first process while it owns a live execution lease. No observation, assessment, snapshot, or event is fabricated for this experiment.</p></article></main></body></html>')
    }, 400)
  })
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(source.address() as AddressInfo).port}/product`
  const revision: MonitorRevision = {
    monitorId, revision: 1, url, ruleVersion: 'claim-race-price/v1',
    intervalMs: 3_600_000, staleAfterMs: 7_200_000, createdAt: Date.now(),
    config: {
      adapter: 'markdown-sections/v1', workspaceId: 'claim-race-lab', entityKey: 'product', viewKey: 'public',
      expectedTitle: 'Product', schemaVersion: 'price/v1', captureMode: 'http', conditionalRequests: false,
      fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }],
    },
  }
  const children: ChildProcess[] = []
  const exits: Promise<{ pid: number | undefined; code: number | null; signal: NodeJS.Signals | null; stderr: string }>[] = []
  let timeout: ReturnType<typeof setTimeout> | undefined
  let verifier: MonitorStore | undefined
  let inspect: Database.Database | undefined
  try {
    const ready = [0, 1].map(() => new Promise<void>((resolveReady, rejectReady) => {
      const child = spawn(process.execPath, ['--import', 'tsx', self, 'worker'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
      children.push(child)
      let stderr = ''
      child.stderr!.on('data', chunk => { stderr += String(chunk) })
      child.on('message', value => {
        const message = value as Message
        messages.push(message)
        if (message.type === 'ready') resolveReady()
      })
      child.once('error', rejectReady)
      exits.push(new Promise((resolveExit, rejectExit) => {
        child.once('error', rejectExit)
        child.once('exit', (code, signal) => {
          rejectReady(new Error(`worker exited before ready: ${code} ${signal} ${stderr}`))
          resolveExit({ pid: child.pid, code, signal, stderr })
        })
      }))
    }))
    const experiment = (async () => {
      await Promise.all(ready)
      const startAt = Date.now() + 100
      for (const child of children) child.send({ type: 'start', startAt, dbPath, revision } satisfies Start)
      const processes = await Promise.all(exits)
      assert.deepEqual(processes.map(child => child.code), [0, 0], JSON.stringify({ processes, messages }))
      assert.equal(messages.filter(message => message.type === 'result').length, 2)
      assert.equal(messages.filter(message => message.type === 'failure').length, 0)
      const starts = messages.filter(message => message.type === 'starting')
      const ends = messages.filter(message => message.type === 'result')
      assert.equal(starts.length, 2)
      assert.ok(Math.max(...starts.map(message => message.at)) < Math.min(...ends.map(message => message.at)), 'worker execution intervals must overlap')
      assert.equal(messages.filter(message => message.type === 'capture-starting').length, 1)
      assert.equal(requests.filter(request => request.path === '/product').length, 1)

      verifier = MonitorStore.open(dbPath)
      const beforeReplay = verifier.view(monitorId, Date.now())
      assert.equal(beforeReplay.runs.length, 1)
      assert.equal(beforeReplay.runs[0]!.state, 'completed')
      assert.equal(beforeReplay.runs[0]!.quality, 'valid')
      assert.equal(beforeReplay.runs[0]!.change, 'initialized')
      const attempts = verifier.attempts(beforeReplay.runs[0]!.id)
      assert.equal(attempts.length, 1)
      assert.equal(attempts[0]!.state, 'succeeded')
      assert.equal(beforeReplay.events.length, 1)
      assert.equal(beforeReplay.baseline?.version, 1)
      for (const result of messages.filter(message => message.type === 'result')) assert.deepEqual(result.runIds, [beforeReplay.runs[0]!.id])
      let replayCaptures = 0
      const replay = await runConfiguredMonitor(verifier, revision, async () => { replayCaptures++; throw new Error('completed trigger must replay without capture') }, triggerKey)
      assert.equal(replayCaptures, 0)
      assert.equal(replay.events[0]!.id, beforeReplay.events[0]!.id)
      assert.equal(replay.baseline!.id, beforeReplay.baseline!.id)
      inspect = new Database(dbPath, { readonly: true, fileMustExist: true })
      const counts = Object.fromEntries(['monitor_runs', 'monitor_attempts', 'monitor_observations', 'monitor_assessments', 'monitor_snapshots', 'monitor_baselines', 'monitor_events', 'monitor_outbox'].map(table => [table, (inspect!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]))
      for (const [table, count] of Object.entries(counts)) assert.equal(count, 1, `${table} must contain exactly one row`)
      const report = {
        generatedAt: new Date().toISOString(), passed: true,
        scope: 'Two independent Node processes concurrently open an absent SQLite database and claim the same monitor/trigger using production HTTP capture and configured assessment; IPC barrier and real clock.',
        productionModules: { runtime: import.meta.resolve('@w2l/runtime'), bench: import.meta.resolve('@w2l/bench') },
        root, dbPath, startAt, triggerKey, monitorId, processes, messages, sourceRequests: requests,
        sourceCaptures: requests.filter(request => request.path === '/product').length,
        counts, runId: replay.runs[0]!.id, attemptId: attempts[0]!.id, eventId: replay.events[0]!.id,
        baselineId: replay.baseline!.id, baselineVersion: replay.baseline!.version,
        postCompletionReplay: { captures: replayCaptures, sameRun: true, sameEvent: true, sameBaseline: true },
        evidence: verifier.exportEvidence(monitorId),
      }
      await mkdir(resolve('research'), { recursive: true })
      await writeFile(output, JSON.stringify(report, null, 2) + '\n')
      console.log(JSON.stringify({ passed: true, output, root, sourceCaptures: 1, runs: 1, attempts: 1, events: 1, baselines: 1, processExitCodes: processes.map(child => child.code) }))
    })()
    await Promise.race([experiment, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`claim race timed out: ${JSON.stringify(messages)}`)), 20_000) })])
  } catch (error) {
    await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), passed: false, root, dbPath, messages, sourceRequests: requests, error: error instanceof Error ? error.stack : String(error) }, null, 2) + '\n')
    throw error
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    inspect?.close()
    verifier?.close()
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    for (const response of heldResponses) response.destroy()
    source.closeAllConnections()
    await new Promise<void>(resolve => source.close(() => resolve()))
  }
}
