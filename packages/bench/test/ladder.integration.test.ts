import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { LadderRunner } from '../src/routing/ladder.js'
import { ResilientHttpSubject } from '../src/subjects/resilientHttp.js'
import { BrowserLocalSubject } from '../src/subjects/browserLocal.js'

/**
 * Ladder regression against REAL subjects and a REAL local server:
 *
 *  A. a JS shell (empty #root + a script that renders the content) must
 *     escalate — HTTP cannot run the script, the browser can;
 *  B. a gate route must escalate from http to browser_local.
 *
 * These are the two real-world cases the ladder exists for, pinned with
 * actual Chromium and actual extraction, not fake channels.
 */

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/spa') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><body><div id="root"></div><script>' +
          'document.getElementById("root").innerHTML = ' +
          '"<article><h1>Rendered by the browser</h1><p>This text only exists after script execution.</p></article>"' +
          '</script></body></html>',
      )
    } else if (req.url === '/thin') {
      // A real page, but thin: extraction succeeds with very little text, so
      // the http lane reports success AND the quality_low_yield signal.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><body>' +
          Array.from(
            { length: 6 },
            (_, i) =>
              `<div><p>Some unrelated piece of text number ${i} that just fills space and nothing else really.</p></div>`,
          ).join('') +
          '<div id="content"><p>A genuinely small paragraph of real content that still crosses the eighty character minimum.</p></div>' +
          '<div><p>A closing note at the bottom of the page with a few more words.</p></div>' +
          '</body></html>',
      )
    } else if (req.url === '/gate') {
      res.writeHead(403, {
        'content-type': 'text/html; charset=utf-8',
        'cf-mitigated': 'challenge',
      })
      res.end(
        '<!doctype html><html><head><title>Just a moment...</title></head><body>' +
          '<h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue.</p></body></html>',
      )
    } else if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('User-agent: *\nDisallow:\n')
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('ladder with real subjects on a real server', () => {
  it('SPA shell: http escalates (empty_unverified) and the browser renders the content', async () => {
    const browser = new BrowserLocalSubject('standard')
    try {
      const runner = new LadderRunner(
        [
          { id: 'http', fetch: (url) => new ResilientHttpSubject().fetch(url) },
          { id: 'browser_local', fetch: (url) => browser.fetch(url) },
        ],
        { mode: 'authed' },
      )

      const run = await runner.run(`${base}/spa`)
      expect(run.channelsTried).toEqual(['http', 'browser_local'])
      expect(run.result.status).toBe('success')
      expect(run.result.lane).toBe('browser_local')
      expect(run.result.markdown).toContain('Rendered by the browser')
      expect(run.result.markdown).toContain('only exists after script execution')
      // The subject itself asked for the escalation.
      const steps = run.ladderTrace.filter((t) => t.event === 'ladder_step')
      expect(steps[0]).toMatchObject({
        channel: 'http',
        detail: { escalate: 'subject_escalations', status: 'failed' },
      })
    } finally {
      await browser.teardown()
    }
  })

  it('bot gate: http escalates and the browser wins with rendered content', async () => {
    const browser = new BrowserLocalSubject('standard')
    try {
      const runner = new LadderRunner(
        [
          { id: 'http', fetch: (url) => new ResilientHttpSubject().fetch(url) },
          { id: 'browser_local', fetch: (url) => browser.fetch(url) },
        ],
        { mode: 'authed' },
      )

      const run = await runner.run(`${base}/gate`)
      // The gate route returns the challenge for the browser too — both arms
      // are honestly blocked, and the ladder reports the last refusal rather
      // than inventing a success.
      expect(run.result.status).toBe('blocked')
      expect(run.result.blockReason).toBe('cloudflare_challenge')
      expect(run.channelsTried).toEqual(['http', 'browser_local'])
    } finally {
      await browser.teardown()
    }
  })

  it('quality signal: a thin, low-confidence http success escalates to the browser', async () => {
    const browser = new BrowserLocalSubject('standard')
    try {
      const runner = new LadderRunner(
        [
          { id: 'http', fetch: (url) => new ResilientHttpSubject().fetch(url) },
          { id: 'browser_local', fetch: (url) => browser.fetch(url) },
        ],
        { mode: 'authed' },
      )

      const run = await runner.run(`${base}/thin`)
      // The http result was a genuine success — but thin — and the ladder
      // offered it to the browser instead of accepting it as the answer.
      expect(run.channelsTried).toEqual(['http', 'browser_local'])
      expect(run.result.status).toBe('success')
      const steps = run.ladderTrace.filter((t) => t.event === 'ladder_step')
      expect(steps[0]).toMatchObject({
        channel: 'http',
        detail: { escalate: 'quality_low_yield', status: 'success' },
      })
    } finally {
      await browser.teardown()
    }
  })
})
