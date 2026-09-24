import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ALL_BOILERPLATE, NAV_MARKER, startFixtureServer, type FixtureServer } from '@w2l/fixtures'
import { ResilientHttpSubject } from '../src/subjects/resilientHttp.js'

let robotsServer: Server
let robotsUrl: string
let privateHits = 0

beforeAll(async () => {
  privateHits = 0
  robotsServer = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('User-agent: *\nDisallow: /private\nAllow: /private/ok\n')
      return
    }
    if (req.url?.startsWith('/private')) {
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
      return
    }
    if (req.url === '/redirect-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end()
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => robotsServer.listen(0, '127.0.0.1', resolve))
  const addr = robotsServer.address()
  if (addr === null || typeof addr === 'string') throw new Error('no address')
  robotsUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => robotsServer.close(() => resolve()))
})

describe('ResilientHttpSubject robots', () => {
  it('never applies a local platform exception to another host', async () => {
    const subject = new ResilientHttpSubject('standard', undefined, undefined, true, 'http://127.0.0.1:7890', true)
    try {
      await expect(subject.fetch('https://example.com/')).rejects.toThrow('limited to fixed platform hosts')
    } finally { await subject.teardown() }
  })

  it('never fetches the page when public-preview robots responds 503', async () => {
    let pageHits = 0
    const server = createServer((req, res) => {
      if (req.url === '/robots.txt') res.writeHead(503).end('temporarily unavailable')
      else { pageHits++; res.writeHead(200).end('<html><body>Must not fetch</body></html>') }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no fixture address')
    const subject = new ResilientHttpSubject('standard', undefined, undefined, true)
    try {
      const out = await subject.fetch(`http://127.0.0.1:${address.port}/page`)
      expect(out.status).toBe('failed')
      expect(out.failureReason).toBe('policy_denied')
      expect(out.trace).toContainEqual(expect.objectContaining({ event: 'robots_disallowed' }))
      expect(pageHits).toBe(0)
    } finally {
      await subject.teardown()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('refuses a robots-disallowed path and never hits the origin', async () => {
    const subject = new ResilientHttpSubject()
    const before = privateHits
    const out = await subject.fetch(`${robotsUrl}/private/secret`)
    expect(privateHits).toBe(before)
    expect(out.status).toBe('failed')
    expect(out.failureReason).toBe('policy_denied')
    expect(out.markdown).toBeNull()
    expect(out.trace.some((t) => t.event === 'robots_disallowed')).toBe(true)
  })

  it('honours a more-specific Allow beneath a Disallow', async () => {
    const subject = new ResilientHttpSubject()
    const out = await subject.fetch(`${robotsUrl}/private/ok`)
    expect(out.status).toBe('success')
    expect(out.markdown).toContain('Private area')
  })

  it('rejects a redirect to metadata before any follow-up request', async () => {
    const subject = new ResilientHttpSubject()
    const out = await subject.fetch(`${robotsUrl}/redirect-metadata`)
    expect(out.status).toBe('failed')
    expect(out.failureReason).toBe('policy_denied')
    expect(out.usage.requestCount).toBe(1)
    expect(out.trace.some(event => event.event === 'ssrf_denied')).toBe(true)
  })
})

describe('ResilientHttpSubject listing links', () => {
  let fixtures: FixtureServer

  beforeAll(async () => {
    fixtures = await startFixtureServer()
  })

  afterAll(async () => {
    await fixtures.close()
  })

  it('puts listing and nav hrefs on the scrape result without leaking chrome into markdown', async () => {
    const subject = new ResilientHttpSubject()
    const out = await subject.fetch(`${fixtures.url}/pt/listing`)
    expect(out.status).toBe('success')
    expect(out.links).toContain(`${fixtures.url}/pt/item/1`)
    expect(out.links).toContain(`${fixtures.url}/pt/item/4`)
    expect(out.links).toContain(`${fixtures.url}/`)
    expect(out.links).toContain(`${fixtures.url}/pricing`)
    expect(out.markdown).toContain('Bespoke teapot catalog 01')
    expect(out.markdown).not.toContain(NAV_MARKER)
    for (const marker of ALL_BOILERPLATE) {
      expect(out.markdown).not.toContain(marker)
    }
    expect(JSON.stringify(out)).not.toMatch(/"html":/)
    expect(out).not.toHaveProperty('html')
  })
})
