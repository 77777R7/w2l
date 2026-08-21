import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyLedger } from '@w2l/http-core'
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
let robotsHits = 0
let privateHits = 0

beforeAll(async () => {
  flakyHits = 0
  robotsHits = 0
  privateHits = 0
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
    } else if (req.url === '/robots.txt') {
      robotsHits++
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('User-agent: *\nDisallow: /private\nAllow: /private/ok\n')
    } else if (req.url?.startsWith('/private')) {
      // Reachable in principle — robots is what must stop us, not the server.
      // Body is substantive so an extraction escalation can't be mistaken for
      // a robots refusal on the paths robots actually allows.
      privateHits++
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><body><article><h1>Private area</h1>' +
          '<p>This page sits under the /private prefix that robots.txt disallows, and it is served ' +
          'normally by the origin so that the only thing capable of preventing a fetch is the ' +
          'crawler honouring the rules it claims to honour.</p>' +
          '<p>The more specific Allow rule beneath the same prefix is what distinguishes a correct ' +
          'longest-match implementation from one that simply refuses the whole subtree.</p></article></body></html>',
      )
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

  it('produces a compliance record whose declared identity is honest', async () => {
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/spa`)
      expect(out.compliance).not.toBeNull()
      const record = out.compliance!
      // The mode's declared UA is derived from the *real* Chromium version, so
      // the record must carry that UA — not the CHROME_MAJOR_FLOOR placeholder.
      const declared = record.sentHeaders.headers.find((h) => h.name === 'user-agent')
      expect(declared).toBeDefined()
      expect(declared!.value).toMatch(/Chrome\/\d+\.0\.0\.0 Safari/)
      // The honesty check runs inside fetch and, on a clean context, must be
      // silent — a mismatch surfaces as an identity_mismatch trace event.
      expect(out.trace.filter((t) => t.event === 'identity_mismatch')).toHaveLength(0)
      // robots.txt was really consulted: the record cites the URL it read and
      // the group that governed the decision, not a placeholder.
      expect(record.robots.decision).toBe('allowed')
      expect(record.robots.robotsUrl).toBe(`${url}/robots.txt`)
      expect(record.robots.robotsSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(record.robots.matchedUserAgentGroup).toBe('*')
      expect(record.robots.skippedFetch).toBe(false)
    } finally {
      await subject.teardown()
    }
  })

  it('refuses a robots-disallowed path and still mints a record proving it', async () => {
    const subject = new BrowserLocalSubject()
    const before = privateHits
    try {
      const out = await subject.fetch(`${url}/private/secret`)
      // The declared identity claims respectsRobots; the only thing that makes
      // that claim mean anything is the fetch not happening.
      expect(privateHits).toBe(before)
      expect(out.status).toBe('failed')
      expect(out.failureReason).toBe('policy_denied')
      expect(out.markdown).toBeNull()

      const record = out.compliance!
      expect(record.robots.decision).toBe('disallowed')
      expect(record.robots.skippedFetch).toBe(true)
      // The rule that did it is cited, so the publisher can check the verdict
      // against their own robots.txt rather than take our word for it.
      expect(record.robots.appliedRules.map((r) => r.pattern)).toContain('/private')
    } finally {
      await subject.teardown()
    }
  })

  it('honours a more-specific Allow beneath a Disallow', async () => {
    const subject = new BrowserLocalSubject()
    try {
      const out = await subject.fetch(`${url}/private/ok`)
      expect(out.status).toBe('success')
      const record = out.compliance!
      expect(record.robots.decision).toBe('allowed')
      expect(record.robots.appliedRules.map((r) => r.pattern)).toEqual(['/private/ok', '/private'])
    } finally {
      await subject.teardown()
    }
  })

  it('fetches robots.txt once per origin, not once per page', async () => {
    const subject = new BrowserLocalSubject()
    const before = robotsHits
    try {
      await subject.fetch(`${url}/spa`)
      await subject.fetch(`${url}/spa`)
      await subject.fetch(`${url}/spa`)
      expect(robotsHits - before).toBe(1)
    } finally {
      await subject.teardown()
    }
  })

  it('chains every record in a run into one verifiable ledger', async () => {
    const subject = new BrowserLocalSubject()
    try {
      await subject.fetch(`${url}/spa`)
      await subject.fetch(`${url}/private/secret`) // denied, but still recorded
      await subject.fetch(`${url}/spa`)

      const ledger = subject.ledger()
      expect(ledger.records).toHaveLength(3)
      expect(ledger.records[0]!.prevRecordHash).toBeNull()
      expect(ledger.records[1]!.prevRecordHash).toBe(ledger.records[0]!.contentHash)
      expect(ledger.records[2]!.prevRecordHash).toBe(ledger.records[1]!.contentHash)

      const verdict = verifyLedger(ledger)
      expect(verdict.valid).toBe(true)
      expect(verdict.headHash).toBe(ledger.records[2]!.contentHash)
    } finally {
      await subject.teardown()
    }
  })

  it('a ledger with the denied fetch removed fails verification', async () => {
    // The reason to chain at all: dropping the inconvenient record must be
    // detectable, or the ledger only proves what we chose to admit.
    const subject = new BrowserLocalSubject()
    try {
      await subject.fetch(`${url}/spa`)
      await subject.fetch(`${url}/private/secret`)
      await subject.fetch(`${url}/spa`)

      const ledger = subject.ledger()
      const scrubbed = {
        ...ledger,
        records: [ledger.records[0]!, ledger.records[2]!],
      }
      const verdict = verifyLedger(scrubbed)
      expect(verdict.valid).toBe(false)
      expect(verdict.violations.some((v) => v.kind === 'broken_link')).toBe(true)
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
