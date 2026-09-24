import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FetchResult, StructuredExtractionResult } from '@w2l/contracts'
import { createPreviewServer } from '../src/server.js'
import { mapPreviewResult, normalizePreviewUrl, type CaptureOutcome } from '../src/preview.js'
import { resolvePreviewCapability } from '../src/capability.js'
import type { PreviewQuota } from '../src/quota.js'
import { AmazonGateBusyError, type AmazonOriginGate } from '../src/amazonGate.js'

const servers: Server[] = []
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function fixture(url: string, amazon = false): CaptureOutcome {
  const result = {
    requestedUrl: url, status: 'success', failureReason: null, blockReason: null, budgetExceeded: null,
    markdown: '# Example page\n\nContent',
    evidence: { finalUrl: url, httpStatus: 200, rawBodySha256: 'fixture-sha' },
    usage: { attemptCount: 1, browserMs: 0, externalCostUsd: null },
    document: { title: 'Example page', adapter: { id: amazon ? 'amazon-product' : 'generic' }, adapterValidation: { valid: true, issues: [] } },
  } as unknown as FetchResult
  return { result, ...(amazon ? { selectedAsin: /\/dp\/([A-Z0-9]{10})/i.exec(url)?.[1]?.toUpperCase() ?? null } : {}) }
}

async function endpoint(quota: PreviewQuota, capture: NonNullable<Parameters<typeof createPreviewServer>[0]['capture']>, extra: Partial<Parameters<typeof createPreviewServer>[0]> = {}) {
  const server = createPreviewServer({ quota, capture, staticDir: '/missing-static-test', amazonState: null, ...extra })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('anonymous preview contract', () => {
  it('preflights a planned route without capture, quota, or a visitor cookie', async () => {
    let captures = 0
    let quotaCalls = 0
    const url = await endpoint({ consume: async () => { quotaCalls++; return 'ok' } }, async target => { captures++; return fixture(target.url) }, {
      visitorCookieSecret: 's'.repeat(32), enabled: false,
    })
    for (const [input, task, route] of [
      ['https://docs.example/page', 'readable_page', 'http'],
      ['https://www.amazon.sg/dp/B0D4DHBFFH', 'amazon_sg_product', 'browser_local'],
      ['https://x.com/alice/status/222', 'x_public_post', 'http'],
      ['https://www.reddit.com/r/test/comments/abc123/story/', 'reddit_public_post', 'http'],
    ]) {
      const response = await fetch(`${url}/api/capability?url=${encodeURIComponent(input)}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(await response.json()).toMatchObject({ capability: { task, captureMode: route } })
    }
    expect([captures, quotaCalls]).toEqual([0, 0])
    const privateHint = await fetch(`${url}/api/capability?url=${encodeURIComponent('http://169.254.169.254/computeMetadata/v1/')}`)
    expect(await privateHint.json()).toMatchObject({ capability: { support: 'unsupported', fields: [] } })
    expect([captures, quotaCalls]).toEqual([0, 0])
    expect((await fetch(`${url}/api/capability?url=file:///etc/passwd`)).status).toBe(400)
    expect((await fetch(`${url}/api/capability?url=https://docs.example&debug=true`)).status).toBe(400)
    expect((await fetch(`${url}/api/capability`, { method: 'POST' })).status).toBe(405)
  })

  it('keeps hosted X and Reddit routes conditional despite local adapters', () => {
    for (const address of ['https://x.com/a/status/2', 'https://reddit.com/r/a/comments/abc/title']) {
      const capability = resolvePreviewCapability(normalizePreviewUrl(address))
      expect(capability.captureMode).toBe('http')
      expect(capability.support).toBe('conditional')
      expect(capability.lastValidatedSourceCommit).toBeNull()
    }
  })

  it('rejects known private and metadata targets before quota or outbound capture', async () => {
    let quotaCalls = 0
    let captures = 0
    const base = await endpoint({ consume: async () => { quotaCalls++; return 'ok' } }, async target => { captures++; return fixture(target.url) })
    for (const target of ['http://169.254.169.254/computeMetadata/v1/', 'http://127.0.0.1/', 'http://localhost/', 'http://metadata.google.internal/']) {
      const response = await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) })
      expect(await response.json()).toMatchObject({ status: 'blocked', finalUrl: null, diagnostic: { code: 'policy_denied', stage: 'policy', evidence: 'observed' } })
    }
    expect([quotaCalls, captures]).toEqual([0, 0])
  })
  it('serves documentation deep links but returns 404 for unknown documentation pages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-doc-routes-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'docs', 'guides', 'extract-page'), { recursive: true })
    await writeFile(join(dir, 'index.html'), '<h1>Preview</h1>')
    await writeFile(join(dir, 'docs', 'index.html'), '<h1>Documentation</h1>')
    await writeFile(join(dir, 'docs', 'guides', 'extract-page', 'index.html'), '<h1>Extract</h1>')
    const url = await endpoint({ consume: async () => 'ok' }, async target => fixture(target.url), { staticDir: dir })
    const health = await fetch(`${url}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok', anonymousPreviewEnabled: true })
    const docs = await fetch(`${url}/docs/`)
    expect(docs.status).toBe(200)
    expect(await docs.text()).toContain('Documentation')
    const deepLink = await fetch(`${url}/docs/guides/extract-page/`)
    expect(deepLink.status).toBe(200)
    expect(await deepLink.text()).toContain('Extract')
    expect((await fetch(`${url}/docs/not-a-page/`)).status).toBe(404)
  })

  it('rejects an exhausted Amazon visitor before acquiring the origin gate', async () => {
    let acquires = 0
    let consumes = 0
    const gate: AmazonOriginGate = { acquire: async () => { acquires++; throw new Error('must not acquire') } }
    const quota: PreviewQuota = {
      check: async () => 'visitor_limited',
      consume: async () => { consumes++; return 'ok' },
    }
    const url = await endpoint(quota, async target => fixture(target.url, true), {
      amazonState: 'anonymous-sg-state', amazonGate: gate,
    })
    const response = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.amazon.sg/dp/B0D4DHBFFH' }) })
    expect(response.status).toBe(429)
    expect((await response.json()).status).toBe('quota_exceeded')
    expect([acquires, consumes]).toEqual([0, 0])
  })

  it('does not spend quota when the durable Amazon gate is busy', async () => {
    let quotaCalls = 0
    let captureCalls = 0
    const gate: AmazonOriginGate = { acquire: async () => { throw new AmazonGateBusyError() } }
    const url = await endpoint({ consume: async () => { quotaCalls++; return 'ok' } }, async target => { captureCalls++; return fixture(target.url, true) }, {
      amazonState: 'anonymous-sg-state', amazonGate: gate,
    })
    const response = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.amazon.sg/dp/B0D4DHBFFH' }) })
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('1')
    expect((await response.json()).reason).toContain('busy')
    expect([quotaCalls, captureCalls]).toEqual([0, 0])
  })

  it('keeps the owner evaluation inside the gate and saves retry cooldown before responding', async () => {
    const token = 'eval-' + 'z'.repeat(32)
    let quotaCalls = 0
    let acquires = 0
    let notes: number[] = []
    let releasedAt: number | undefined
    const gate: AmazonOriginGate = { acquire: async () => {
      acquires++
      return { noteRetryAfter: async retryAt => { notes.push(retryAt) }, release: async retryAt => { releasedAt = retryAt } }
    } }
    const url = await endpoint({ consume: async () => { quotaCalls++; return 'ok' } }, async (target, _signal, _deadline, _state, _evaluation, onRetryAfter) => {
      onRetryAfter?.(target.url, 500_000)
      return fixture(target.url, true)
    }, { amazonState: 'anonymous-sg-state', amazonGate: gate, evalToken: token })
    const response = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ url: 'https://www.amazon.sg/dp/B0D4DHBFFH' }) })
    expect(response.status).toBe(200)
    expect([acquires, quotaCalls]).toEqual([1, 0])
    expect(notes).toEqual([500_000])
    expect(releasedAt).toBe(500_000)
  })

  it('releases the Amazon lease if quota is exhausted, without starting capture', async () => {
    let releases = 0
    let captures = 0
    const gate: AmazonOriginGate = { acquire: async () => ({ noteRetryAfter: async () => {}, release: async () => { releases++ } }) }
    const url = await endpoint({ consume: async () => 'visitor_limited' }, async target => { captures++; return fixture(target.url, true) }, {
      amazonState: 'anonymous-sg-state', amazonGate: gate,
    })
    const response = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.amazon.sg/dp/B0D4DHBFFH' }) })
    expect(response.status).toBe(429)
    expect([releases, captures]).toEqual([1, 0])
  })

  it('reports a quota deadline as timeout rather than a quota-service outage', async () => {
    let captures = 0
    const url = await endpoint({ consume: async () => { throw new DOMException('deadline', 'TimeoutError') } }, async target => { captures++; return fixture(target.url) })
    const response = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://docs.example' }) })
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('timeout')
    expect(captures).toBe(0)
  })

  it('normalizes Amazon.sg ASIN and rejects credentials, ports and non-web URLs', () => {
    expect(normalizePreviewUrl('https://amazon.sg/dp/B0D4DHBFFH?tag=secret#x')).toEqual({ url: 'https://www.amazon.sg/dp/B0D4DHBFFH', amazonAsin: 'B0D4DHBFFH' })
    expect(normalizePreviewUrl('https://docs.example/a#fragment')).toEqual({ url: 'https://docs.example/a', amazonAsin: null })
    for (const url of ['file:///etc/passwd', 'https://u:p@example.com', 'https://example.com:444/path']) expect(() => normalizePreviewUrl(url)).toThrow()
  })

  it('returns only the requested compact fields and keeps provider debug data out', async () => {
    let calls = 0
    const url = await endpoint({ consume: async () => 'ok' }, async target => { calls++; return fixture(target.url) })
    const response = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://docs.example/a' }) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'success', requestedUrl: 'https://docs.example/a', finalUrl: 'https://docs.example/a', title: 'Example page', markdown: '# Example page\n\nContent', reason: null })
    expect(body.totalMs).toBeGreaterThanOrEqual(0)
    expect(body).not.toHaveProperty('debug')
    expect(body).not.toHaveProperty('snapshot')
    expect(body).not.toHaveProperty('trace')
    expect(calls).toBe(1)
  })

  it('does not report an unverified X status as a successful page preview', () => {
    const url = 'https://x.com/alice/status/222'
    const outcome = fixture(url)
    outcome.result.document!.adapter = { id: 'x-public', version: '1.0.0', status: 'beta adapter' }
    outcome.result.document!.adapterValidation = { valid: false, issues: ['missing_post'] }
    outcome.result.markdown = 'Navigation and a different recommended post'
    const result = mapPreviewResult(url, normalizePreviewUrl(url), outcome, 100)
    expect(result).toMatchObject({ status: 'incomplete', markdown: null, reason: 'We could not verify the requested post in the page content.' })

    outcome.result.document!.adapterValidation = { valid: true, issues: [] }
    outcome.result.document!.entities = [{ type: 'post', id: '222', fields: {
      author: { raw: 'alice', normalized: 'alice', source: 'meta', path: 'meta[property="og:title"]', status: 'confirmed' },
      text: { raw: 'The verified post', normalized: 'The verified post', source: 'meta', path: 'meta[property="og:description"]', status: 'confirmed' },
    }, relationships: { author: 'alice' } }]
    expect(mapPreviewResult(url, normalizePreviewUrl(url), outcome, 100)).toMatchObject({ status: 'success', markdown: 'Post by @alice\n\nThe verified post', reason: null })
  })

  it('distinguishes a robots refusal from an unsafe URL policy refusal', () => {
    const url = 'https://example.com/page'
    const outcome = fixture(url)
    outcome.result.status = 'failed'
    outcome.result.failureReason = 'policy_denied'
    outcome.result.trace = [{ at: 0, lane: 'http', event: 'ssrf_denied' }]
    expect(mapPreviewResult(url, normalizePreviewUrl(url), outcome, 10)).toMatchObject({ status: 'failed', reason: 'This URL is not allowed for public preview.', diagnostic: { code: 'policy_denied', stage: 'policy' } })
    outcome.result.trace = [{ at: 0, lane: 'http', event: 'robots_disallowed' }]
    expect(mapPreviewResult(url, normalizePreviewUrl(url), outcome, 10)).toMatchObject({ status: 'blocked', reason: 'This site does not allow automated preview of this page.', diagnostic: { code: 'robots_disallowed', evidence: 'observed' } })
  })

  it('separates login, verification, timeout, and service failures for older clients', async () => {
    const url = 'https://example.com/page'
    const outcome = fixture(url)
    outcome.result.status = 'blocked'
    outcome.result.blockReason = 'login_wall'
    expect(mapPreviewResult(url, normalizePreviewUrl(url), outcome, 10)).toMatchObject({ status: 'blocked', diagnostic: { code: 'login_required' } })
    outcome.result.blockReason = 'bot_detected_generic'
    expect(mapPreviewResult(url, normalizePreviewUrl(url), outcome, 10)).toMatchObject({ status: 'blocked', diagnostic: { code: 'challenge' } })
    outcome.result.status = 'failed'
    outcome.result.blockReason = null
    outcome.result.failureReason = 'timeout'
    expect(mapPreviewResult(url, normalizePreviewUrl(url), outcome, 10)).toMatchObject({ status: 'timeout', diagnostic: { code: 'timeout' } })
    const base = await endpoint({ consume: async () => { throw new Error('quota offline') } }, async () => { throw new Error('must not capture') })
    const response = await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
    expect(await response.json()).toMatchObject({ status: 'failed', diagnostic: { code: 'service_unavailable' } })
  })

  it('rejects foreign Origin and unsupported options before spending quota', async () => {
    let quotaCalls = 0
    const url = await endpoint({ consume: async () => { quotaCalls++; return 'ok' } }, async target => fixture(target.url))
    const crossSite = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ url: 'https://docs.example' }) })
    expect(crossSite.status).toBe(403)
    const extra = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://docs.example', debug: true }) })
    expect(extra.status).toBe(400)
    expect(quotaCalls).toBe(0)
  })

  it('uses the last observed forwarded address and fails closed on quota outage', async () => {
    const visitors: string[] = []
    const url = await endpoint({ consume: async visitor => { visitors.push(visitor); return visitors.length === 1 ? 'ok' : 'visitor_limited' } }, async target => fixture(target.url))
    const request = (forwarded: string) => fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': forwarded }, body: JSON.stringify({ url: 'https://docs.example' }) })
    expect((await request('1.1.1.1, 9.8.7.6')).status).toBe(200)
    const limited = await request('2.2.2.2, 9.8.7.6')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(visitors).toEqual(['ip:9.8.7.6', 'ip:9.8.7.6'])
    const broken = await endpoint({ consume: async () => { throw new Error('Firestore unavailable') } }, async () => { throw new Error('should never run') })
    const failed = await fetch(`${broken}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://docs.example' }) })
    expect(failed.status).toBe(503)
    expect((await failed.json()).reason).toBe('The preview quota service is temporarily unavailable.')
  })

  it('masks an Amazon price when region is not verified', () => {
    const target = normalizePreviewUrl('https://www.amazon.sg/dp/B0D4DHBFFH')
    const outcome = fixture(target.url, true)
    outcome.result.markdown = '# Subject\n\nRecommended item price SGD 9999'
    const json: StructuredExtractionResult = {
      status: 'complete', data: { asin: 'B0D4DHBFFH', title: 'Subject', brand: 'Brand', price: 7.23, prices: [{ amount: 7.23 }], currency: 'SGD', deliveryLocation: null,
        specifications: { Price: 'SGD 9999' }, variants: [{ price: 'SGD 8888' }] },
      evidence: [], issues: [],
    }
    const mapped = mapPreviewResult(target.url, target, { ...outcome, json }, 20)
    expect(mapped.status).toBe('incomplete')
    expect(mapped.product?.status).toBe('incomplete')
    expect(mapped.product?.data).toEqual({ asin: 'B0D4DHBFFH', title: 'Subject', brand: 'Brand' })
    expect(JSON.stringify(mapped.product?.data)).not.toMatch(/9999|8888|price/i)
    expect(mapped.product?.issues).toContainEqual(expect.objectContaining({ code: 'region_unverified' }))
    expect(mapped.markdown).not.toContain('9999')
    expect(mapped.markdown).not.toContain('Price:')
  })

  it('does not expose price for a different Singapore postal code', () => {
    const target = normalizePreviewUrl('https://www.amazon.sg/dp/B0D4DHBFFH')
    const outcome = fixture(target.url, true)
    const json: StructuredExtractionResult = {
      status: 'complete', data: { asin: 'B0D4DHBFFH', price: 7.23, prices: [{ amount: 7.23 }], currency: 'SGD', deliveryLocation: 'Singapore 018956' },
      evidence: [], issues: [],
    }
    const mapped = mapPreviewResult(target.url, target, { ...outcome, json }, 20)
    expect(mapped.status).toBe('incomplete')
    expect(mapped.product?.region).toBeNull()
    expect(mapped.product?.data).toEqual({ asin: 'B0D4DHBFFH', title: null, brand: null })
    expect(mapped.product?.issues).toContainEqual(expect.objectContaining({ code: 'region_mismatch' }))
  })

  it('shows a verified Amazon.sg price with matching ASIN, Singapore location and SGD', () => {
    const target = normalizePreviewUrl('https://www.amazon.sg/dp/B0D4DHBFFH')
    const outcome = fixture(target.url, true)
    outcome.result.markdown = '# Subject\n\nRecommended item price SGD 9999'
    const json: StructuredExtractionResult = {
      status: 'complete', data: { asin: 'B0D4DHBFFH', price: 7.23, prices: [{ amount: 7.23, currency: 'SGD' }], currency: 'SGD', deliveryLocation: 'Singapore 238823' },
      evidence: [], issues: [],
    }
    const mapped = mapPreviewResult(target.url, target, { ...outcome, json }, 20)
    expect(mapped.status).toBe('success')
    expect(mapped.product?.status).toBe('complete')
    expect(mapped.product?.data).toMatchObject({ price: 7.23, currency: 'SGD' })
    expect(mapped.markdown).toContain('Price: SGD 7.23')
    expect(mapped.markdown).not.toContain('9999')
  })

  it('hides product data when page-selected ASIN is unverified', () => {
    const target = normalizePreviewUrl('https://www.amazon.sg/dp/B0D4DHBFFH')
    const outcome = fixture(target.url, true)
    const json: StructuredExtractionResult = { status: 'complete', data: { asin: 'B000000000', price: 7.23, currency: 'SGD', deliveryLocation: 'Singapore 238823' }, evidence: [], issues: [] }
    const mapped = mapPreviewResult(target.url, target, { ...outcome, json }, 20)
    expect(mapped.product?.asin).toBeNull()
    expect(mapped.product?.data).toBeNull()
    expect(mapped.status).toBe('incomplete')
    expect(mapped.diagnostic?.code).toBe('subject_unverified')
  })

  it('distinguishes a directly observed substitute subject from an unverified quote', () => {
    const target = normalizePreviewUrl('https://www.amazon.sg/dp/B0D4DHBFFH')
    const outcome = fixture(target.url, true)
    const json: StructuredExtractionResult = { status: 'incomplete', data: { asin: 'B0D4DHBFFH', currency: 'SGD', deliveryLocation: 'Singapore 238823' }, evidence: [], issues: [{ code: 'missing', path: '/price', message: 'missing' }] }
    expect(mapPreviewResult(target.url, target, { ...outcome, json }, 20).diagnostic).toMatchObject({ code: 'quote_unverified', stage: 'field' })
    expect(mapPreviewResult(target.url, target, { ...outcome, selectedAsin: 'B000000000', json }, 20)).toMatchObject({ status: 'incomplete', diagnostic: { code: 'subject_mismatch', evidence: 'observed' }, product: { data: null } })
  })

  it('treats a matching canonical without a selected-ASIN DOM witness as incomplete', () => {
    const target = normalizePreviewUrl('https://www.amazon.sg/dp/B0D4DHBFFH')
    const outcome = fixture(target.url, true)
    outcome.selectedAsin = null
    const json: StructuredExtractionResult = { status: 'complete', data: { asin: 'B0D4DHBFFH', price: 7.23, currency: 'SGD', deliveryLocation: 'Singapore 238823' }, evidence: [], issues: [] }
    const mapped = mapPreviewResult(target.url, target, { ...outcome, json }, 20)
    expect(mapped.status).toBe('incomplete')
    expect(mapped.product?.asin).toBeNull()
    expect(mapped.product?.data).toBeNull()
    expect(mapped.markdown).toBeNull()
  })

  it('uses a signed first-party visitor cookie and rejects a forged value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-preview-static-'))
    tempDirs.push(dir)
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>Preview</title>')
    const visitors: string[] = []
    const url = await endpoint({ consume: async visitor => { visitors.push(visitor); return 'ok' } }, async target => fixture(target.url), {
      staticDir: dir, visitorCookieSecret: 's'.repeat(32),
    })
    const page = await fetch(url)
    const cookie = page.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toMatch(/^w2l_visitor=[a-f0-9]{32}\.[a-f0-9]{64}$/)
    const request = (value: string, ip: string) => fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: value, 'x-forwarded-for': ip }, body: JSON.stringify({ url: 'https://docs.example' }) })
    expect((await request(cookie!, '1.1.1.1')).status).toBe(200)
    expect((await request(cookie!, '2.2.2.2')).status).toBe(200)
    expect((await request('w2l_visitor=' + 'a'.repeat(32) + '.' + 'b'.repeat(64), '3.3.3.3')).status).toBe(200)
    expect(visitors[0]).toBe(visitors[1])
    expect(visitors[0]).toMatch(/^visitor:/)
    expect(visitors[2]).toBe('ip:3.3.3.3')
  })

  it('allows owner-token evaluation without consuming visitor quota and keeps evidence private', async () => {
    let quotaCalls = 0
    const token = 'eval-' + 't'.repeat(32)
    const authorizationFlags: boolean[] = []
    const rawHtml = '<html><body>Same-capture owner-only witness</body></html>'
    const url = await endpoint({ consume: async () => { quotaCalls++; return 'ok' } }, async (target, _signal, _deadlineAt, _amazonState, ownerEvaluation) => {
      authorizationFlags.push(ownerEvaluation === true)
      return { ...fixture(target.url), ...(ownerEvaluation ? { rawHtml } : {}) }
    }, { evalToken: token, sourceCommit: 'a'.repeat(40) })
    const body = JSON.stringify({ url: 'https://docs.example' })
    const invalid = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' }, body })
    expect(invalid.status).toBe(401)
    const evalResponse = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body })
    expect(evalResponse.status).toBe(200)
    expect((await evalResponse.json()).evaluation).toMatchObject({ rawBodySha256: 'fixture-sha', rawHtml, sourceCommit: 'a'.repeat(40), fieldEvidence: [] })
    const publicResponse = await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const publicPayload = await publicResponse.json()
    expect(publicPayload).not.toHaveProperty('evaluation')
    expect(JSON.stringify(publicPayload)).not.toContain('Same-capture owner-only witness')
    expect(authorizationFlags).toEqual([true, false])
    expect(quotaCalls).toBe(1)
  })
})
