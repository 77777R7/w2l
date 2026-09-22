/** Real process faults against the production capture/assessment/SQLite path. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiEngine } from '../../packages/api/src/engine.js'
import { MonitorStore } from '@w2l/runtime'
import Database from 'better-sqlite3'
import type { MonitorRevision } from '@w2l/contracts'

const self = fileURLToPath(import.meta.url)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const leaseMs = 700
if (process.argv[2] === 'child') {
  const [, , , root, mode, monitorId, trigger] = process.argv
  if (mode === 'before-commit' || mode === 'after-commit') {
    const original = MonitorStore.prototype.commit
    MonitorStore.prototype.commit = function (...args) {
      if (mode === 'before-commit') {
        writeSync(1, JSON.stringify({checkpoint: mode}) + '\n'); process.kill(process.pid, 'SIGSTOP')
      }
      const value = original.apply(this, args)
      if (mode === 'after-commit') {
        writeSync(1, JSON.stringify({checkpoint: mode}) + '\n'); process.kill(process.pid, 'SIGSTOP')
      }
      return value
    }
  }
  const engine = createApiEngine({taskRoot: root, monitorLeaseMs: leaseMs, monitorAttemptTimeoutMs: 30_000})
  try { console.log(JSON.stringify(await engine.runMonitor(monitorId!, trigger))) }
  finally { await engine.close() }
} else {
  const root = resolve(process.env.W2L_GATE2_ROOT ?? `.w2l/gate2-evidence-${Date.now()}`)
  await mkdir(root, {recursive: true})
  let hang = false, retryAfter = false, requestStarted: (() => void) | undefined
  const requests: {at: number; url: string}[] = []
  const server = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nAllow: /'); return }
    requests.push({at: Date.now(), url: req.url ?? ''})
    requestStarted?.()
    if (hang) return
    if (retryAfter) {res.writeHead(503,{'retry-after':'3'}).end('Please retry later');return}
    res.writeHead(200, {'content-type': 'text/html'})
    res.end('<html><head><title>Product</title></head><body><main><article><h1>Product</h1><h2>Price</h2><p>10.00</p><h2>Description</h2><p>This controlled fixture provides a complete public document and a stable price field. It is deliberately long enough to pass the same production extraction and document quality assessment used for real monitor jobs. Only process crashes are injected; observations and assessments are never fabricated in this experiment.</p></article></main></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/product`
  const evidence: Record<string, unknown>[] = []
  const children = new Set<ChildProcess>()
  try {
    for (const mode of ['capture-in-flight', 'before-commit', 'after-commit', 'retry-after-in-flight']) {
      const monitorId = mode, trigger = `fault:${mode}`
      const revision: MonitorRevision = {monitorId, revision: 1, url, ruleVersion:'price/v1', intervalMs:3_600_000, staleAfterMs:7_200_000, createdAt:Date.now(), config:{adapter:'markdown-sections/v1',workspaceId:'fault-lab',entityKey:mode,viewKey:'public',expectedTitle:'Product',schemaVersion:'price/v1',captureMode:'http',conditionalRequests:false,fields:[{name:'price',heading:'Price',type:'decimal',required:true}]}}
      let engine = createApiEngine({taskRoot:root, monitorLeaseMs:leaseMs, monitorAttemptTimeoutMs:30_000})
      engine.configureMonitor(revision); await engine.close()
      hang = mode === 'capture-in-flight'
      retryAfter = mode === 'retry-after-in-flight'
      let checkpointResolve!: () => void
      const checkpoint = new Promise<void>(resolve => {checkpointResolve = resolve})
      requestStarted = hang || retryAfter ? checkpointResolve : undefined
      const child = spawn(process.execPath, ['--import','tsx',self,'child',root,mode,monitorId,trigger], {stdio:['ignore','pipe','pipe']})
      children.add(child)
      let stdout = '', stderr = ''
      child.stdout!.on('data', chunk => {stdout += String(chunk); if (stdout.includes('"checkpoint"')) checkpointResolve()})
      child.stderr!.on('data', chunk => {stderr += String(chunk)})
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([checkpoint, new Promise<never>((_,reject) => {timeout=setTimeout(() => reject(new Error(`no checkpoint for ${mode}: ${stderr}`)),15_000)}), once(child,'exit').then(() => {throw new Error(`child ended before ${mode}: ${stdout} ${stderr}`)})])
      } finally {clearTimeout(timeout)}
      let earliestRetryAt: number | null = null
      if (retryAfter) {
        const until = Date.now()+2500
        while(Date.now()<until) {
          const db = new Database(join(root,'section-b-control.sqlite'),{readonly:true})
          try { earliestRetryAt = (db.prepare('SELECT not_before FROM monitor_origin_cooldowns WHERE origin=?').get(new URL(url).origin) as {not_before:number}|undefined)?.not_before ?? null } finally {db.close()}
          if (earliestRetryAt) break
          await sleep(10)
        }
        assert.ok(earliestRetryAt,'Retry-After must be durable before the inline wait')
      }
      const before = MonitorStore.open(join(root,'section-b-control.sqlite'))
      const prior = before.view(monitorId,Date.now()), oldRun = prior.runs[0]!
      before.close()
      const killedAt = Date.now(), closed = once(child,'close'); child.kill('SIGKILL'); await closed; children.delete(child)
      hang = false; retryAfter = false; requestStarted = undefined
      server.closeAllConnections()
      // Wait for the actual persisted lease on the real clock; never advance an injected clock.
      const waitMs = Math.max(0,(oldRun.leaseUntil ?? 0)-Date.now()+40)
      await sleep(waitMs)
      engine = createApiEngine({taskRoot:root,monitorLeaseMs:leaseMs,monitorAttemptTimeoutMs:30_000})
      if (earliestRetryAt && earliestRetryAt > Date.now()) {
        const requestCount = requests.length
        const deferred = await engine.runMonitor(monitorId,trigger)
        assert.equal(deferred.runs[0]!.state,'waiting_retry')
        assert.equal(requests.length,requestCount,'restart must not request before publisher Retry-After')
        await sleep(Math.max(0,earliestRetryAt-Date.now()+40))
      }
      const restored = await engine.runMonitor(monitorId,trigger)
      await engine.close()
      assert.equal(restored.runs.length,1)
      assert.equal(restored.runs[0]!.id,oldRun.id)
      assert.equal(restored.runs[0]!.state,'completed')
      assert.equal(restored.runs[0]!.quality,'valid')
      assert.equal(restored.baseline?.version,1)
      assert.equal(restored.events.length,1)
      const store = MonitorStore.open(join(root,'section-b-control.sqlite'))
      const attempts = store.attempts(oldRun.id)
      if (mode !== 'after-commit') {
        assert.equal(attempts.length,2)
        assert.equal(attempts.find(a=>a.id===oldRun.attemptId)?.state,'interrupted')
        assert.equal(restored.runs[0]!.fencingToken,oldRun.fencingToken+1)
      } else { assert.equal(attempts.length,1); assert.equal(restored.events[0]!.id,prior.events[0]!.id) }
      evidence.push({mode,killedAt,earliestRetryAt,realLeaseWaitMs:waitMs,runId:oldRun.id,oldAttemptId:oldRun.attemptId,attempts,eventId:restored.events[0]!.id,baselineVersion:restored.baseline!.version,passed:true})
      store.close()
    }
    const report = {generatedAt:new Date().toISOString(),scope:'controlled source with production HTTP capture, validator and SQLite; real SIGKILL',root,leaseMs,requests,experiments:evidence,passed:true}
    const output = resolve('research/gate2-process-recovery.generated.json')
    await writeFile(output,JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({passed:true,experiments:evidence.length,output,root}))
  } finally {
    for (const child of children) child.kill('SIGKILL')
    server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve()))
  }
}
