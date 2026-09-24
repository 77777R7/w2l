import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { extname, relative, resolve } from 'node:path'
import type { PreviewQuota, QuotaDecision } from './quota.js'
import { AmazonGateBusyError, type AmazonOriginGate, type AmazonOriginPermit } from './amazonGate.js'
import { capturePreview, mapPreviewResult, normalizePreviewUrl, type PreviewCapture, type PreviewResponse } from './preview.js'

export interface PreviewServerOptions {
  quota: PreviewQuota
  amazonGate?: AmazonOriginGate
  staticDir: string
  amazonState?: string | null
  capture?: PreviewCapture
  enabled?: boolean
  deadlineMs?: number
  visitorCookieSecret?: string
  evalToken?: string
  /** Git commit embedded at deployment so evaluation can prove source identity. */
  sourceCommit?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

function sendJson(res: ServerResponse, status: number, body: PreviewResponse | Record<string, unknown>, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers,
  }).end(JSON.stringify(body))
}

function empty(status: PreviewResponse['status'], url: string, reason: string, totalMs = 0): PreviewResponse {
  return { status, requestedUrl: url, finalUrl: null, title: null, markdown: null, totalMs, reason }
}

function visitorAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const addresses = (typeof forwarded === 'string' ? forwarded : Array.isArray(forwarded) ? forwarded.join(',') : '').split(',')
  // The last address may be a load balancer, so this is deliberately a
  // conservative fallback key for clients without the signed visitor cookie.
  // Earlier XFF entries may be user-controlled and are never trusted here.
  const last = addresses.at(-1)?.trim()
  if (last && isIP(last)) return last
  const socket = req.socket.remoteAddress ?? ''
  return isIP(socket) ? socket : 'unknown'
}

function validVisitorCookie(req: IncomingMessage, secret: string): string | null {
  const raw = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('w2l_visitor='))?.slice('w2l_visitor='.length)
  if (!raw || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(raw)) return null
  const [id, signature] = raw.split('.') as [string, string]
  const expected = createHmac('sha256', secret).update(id).digest('hex')
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null
}

function issueVisitorCookie(req: IncomingMessage, res: ServerResponse, secret: string): void {
  if (validVisitorCookie(req, secret) !== null) return
  const id = randomBytes(16).toString('hex')
  const signature = createHmac('sha256', secret).update(id).digest('hex')
  const secure = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '') ? '' : '; Secure'
  res.setHeader('set-cookie', `w2l_visitor=${id}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`)
}

function visitorKey(req: IncomingMessage, secret: string | undefined): string {
  const cookie = secret ? validVisitorCookie(req, secret) : null
  return cookie === null ? `ip:${visitorAddress(req)}` : `visitor:${cookie}`
}

function authorizedEvaluation(req: IncomingMessage, configuredToken: string | undefined): boolean {
  if (!configuredToken) return false
  const provided = req.headers.authorization
  if (typeof provided !== 'string' || !provided.startsWith('Bearer ')) return false
  const expectedHash = createHash('sha256').update(configuredToken).digest()
  const providedHash = createHash('sha256').update(provided.slice(7)).digest()
  return timingSafeEqual(expectedHash, providedHash)
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().startsWith('application/json')) throw new Error('Send JSON containing a single url field.')
  if (Number(req.headers['content-length'] ?? 0) > 4_096) throw new Error('The request is too large.')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += next.length
    if (length > 4_096) throw new Error('The request is too large.')
    chunks.push(next)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('The request body must be valid JSON.') }
}

function requestOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return true // CLI / same-host tests need no Origin.
  const host = req.headers.host
  if (!host) return false
  const expected = new Set([`https://${host}`])
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) expected.add(`http://${host}`)
  return expected.has(origin)
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, directory: string, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
  const root = resolve(directory)
  let relativePath: string
  try { relativePath = decodeURIComponent(pathname) } catch { res.writeHead(400).end(); return }
  const requested = resolve(root, `.${relativePath}`)
  if (relative(root, requested).startsWith('..')) { res.writeHead(404).end(); return }
  let file = requested
  let info = await stat(file).catch(() => null)
  if (info?.isDirectory()) { file = resolve(file, 'index.html'); info = await stat(file).catch(() => null) }
  if (!info?.isFile() && !extname(relativePath) && !relativePath.startsWith('/api/')) {
    file = resolve(root, 'index.html')
    info = await stat(file).catch(() => null)
  }
  if (!info?.isFile() || relative(root, file).startsWith('..')) { res.writeHead(404).end(); return }
  const mime = MIME[extname(file)] ?? 'application/octet-stream'
  const content = req.method === 'HEAD' ? null : await readFile(file)
  res.writeHead(200, {
    'content-type': mime, 'content-length': info.size,
    'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  })
  if (req.method === 'HEAD') { res.end(); return }
  res.end(content)
}

export function createPreviewHandler(options: PreviewServerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const capture = options.capture ?? capturePreview
  const deadlineMs = Math.min(Math.max(options.deadlineMs ?? 40_000, 1_000), 60_000)
  if (options.visitorCookieSecret && options.visitorCookieSecret.length < 32) throw new Error('Visitor cookie secret must have at least 32 characters')
  if (options.evalToken && options.evalToken.length < 32) throw new Error('Evaluation token must have at least 32 characters')
  return (req, res) => { void (async () => {
    const started = performance.now()
    const deadlineAt = Date.now() + deadlineMs
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (pathname === '/healthz') {
      sendJson(res, 200, { status: 'ok', anonymousPreviewEnabled: options.enabled !== false })
      return
    }
    if (pathname !== '/api/preview') {
      if (pathname.startsWith('/api/')) { res.writeHead(404).end(); return }
      if (req.method === 'GET' && options.visitorCookieSecret) issueVisitorCookie(req, res, options.visitorCookieSecret)
      await serveStatic(req, res, options.staticDir, pathname)
      return
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return }
    if (!requestOriginAllowed(req) || req.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(res, 403, empty('failed', '', 'Submit links from this site only.', Math.max(0, performance.now() - started)))
      return
    }
    let submitted = ''
    try {
      const body = await readRequestBody(req)
      if (body === null || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || typeof (body as Record<string, unknown>).url !== 'string') {
        throw new Error('The request must contain only one url field.')
      }
      submitted = (body as { url: string }).url
      const target = normalizePreviewUrl(submitted)
      if (options.enabled === false) { sendJson(res, 503, empty('failed', submitted, 'The public preview is temporarily unavailable.', Math.max(0, performance.now() - started))); return }
      if (target.amazonAsin !== null && !options.amazonState) {
        sendJson(res, 503, empty('incomplete', submitted, 'The Singapore Amazon preview is not configured yet.', Math.max(0, performance.now() - started)))
        return
      }
      if (target.amazonAsin !== null && !options.amazonGate) {
        sendJson(res, 503, empty('failed', submitted, 'Amazon request coordination is not configured yet.', Math.max(0, performance.now() - started)))
        return
      }
      const evaluation = authorizedEvaluation(req, options.evalToken)
      if (req.headers.authorization !== undefined && !evaluation) {
        sendJson(res, 401, empty('failed', submitted, 'Invalid evaluation credentials.', Math.max(0, performance.now() - started)))
        return
      }
      const abort = new AbortController()
      res.once('close', () => { if (!res.writableEnded) abort.abort(new DOMException('Client disconnected', 'AbortError')) })
      // Read-only precheck keeps exhausted anonymous Amazon requests out of
      // the origin lease. The atomic consume still happens after acquisition,
      // so a busy gate does not spend an attempt and concurrent limits hold.
      if (target.amazonAsin !== null && !evaluation && options.quota.check) {
        let available: QuotaDecision
        try {
          available = await options.quota.check(visitorKey(req, options.visitorCookieSecret), undefined, { signal: abort.signal, deadlineAt })
        } catch (error) {
          const interrupted = abort.signal.aborted || Date.now() >= deadlineAt
            || error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          if (!res.destroyed) sendJson(res, interrupted ? 200 : 503,
            empty(interrupted ? 'timeout' : 'failed', submitted,
              interrupted ? 'The page did not finish loading within the preview time limit.' : 'The preview quota service is temporarily unavailable.',
              Math.max(0, performance.now() - started)))
          return
        }
        if (available !== 'ok') {
          const tomorrow = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)
          if (!res.destroyed) sendJson(res, 429,
            empty('quota_exceeded', submitted,
              available === 'global_limited' ? 'The public preview has reached its daily limit.' : 'You have used your three previews for today.',
              Math.max(0, performance.now() - started)),
            { 'retry-after': String(Math.max(1, Math.ceil((tomorrow - Date.now()) / 1_000))) })
          return
        }
      }
      type Reply = { status: number; body: PreviewResponse; headers?: Record<string, string> }
      let reply: Reply = { status: 503, body: empty('failed', submitted, 'The preview service is temporarily unavailable.') }
      let permit: AmazonOriginPermit | undefined
      let observedRetryAt = 0
      const retryNotes: Promise<void>[] = []
      try {
        // Acquire before spending a visitor quota attempt. The owner token is
        // still subject to this origin gate, even though it bypasses quota.
        if (target.amazonAsin !== null) permit = await options.amazonGate!.acquire(abort.signal, deadlineAt)
        let quota
        try { quota = evaluation ? 'ok' : await options.quota.consume(visitorKey(req, options.visitorCookieSecret), undefined, { signal: abort.signal, deadlineAt }) }
        catch (error) {
          const interrupted = abort.signal.aborted || Date.now() >= deadlineAt
            || error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          reply = interrupted
            ? { status: 200, body: empty('timeout', submitted, 'The page did not finish loading within the preview time limit.') }
            : { status: 503, body: empty('failed', submitted, 'The preview quota service is temporarily unavailable.') }
        }
        if (quota !== undefined && quota !== 'ok') {
          const tomorrow = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)
          reply = { status: 429, body: empty('quota_exceeded', submitted, quota === 'global_limited' ? 'The public preview has reached its daily limit.' : 'You have used your three previews for today.'),
            headers: { 'retry-after': String(Math.max(1, Math.ceil((tomorrow - Date.now()) / 1_000))) } }
        } else if (quota === 'ok') {
          try {
            const outcome = await capture(target, abort.signal, deadlineAt, options.amazonState ?? null, evaluation, (_url, retryAt) => {
              if (!permit || !Number.isSafeInteger(retryAt) || retryAt < 0) return
              observedRetryAt = Math.max(observedRetryAt, retryAt)
              // The lease stays owned while we persist the observed cooldown.
              // Release repeats the maximum after all notes settle.
              retryNotes.push(permit.noteRetryAfter(retryAt).catch(() => {}))
            })
            if (outcome.result.retryAt !== undefined) observedRetryAt = Math.max(observedRetryAt, outcome.result.retryAt)
            const mapped = mapPreviewResult(submitted, target, outcome, Math.max(0, performance.now() - started))
            if (evaluation) {
              mapped.evaluation = {
                rawBodySha256: outcome.result.evidence.rawBodySha256,
                ...(outcome.rawHtml === undefined ? {} : { rawHtml: outcome.rawHtml }),
                fieldEvidence: outcome.json?.evidence.map(item => ({ path: item.path, source: item.source, ...(item.evidencePath ? { evidencePath: item.evidencePath } : {}) })) ?? [],
                ...(options.sourceCommit ? { sourceCommit: options.sourceCommit } : {}),
                ...(options.amazonState ? { amazonStateSha256: createHash('sha256').update(options.amazonState).digest('hex') } : {}),
                ...(outcome.json?.schemaSha256 ? { schemaSha256: outcome.json.schemaSha256 } : {}),
                usage: {
                  attemptCount: outcome.result.usage.attemptCount,
                  statusRetryCount: outcome.result.usage.statusRetryCount ?? 0,
                  retryWaitMs: outcome.result.usage.timings?.retryWaitMs ?? 0,
                  browserMs: outcome.result.usage.browserMs,
                  externalCostUsd: outcome.result.usage.externalCostUsd,
                },
              }
              console.log(JSON.stringify({ event: 'public_preview_evaluation', status: mapped.status, totalMs: mapped.totalMs }))
            }
            reply = { status: 200, body: mapped }
          } catch (error) {
            const timeout = error instanceof Error && error.name === 'TimeoutError'
            if (evaluation) console.log(JSON.stringify({ event: 'public_preview_evaluation', status: timeout ? 'timeout' : 'failed', totalMs: Math.max(0, performance.now() - started) }))
            reply = { status: 200, body: empty(timeout || abort.signal.aborted ? 'timeout' : 'failed', submitted,
              timeout ? 'The page did not finish loading within the preview time limit.' : abort.signal.aborted ? 'This extraction was interrupted.' : 'We could not extract this page right now.') }
          }
        }
      } catch (error) {
        reply = abort.signal.aborted || Date.now() >= deadlineAt
          ? { status: 200, body: empty('timeout', submitted, 'The page did not finish loading within the preview time limit.') }
          : error instanceof AmazonGateBusyError
          ? { status: 503, body: empty('failed', submitted, 'Amazon requests are busy. Try again shortly.'),
            headers: { 'retry-after': String(Math.max(1, Math.ceil(((error.retryAfterAt ?? Date.now() + 1_000) - Date.now()) / 1_000))) } }
          : { status: 503, body: empty('failed', submitted, 'Amazon request coordination is temporarily unavailable.') }
      } finally {
        if (permit) {
          await Promise.allSettled(retryNotes)
          try { await permit.release(observedRetryAt || undefined) }
          catch { reply = { status: 503, body: empty('failed', submitted, 'Amazon request coordination is temporarily unavailable.') } }
        }
      }
      reply.body.totalMs = Math.max(0, performance.now() - started)
      if (!res.destroyed) sendJson(res, reply.status, reply.body, reply.headers)
    } catch (error) {
      if (!res.destroyed) sendJson(res, 400, empty('invalid_url', submitted, error instanceof Error ? error.message : 'Invalid request.', Math.max(0, performance.now() - started)))
    }
  })().catch(() => { if (!res.headersSent) sendJson(res, 500, empty('failed', '', 'The preview service is temporarily unavailable.')) }) }
}

export function createPreviewServer(options: PreviewServerOptions): Server {
  return createServer(createPreviewHandler(options))
}
