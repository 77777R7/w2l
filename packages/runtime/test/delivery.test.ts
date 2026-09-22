import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type Server } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { connect as connectTcp, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { hostedNetworkPolicy, type WebhookEventEnvelope } from '@w2l/contracts'
import { DeliveryStore } from '../src/deliveryStore.js'
import { createHttpsWebhookTransport, DeliveryWorker, parseWebhookRetryAfter, webhookSignature } from '../src/deliveryWorker.js'
import { WebhookInbox, verifyWebhookSignature } from '../src/webhookInbox.js'

const dirs: string[] = []
const closers: (() => void)[] = []
let ca: Buffer
let key: Buffer
let caPath: string
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'w2l-webhook-tls-'))
  caPath = join(dir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', caPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  ca = readFileSync(caPath)
  key = readFileSync(join(dir, 'key.pem'))
  return () => rmSync(dir, { recursive: true, force: true })
})
afterEach(() => { closers.splice(0).reverse().forEach(close => close()); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
function dbPath(): string { const dir = mkdtempSync(join(tmpdir(), 'w2l-delivery-')); dirs.push(dir); return join(dir, 'control.sqlite') }
function openStore(path = dbPath()): DeliveryStore { const store = DeliveryStore.open(path); closers.push(() => { try { store.close() } catch {} }); return store }
function envelope(version = 1, monitorId = 'monitor-a'): WebhookEventEnvelope {
  return {
    schemaVersion: 'w2l.monitor-event/v1', eventId: `${monitorId}-event-${version}`, eventVersion: version,
    monitorId, workspaceId: 'workspace-a', entityKey: 'entity-a', viewKey: 'public',
    event: { id: `${monitorId}-event-${version}`, runId: `run-${version}`, monitorId, kind: version === 1 ? 'initialized' : 'changed', reason: version === 1 ? 'initialized' : 'source_changed', fromSnapshotId: version === 1 ? null : `snapshot-${version - 1}`, toSnapshotId: `snapshot-${version}`, changes: [], observedAt: 1_000 },
    snapshot: { id: `snapshot-${version}`, monitorId, revision: 1, version, observationId: `observation-${version}`, assessmentId: `assessment-${version}`, fields: { price: String(version) }, createdAt: 1_000 },
  }
}
function seed(store: DeliveryStore, url = 'https://receiver.example/webhook', maxAttempts = 8, now = 1_000): string {
  store.createDestination({ id: 'sink-a', monitorId: 'monitor-a', url, maxAttempts }, now)
  store.enqueue(envelope(), now)
  return store.listDeliveries()[0]!.id
}
async function listen(server: Server, hostname = '127.0.0.1'): Promise<string> {
  closers.push(() => { server.closeAllConnections(); server.close() })
  await new Promise<void>(resolve => server.listen(0, hostname, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  return `https://${hostname}:${address.port}/webhook`
}
function localPolicy() { const policy = hostedNetworkPolicy(); policy.privateAllowlist = ['127.0.0.1/32', '::1/128']; return policy }

describe('durable webhook store and worker', () => {
  it('enforces HTTPS, immutable destinations, private egress default and secret references', async () => {
    const store = openStore()
    expect(() => store.createDestination({ id: 'sink', monitorId: 'm', url: 'http://example.com' })).toThrow('HTTPS')
    expect(() => store.createDestination({ id: 'sink', monitorId: 'm', url: 'https://user:pass@example.com' })).toThrow('HTTPS')
    expect(() => store.createDestination({ id: 'sink', monitorId: 'm', url: 'https://example.com', secretEnv: 'AWS_SECRET_ACCESS_KEY' })).toThrow('W2L_WEBHOOK_SECRET_')
    const id = seed(store, 'https://127.0.0.1:1/webhook', 8, Date.now())
    expect(() => store.createDestination({ id: 'sink-a', monitorId: 'monitor-a', url: 'https://changed.example' })).toThrow('immutable')
    await new DeliveryWorker(store).processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'dead_letter', lastError: 'webhook egress denied: loopback_address' })
  })
  it('keeps event/payload immutable across retries and never shortens Retry-After seconds or HTTP-date', async () => {
    const store = openStore()
    const id = seed(store)
    let now = 1_000
    const requests: string[] = []
    const worker = new DeliveryWorker(store, { now: () => now, retryBaseMs: 10, transport: async request => {
      requests.push(request.body)
      return requests.length === 1 ? { status: 429, retryAfter: '7200' } : requests.length === 2 ? { status: 503, retryAfter: new Date(now + 14_400_000).toUTCString() } : { status: 204, retryAfter: null }
    } })
    expect(await worker.processOne()).toBe(true)
    expect(store.getDelivery(id)).toMatchObject({ state: 'pending', nextAttemptAt: 7_201_000 })
    now = 7_200_999
    expect(await worker.processOne()).toBe(false)
    now++
    await worker.processOne()
    expect(store.getDelivery(id)?.nextAttemptAt).toBe(21_601_000)
    now = 21_601_000
    await worker.processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'delivered', attemptCount: 3, eventId: envelope().eventId })
    expect(new Set(requests).size).toBe(1)
    expect(store.attempts(id).map(attempt => attempt.outcome)).toEqual(['retry', 'retry', 'delivered'])
    expect(parseWebhookRetryAfter('99999999999999999999999', now)).toBe(Number.MAX_SAFE_INTEGER)
  })
  it('exhausts attempts into dead-letter and explicit replay preserves event ID/history', async () => {
    const store = openStore()
    const id = seed(store, undefined, 2)
    let now = 1_000
    const worker = new DeliveryWorker(store, { now: () => now, retryBaseMs: 1, transport: async () => ({ status: 503, retryAfter: null }) })
    await worker.processOne(); now++
    await worker.processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'dead_letter', attemptCount: 2 })
    const payload = store.getDelivery(id)!.payload
    store.replayDeadLetter(id, now)
    now = store.getDelivery(id)!.nextAttemptAt
    await new DeliveryWorker(store, { now: () => now, transport: async () => ({ status: 200, retryAfter: null }) }).processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'delivered', attemptCount: 3, payload })
    expect(store.attempts(id)).toHaveLength(3)
  })
  it('preserves Retry-After through dead-letter, replay and store restart', async () => {
    const path = dbPath()
    const store = openStore(path)
    const id = seed(store, undefined, 1)
    await new DeliveryWorker(store, { now: () => 1_000, transport: async () => ({ status: 429, retryAfter: '7200' }) }).processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'dead_letter', nextAttemptAt: 7_201_000 })
    store.replayDeadLetter(id, 2_000)
    store.close()
    const restarted = openStore(path)
    const worker = new DeliveryWorker(restarted, { now: () => 7_200_999, transport: async () => { throw new Error('must not send early') } })
    expect(await worker.processOne()).toBe(false)
    expect(restarted.getDelivery(id)).toMatchObject({ state: 'pending', nextAttemptAt: 7_201_000, attemptCount: 1 })
  })
  it('shares receiver Retry-After across events and destinations on one origin through restart and pause/replay', async () => {
    const path = dbPath()
    const store = openStore(path)
    const firstId = seed(store, 'https://receiver.example/a', 1)
    const first = store.claim(1_000, 1_000)!
    store.createDestination({ id: 'same-origin', monitorId: 'monitor-b', url: 'https://receiver.example/b' }, 1_000)
    store.createDestination({ id: 'other-origin', monitorId: 'monitor-other', url: 'https://other.example/webhook' }, 1_000)
    store.enqueue(envelope(1, 'monitor-b'), 1_000)
    store.enqueue(envelope(1, 'monitor-other'), 1_000)
    expect(store.complete(firstId, first.delivery.fencingToken, { state: 'dead_letter', status: 429, error: 'rate limited', retryAfterAt: 61_000, nextAttemptAt: 61_000 }, 1_001)).toBe(true)
    expect(store.listDeliveries({ destinationId: 'same-origin' })[0]?.nextAttemptAt).toBe(61_000)
    store.setDestinationEnabled('sink-a', false)
    store.setDestinationEnabled('sink-a', true)
    store.replayDeadLetter(firstId, 1_002)
    store.enqueue(envelope(2), 1_002)
    expect(store.listDeliveries({ destinationId: 'sink-a' }).every(delivery => delivery.nextAttemptAt === 61_000)).toBe(true)
    store.close()
    const restarted = openStore(path)
    const independent = restarted.claim(1_003, 1_000)!
    expect(independent.delivery.monitorId).toBe('monitor-other')
    restarted.complete(independent.delivery.id, independent.delivery.fencingToken, { state: 'delivered', status: 200, error: null }, 1_004)
    expect(restarted.claim(60_999, 1_000)).toBeNull()
    expect(restarted.claim(61_000, 1_000)).not.toBeNull()
  })
  it('acknowledges the legacy outbox only after every fanout destination succeeds', async () => {
    const path = dbPath()
    const store = openStore(path)
    const db = new Database(path); closers.push(() => db.close())
    db.exec('CREATE TABLE monitor_outbox (event_id TEXT PRIMARY KEY, state TEXT, acknowledged_at INTEGER)')
    db.prepare("INSERT INTO monitor_outbox VALUES (?,'pending',NULL)").run(envelope().eventId)
    seed(store)
    store.createDestination({ id: 'sink-b', monitorId: 'monitor-a', url: 'https://second.example/webhook' }, 1_000)
    store.enqueue(envelope(), 1_000)
    const worker = new DeliveryWorker(store, { now: () => 1_000, transport: async () => ({ status: 200, retryAfter: null }) })
    await worker.processOne()
    expect(db.prepare('SELECT state FROM monitor_outbox').get()).toEqual({ state: 'pending' })
    await worker.processOne()
    expect(db.prepare('SELECT state,acknowledged_at FROM monitor_outbox').get()).toEqual({ state: 'acknowledged', acknowledged_at: 1_000 })
    store.createDestination({ id: 'sink-c', monitorId: 'monitor-a', url: 'https://third.example/webhook' }, 1_000)
    store.enqueue(envelope(), 1_000)
    expect(db.prepare('SELECT state,acknowledged_at FROM monitor_outbox').get()).toEqual({ state: 'pending', acknowledged_at: null })
  })
  it('leases atomically across connections and rejects old or expired acknowledgements', () => {
    const path = dbPath()
    const first = openStore(path)
    const second = openStore(path)
    const id = seed(first)
    const claimA = first.claim(1_000, 100)!
    expect(second.claim(1_001, 100)).toBeNull()
    expect(first.complete(id, claimA.delivery.fencingToken, { state: 'delivered', status: 200, error: null }, 1_100)).toBe(false)
    const claimB = second.claim(1_100, 100)!
    expect(claimB.delivery.fencingToken).toBe(claimA.delivery.fencingToken + 1)
    expect(first.complete(id, claimA.delivery.fencingToken, { state: 'delivered', status: 200, error: null }, 1_101)).toBe(false)
    expect(second.complete(id, claimB.delivery.fencingToken, { state: 'delivered', status: 200, error: null }, 1_101)).toBe(true)
    expect(first.attempts(id).map(attempt => attempt.outcome)).toEqual(['lease_expired', 'delivered'])
  })
  it('isolates monitors and retains paused subscription backlog until resumed', () => {
    const store = openStore()
    seed(store)
    store.createDestination({ id: 'sink-b', monitorId: 'monitor-b', url: 'https://receiver.example/webhook' }, 1_000)
    store.createDestination({ id: 'sink-disabled', monitorId: 'monitor-a', url: 'https://receiver.example/webhook', enabled: false }, 1_000)
    expect(store.enqueue(envelope(), 1_000)).toBe(1)
    expect(store.enqueue(envelope(), 1_000)).toBe(0)
    store.enqueue(envelope(1, 'monitor-b'), 1_000)
    store.enqueue(envelope(2, 'monitor-a'), 1_000)
    expect(store.listDeliveries({ monitorId: 'monitor-a' })).toHaveLength(4)
    expect(store.listDeliveries({ destinationId: 'sink-b' })).toHaveLength(1)
    expect(store.listDeliveries({ destinationId: 'sink-disabled' })).toHaveLength(2)
    store.setDestinationEnabled('sink-a', false)
    expect(store.claim(2_000, 100)?.delivery.monitorId).toBe('monitor-b')
    expect(store.claim(2_000, 100)).toBeNull()
    store.setDestinationEnabled('sink-disabled', true)
    expect(store.claim(2_000, 100)?.destination.id).toBe('sink-disabled')
  })
  it('authenticates HTTPS with pinned vetted DNS and trusted CA; no redirect following', async () => {
    const received: string[] = []
    const server = createServer({ cert: ca, key }, async (req, res) => { for await (const chunk of req) received.push(String(chunk)); res.writeHead(307, { location: 'https://example.com/forbidden' }).end() })
    const url = await listen(server, 'localhost')
    const store = openStore()
    const id = seed(store, url, 8, Date.now())
    await new DeliveryWorker(store, { networkPolicy: localPolicy(), ca }).processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'dead_letter', lastStatus: 307 })
    expect(JSON.parse(received.join('')).eventId).toBe(envelope().eventId)
    await expect(createHttpsWebhookTransport(localPolicy())({ url, body: '{}', headers: {}, signal: new AbortController().signal })).rejects.toThrow()
  })
  it('uses an explicit CONNECT proxy to a vetted IP while enforcing target TLS and cancellation', async () => {
    const target = createServer({ cert: ca, key }, async (req, res) => { for await (const _chunk of req) {} res.writeHead(204).end() })
    const url = await listen(target, 'localhost')
    const proxy = createHttpServer()
    const sockets = new Set<Socket>()
    const authorities: string[] = []
    let stall = false
    let arrived: (() => void) | undefined
    proxy.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
    proxy.on('connect', (req, client, head) => {
      authorities.push(req.url!)
      arrived?.()
      if (stall) return
      const destination = new URL(`http://${req.url}`)
      const upstream = connectTcp(Number(destination.port), destination.hostname.replace(/^\[|\]$/g, ''))
      sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream))
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client); client.pipe(upstream)
      })
      upstream.once('error', () => client.destroy())
      client.once('close', () => upstream.destroy())
    })
    closers.push(() => { for (const socket of sockets) socket.destroy(); proxy.close() })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const address = proxy.address(); if (!address || typeof address === 'string') throw new Error('missing proxy address')
    const proxyUrl = `http://127.0.0.1:${address.port}`
    const transport = createHttpsWebhookTransport(localPolicy(), ca, proxyUrl)
    expect(await transport({ url, body: '{}', headers: {}, signal: new AbortController().signal })).toEqual({ status: 204, retryAfter: null })
    expect(authorities[0]).not.toContain('localhost')
    expect(authorities[0]).toMatch(/^(?:127\.0\.0\.1|\[::1\]):\d+$/)
    await expect(createHttpsWebhookTransport(localPolicy(), undefined, proxyUrl)({ url, body: '{}', headers: {}, signal: new AbortController().signal })).rejects.toThrow()
    // Private target policy is checked before the proxy can be contacted.
    const beforeDenied = authorities.length
    await expect(createHttpsWebhookTransport(hostedNetworkPolicy(), ca, proxyUrl)({ url, body: '{}', headers: {}, signal: new AbortController().signal })).rejects.toThrow('egress denied')
    expect(authorities).toHaveLength(beforeDenied)
    expect(() => createHttpsWebhookTransport(localPolicy(), ca, 'http://user:secret@127.0.0.1')).toThrow('without credentials')
    stall = true
    const controller = new AbortController()
    const connected = new Promise<void>(resolve => { arrived = resolve })
    const pending = transport({ url, body: '{}', headers: {}, signal: controller.signal })
    const aborted = expect(pending).rejects.toThrow('operator stopped proxy handshake')
    await connected
    controller.abort(new Error('operator stopped proxy handshake'))
    await aborted
  })
  it('signs a fixed body while timestamps change, and rejects missing signing configuration', async () => {
    const store = openStore()
    store.createDestination({ id: 'signed', monitorId: 'monitor-a', url: 'https://receiver.example/webhook', secretEnv: 'W2L_WEBHOOK_SECRET_TEST' }, 1_000)
    store.enqueue(envelope(), 1_000)
    let now = 1_000
    const timestamps: string[] = []
    const worker = new DeliveryWorker(store, { now: () => now, retryBaseMs: 1, secrets: { W2L_WEBHOOK_SECRET_TEST: 'local-test-secret' }, transport: async request => {
      expect(verifyWebhookSignature('local-test-secret', request.headers['x-w2l-timestamp'], request.headers['x-w2l-signature'], request.body, now)).toBe(true)
      timestamps.push(request.headers['x-w2l-timestamp']!)
      return { status: timestamps.length === 1 ? 503 : 200, retryAfter: null }
    } })
    await worker.processOne(); now++
    await worker.processOne()
    expect(timestamps).toEqual(['1000', '1001'])
    store.enqueue(envelope(2), now)
    await new DeliveryWorker(store, { now: () => now, secrets: {} }).processOne()
    expect(store.listDeliveries().find(delivery => delivery.eventVersion === 2)).toMatchObject({ state: 'dead_letter', lastError: 'webhook secret unavailable: W2L_WEBHOOK_SECRET_TEST' })
  })
  it('aborts an active HTTPS send on shutdown and on request deadline', async () => {
    let connected: (() => void) | undefined
    const server = createServer({ cert: ca, key }, () => connected?.())
    const url = await listen(server)
    const store = openStore()
    const id = seed(store, url, 8, Date.now())
    const controller = new AbortController()
    const start = new Promise<void>(resolve => { connected = resolve })
    const processing = new DeliveryWorker(store, { networkPolicy: localPolicy(), ca, requestTimeoutMs: 500, leaseMs: 1_000, retryBaseMs: 1 }).processOne(controller.signal)
    await start
    controller.abort()
    await processing
    expect(store.getDelivery(id)?.state).toBe('pending')
    await delay(5)
    await new DeliveryWorker(store, { networkPolicy: localPolicy(), ca, requestTimeoutMs: 30, leaseMs: 100 }).processOne()
    expect(store.getDelivery(id)).toMatchObject({ state: 'pending', attemptCount: 2 })
    expect(store.attempts(id).every(attempt => attempt.error)).toBe(true)
  })
})

describe('durable downstream receipt and projection', () => {
  it('handles ACK loss, duplicate restart, and out-of-order versions without rolling state back', () => {
    const path = dbPath()
    const first = WebhookInbox.open(path)
    expect(first.receive(JSON.stringify(envelope(2))).disposition).toBe('applied')
    first.close()
    const second = WebhookInbox.open(path)
    closers.push(() => second.close())
    expect(second.receive(JSON.stringify(envelope(2))).disposition).toBe('duplicate')
    expect(second.receive(JSON.stringify(envelope(1))).disposition).toBe('stale')
    expect(second.receive(JSON.stringify(envelope(1, 'monitor-b'))).disposition).toBe('applied')
    expect(second.status().projections.map(payload => [payload.monitorId, payload.eventVersion])).toEqual([['monitor-a', 2], ['monitor-b', 1]])
    const altered = envelope(2); altered.snapshot.fields.price = 'malicious-change'
    expect(() => second.receive(JSON.stringify(altered))).toThrow('reused with different payload')
  })
  it('rejects invalid/tampered/stale signatures and invalid version identity', () => {
    const body = JSON.stringify(envelope())
    const signature = webhookSignature('secret', '1000', body)
    expect(verifyWebhookSignature('secret', '1000', signature, body, 1_000)).toBe(true)
    expect(verifyWebhookSignature('secret', '1000', signature, body + ' ', 1_000)).toBe(false)
    expect(verifyWebhookSignature('secret', '1000', signature, body, 301_001)).toBe(false)
    expect(verifyWebhookSignature('secret', 'garbage', signature, body, 1_000)).toBe(false)
    const inbox = WebhookInbox.open(dbPath()); closers.push(() => inbox.close())
    expect(() => inbox.receive(JSON.stringify({ ...envelope(), eventVersion: 2 }))).toThrow('invalid webhook envelope')
  })
  it('recovers a real SIGKILL between receiver commit and sender ACK using the same event and dedup receipt', async () => {
    const storePath = dbPath()
    const store = openStore(storePath)
    const inbox = WebhookInbox.open(dbPath()); closers.push(() => inbox.close())
    const bodies: string[] = []
    let acknowledge = false
    let arrived: (() => void) | undefined
    const server = createServer({ cert: ca, key }, async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString('utf8')
      bodies.push(body)
      const receipt = inbox.receive(body)
      arrived?.()
      if (acknowledge) res.writeHead(200).end(JSON.stringify(receipt))
    })
    const url = await listen(server)
    const id = seed(store, url, 8, Date.now())
    function child(): ChildProcess {
      const process = spawn(globalThis.process.execPath, ['--import', 'tsx', resolve('packages/runtime/test/fixtures/delivery-process.ts')], { cwd: resolve('.'), env: { ...globalThis.process.env, DELIVERY_TEST_DB: storePath, DELIVERY_TEST_CA: caPath, TSX_TSCONFIG_PATH: resolve('packages/runtime/test/fixtures/tsconfig.json') }, stdio: ['ignore', 'pipe', 'pipe'] })
      closers.push(() => process.kill('SIGKILL'))
      return process
    }
    const received = new Promise<void>(resolve => { arrived = resolve })
    const first = child()
    let stderr = ''; first.stderr?.on('data', chunk => { stderr += String(chunk) })
    await Promise.race([received, new Promise<never>((_, reject) => { first.once('exit', code => reject(new Error(`worker exited early ${code}: ${stderr}`))) })])
    const killed = new Promise<void>(resolve => first.once('exit', () => resolve()))
    first.kill('SIGKILL'); await killed
    expect(store.getDelivery(id)?.state).toBe('delivering')
    acknowledge = true
    arrived = undefined
    await delay(Math.max(1, store.getDelivery(id)!.leaseUntil! - Date.now() + 25))
    store.close()
    const second = child()
    let secondError = ''; second.stderr?.on('data', chunk => { secondError += String(chunk) })
    const code = await new Promise<number | null>(resolve => second.once('exit', resolve))
    expect(code, secondError).toBe(0)
    const restarted = openStore(storePath)
    expect(restarted.getDelivery(id)).toMatchObject({ state: 'delivered', attemptCount: 2, eventId: envelope().eventId })
    expect(restarted.attempts(id).map(attempt => attempt.outcome)).toEqual(['lease_expired', 'delivered'])
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(inbox.status().receipts).toHaveLength(1)
    expect(inbox.status().projections).toHaveLength(1)
  })
})
