import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserLocalSubject } from '../src/subjects/browserLocal.js'

/**
 * Browser-local transport behaviour against a bespoke server:
 * the full fixture suite already scores the SPA and timeout cases in the
 * bench; these two tests pin the subject's own semantics without the
 * fixture suite's 60s runner races.
 */

let server: Server
let url: string
let flakyHits = 0

beforeAll(async () => {
  flakyHits = 0
  server = createServer((req, res) => {
    if (req.url === '/spa') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><body><div id="root"></div><script>' +
          'document.getElementById("root").innerHTML = "<article><h1>Rendered</h1><p>Loaded after script execution.</p></article>"' +
          '</script></body></html>',
      )
    } else if (req.url === '/flaky') {
      flakyHits++
      if (flakyHits === 1) {
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><body><h1>Service Unavailable</h1></body></html>')
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><html><body><article><h1>Recovered</h1><p>Succeeded on the second attempt.</p></article></body></html>',
        )
      }
    } else if (req.url === '/hang') {
      // Never respond; the subject's own timeout must fire and map to `timeout`.
    } else if (req.url === '/gate') {
      res.writeHead(403, {
        'content-type': 'text/html; charset=utf-8',
        'cf-mitigated': 'challenge',
      })
      res.end(
        '<!doctype html><html><head><title>Just a moment...</title></head><body>' +
          '<h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue.</p></body></html>',
      )
    } else if (req.url === '/plain-403') {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><body><h1>403 Forbidden</h1></body></html>')
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no address')
  url = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('BrowserLocalSubject transport', () => {
  it('executes scripts and extracts the rendered DOM', async () => {
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/spa`)
      expect(out.status).toBe('success')
      expect(out.lane).toBe('browser_local')
      expect(out.markdown).toContain('Loaded after script execution.')
    } finally {
      await subject.teardown()
    }
  })

  it('maps a navigation deadline to failureReason timeout', async () => {
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/hang`)
      expect(out.status).toBe('failed')
      expect(out.failureReason).toBe('timeout')
    } finally {
      await subject.teardown()
    }
  })

  it('retries a 503 once and succeeds on the second attempt', async () => {
    flakyHits = 0
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/flaky`)
      expect(out.status).toBe('success')
      expect(out.markdown).toContain('Succeeded on the second attempt.')
      expect(out.usage.attemptCount).toBe(2)
      expect(out.usage.requestCount).toBe(2)
      expect(out.trace.filter((t) => t.event === 'retry')).toHaveLength(1)
    } finally {
      await subject.teardown()
    }
  })

  it('names the gate and escalates to the user-owned proxy, not to itself', async () => {
    // The browser lane is already the escalation target for an http-lane
    // interstitial. When the gate holds *here*, the only honest next step is
    // the user's own network — there is no further capability of ours to offer.
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/gate`)
      expect(out.status).toBe('blocked')
      expect(out.blockReason).toBe('cloudflare_challenge')
      expect(out.markdown).toBeNull()
      expect(out.escalations).toEqual([
        {
          from: 'browser_local',
          to: 'browser_proxy',
          trigger: 'blocked:cloudflare_challenge',
          improved: null,
        },
      ])
    } finally {
      await subject.teardown()
    }
  })

  it('leaves a bare 403 as an ordinary http_error', async () => {
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/plain-403`)
      expect(out.status).toBe('failed')
      expect(out.failureReason).toBe('http_error')
      expect(out.blockReason).toBeNull()
    } finally {
      await subject.teardown()
    }
  })
})
