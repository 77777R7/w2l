import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { Agent, request } from 'node:https'
import { request as httpRequest, type ClientRequest } from 'node:http'
import { isIP, type LookupFunction, type Socket } from 'node:net'
import { connect as connectTls, checkServerIdentity, type ConnectionOptions, type TLSSocket } from 'node:tls'
import { evaluateHostname, evaluateResolved, hostedNetworkPolicy, type NetworkPolicy } from '@w2l/contracts'
import { DeliveryStore, validateDestinationUrl, type DeliveryClaim } from './deliveryStore.js'

export interface WebhookTransportResponse { status: number; retryAfter: string | null }
export interface WebhookTransportRequest { url: string; body: string; headers: Record<string, string>; signal: AbortSignal }
export type WebhookTransport = (request: WebhookTransportRequest) => Promise<WebhookTransportResponse>
export interface DeliveryWorkerOptions {
  /** Separate from crawler access. Defaults to hosted/public egress, always pins vetted DNS addresses. */
  networkPolicy?: NetworkPolicy
  /** Trusted CA material for operator-managed private HTTPS. Verification is always enabled. */
  ca?: ConnectionOptions['ca']
  /** Explicit operator-only HTTP(S) CONNECT proxy; ambient proxy environment is ignored. */
  proxyUrl?: string
  leaseMs?: number
  requestTimeoutMs?: number
  retryBaseMs?: number
  pollMs?: number
  now?: () => number
  /** Test transport seam. Production defaults to HTTPS with policy enforcement. */
  transport?: WebhookTransport
  secrets?: Readonly<Record<string, string | undefined>>
}

export function parseWebhookRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isSafeInteger(seconds) && seconds <= (Number.MAX_SAFE_INTEGER - now) / 1000 ? now + seconds * 1000 : Number.MAX_SAFE_INTEGER
  }
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(now, date) : null
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

/** No redirects; a vetted DNS address is used for the actual TCP connection. */
export function createHttpsWebhookTransport(policy: NetworkPolicy = hostedNetworkPolicy(), ca?: ConnectionOptions['ca'], proxyUrl?: string): WebhookTransport {
  const proxy = proxyUrl ? new URL(proxyUrl) : null
  if (proxy && (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash)) throw new Error('delivery proxy must be an HTTP(S) origin without credentials, path, query or fragment')
  return async input => {
    input.signal.throwIfAborted()
    const url = new URL(validateDestinationUrl(input.url))
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const literalDecision = evaluateHostname(hostname, policy)
    if (literalDecision && !literalDecision.allowed) throw new Error(`webhook egress denied: ${literalDecision.violation}`)
    // Node's DNS promise is not abortable; stop waiting immediately on cancellation.
    const addresses = isIP(hostname) ? [hostname] : await abortable(lookup(hostname, { all: true }).then(results => results.map(result => result.address)), input.signal)
    input.signal.throwIfAborted()
    const decision = evaluateResolved(hostname, addresses, policy)
    if (!decision.allowed || !decision.pinnedAddress) throw new Error(`webhook egress denied: ${decision.violation}`)
    const pinnedAddress = decision.pinnedAddress
    let agent: Agent | undefined
    if (proxy) {
      const socket = await connectProxyTunnel(proxy, pinnedAddress, url.port || '443', hostname, ca, input.signal)
      if (input.signal.aborted) { socket.destroy(); input.signal.throwIfAborted() }
      agent = new Agent({ keepAlive: false })
      agent.createConnection = () => socket
    }
    try { return await new Promise<WebhookTransportResponse>((resolve, reject) => {
      const req = request(url, {
        method: 'POST', signal: input.signal, ca, rejectUnauthorized: true, agent: agent ?? false,
        lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options.all) callback(null, [{ address: pinnedAddress, family: isIP(pinnedAddress) }])
          else callback(null, pinnedAddress, isIP(pinnedAddress))
        }) as LookupFunction,
        headers: { ...input.headers, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(input.body)) },
      }, res => {
        const retryAfter = res.headers['retry-after']
        resolve({ status: res.statusCode ?? 0, retryAfter: (Array.isArray(retryAfter) ? retryAfter[0] : retryAfter) ?? null })
        // An ACK is the response status. No unbounded/slow response body is retained.
        res.destroy()
      })
      req.once('error', reject)
      req.end(input.body)
    }) } finally { agent?.destroy() }
  }
}

/** CONNECT is sent to the already-vetted IP, so the proxy never resolves the destination hostname. */
function connectProxyTunnel(proxy: URL, address: string, port: string, hostname: string, ca: ConnectionOptions['ca'], signal: AbortSignal): Promise<TLSSocket> {
  const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${port}`
  return new Promise((resolve, reject) => {
    let tunnel: Socket | undefined
    let tls: TLSSocket | undefined
    let settled = false
    let req: ClientRequest | undefined
    const cleanup = () => signal.removeEventListener('abort', abort)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true; cleanup(); tls?.destroy(); tunnel?.destroy(); req?.destroy()
      reject(error)
    }
    const abort = () => fail(signal.reason ?? new Error('webhook proxy connection aborted'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    const send = proxy.protocol === 'https:' ? request : httpRequest
    req = send(proxy, { method: 'CONNECT', path: authority, headers: { host: authority }, agent: false, signal, ...(proxy.protocol === 'https:' ? { ca, rejectUnauthorized: true } : {}) })
    req.once('error', fail)
    req.once('connect', (response, socket, head) => {
      tunnel = socket
      if (settled || signal.aborted) { socket.destroy(); abort(); return }
      if (response.statusCode !== 200) { fail(new Error(`webhook proxy CONNECT returned HTTP ${response.statusCode ?? 0}`)); return }
      if (head.length) socket.unshift(head)
      tls = connectTls({ socket, host: hostname, servername: isIP(hostname) ? undefined : hostname, ca, rejectUnauthorized: true, checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate) })
      tls.once('error', fail)
      tls.once('secureConnect', () => {
        if (settled || signal.aborted) { tls?.destroy(); abort(); return }
        settled = true; cleanup(); resolve(tls!)
      })
    })
    req.end()
  })
}

export class DeliveryWorker {
  private readonly leaseMs: number
  private readonly requestTimeoutMs: number
  private readonly transport: WebhookTransport
  private readonly now: () => number
  constructor(private readonly store: DeliveryStore, private readonly options: DeliveryWorkerOptions = {}) {
    this.leaseMs = options.leaseMs ?? 60_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    if (!Number.isSafeInteger(this.leaseMs) || !Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0 || this.leaseMs <= this.requestTimeoutMs) throw new Error('delivery lease must exceed positive request timeout')
    for (const [name, value] of [['retryBaseMs', options.retryBaseMs], ['pollMs', options.pollMs]] as const) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`invalid ${name}`)
    this.transport = options.transport ?? createHttpsWebhookTransport(options.networkPolicy ?? hostedNetworkPolicy(), options.ca, options.proxyUrl)
    this.now = options.now ?? Date.now
  }
  async processOne(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false
    const claim = this.store.claim(this.now(), this.leaseMs)
    if (!claim) return false
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason ?? new Error('delivery worker stopped'))
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('webhook request deadline exceeded')), this.requestTimeoutMs)
    try {
      const headers = this.headers(claim)
      controller.signal.throwIfAborted()
      const response = await abortable(this.transport({ url: claim.destination.url, body: JSON.stringify(claim.delivery.payload), headers, signal: controller.signal }), controller.signal)
      const now = this.now()
      const retryAfterAt = parseWebhookRetryAfter(response.retryAfter, now)
      const delivered = response.status >= 200 && response.status < 300
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
      const dead = !delivered && (!retryable || claim.delivery.attemptCount >= claim.delivery.maxAttempts)
      const backoffAt = now + Math.min(3_600_000, (this.options.retryBaseMs ?? 1_000) * 2 ** Math.min(20, claim.delivery.attemptCount - 1))
      this.store.complete(claim.delivery.id, claim.delivery.fencingToken, {
        state: delivered ? 'delivered' : dead ? 'dead_letter' : 'pending', status: response.status,
        error: delivered ? null : `webhook returned HTTP ${response.status}`,
        nextAttemptAt: Math.max(backoffAt, retryAfterAt ?? now), retryAfterAt,
      }, now)
    } catch (error) {
      const now = this.now()
      const message = error instanceof Error ? error.message : String(error)
      const terminal = message.startsWith('webhook egress denied:') || message.startsWith('webhook secret unavailable:')
      this.store.complete(claim.delivery.id, claim.delivery.fencingToken, {
        state: terminal || claim.delivery.attemptCount >= claim.delivery.maxAttempts ? 'dead_letter' : 'pending', status: null,
        error: message, nextAttemptAt: now + Math.min(3_600_000, (this.options.retryBaseMs ?? 1_000) * 2 ** Math.min(20, claim.delivery.attemptCount - 1)),
      }, now)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
    return true
  }
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (!await this.processOne(signal)) await abortable(new Promise<void>(resolve => {
        const timeout = setTimeout(done, this.options.pollMs ?? 500)
        const onAbort = () => done()
        function done() { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); resolve() }
        signal.addEventListener('abort', onAbort, { once: true })
      }), signal).catch(() => {})
    }
  }
  private headers(claim: DeliveryClaim): Record<string, string> {
    const headers: Record<string, string> = { 'x-w2l-event-id': claim.delivery.eventId, 'x-w2l-event-version': String(claim.delivery.eventVersion), 'x-w2l-delivery-id': claim.delivery.id }
    if (claim.destination.secretEnv) {
      const secret = (this.options.secrets ?? process.env)[claim.destination.secretEnv]
      if (!secret) throw new Error(`webhook secret unavailable: ${claim.destination.secretEnv}`)
      const timestamp = String(this.now())
      headers['x-w2l-timestamp'] = timestamp
      headers['x-w2l-signature'] = webhookSignature(secret, timestamp, JSON.stringify(claim.delivery.payload))
    }
    return headers
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
