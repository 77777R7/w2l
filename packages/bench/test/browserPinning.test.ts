import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { hostedNetworkPolicy, localNetworkPolicy } from '@w2l/contracts'
import { pinnedBrowserHostRules, SsrfDeniedError } from '../src/egress.js'
import { BrowserLocalSubject } from '../src/subjects/browserLocal.js'

describe('host-pinned Chromium resolver', () => {
  it('pins only fully validated hosts and rejects mixed private DNS answers', async () => {
    const policy = hostedNetworkPolicy()
    const rules = await pinnedBrowserHostRules(['safe.test'], policy, async () => [{ address: '93.184.215.14', family: 4 }])
    expect(rules).toBe('MAP safe.test 93.184.215.14, MAP * ~NOTFOUND')
    await expect(pinnedBrowserHostRules(['safe.test'], policy, async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])).rejects.toBeInstanceOf(SsrfDeniedError)
    await expect(pinnedBrowserHostRules(['safe.test, MAP * 127.0.0.1'], policy)).rejects.toBeInstanceOf(SsrfDeniedError)
  })

  it('keeps a validated socket destination after DNS changes, including subrequests and redirects', async () => {
    let safeHits = 0
    let blockedHits = 0
    let websocketUpgrades = 0
    const server = createServer((req, res) => {
      if (req.headers.host?.startsWith('blocked.test')) blockedHits++
      else safeHits++
      if (req.url === '/safe.js') {
        res.setHeader('content-type', 'application/javascript')
        res.end('window.safeLoaded = true')
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://blocked.test:${port}/private` }).end()
      } else {
        res.setHeader('content-type', 'text/html')
        res.end(`<html><body><h1>safe</h1><script src="http://safe.test:${port}/safe.js"></script><script src="http://blocked.test:${port}/private.js"></script><script>new WebSocket('ws://safe.test:${port}/ws')</script></body></html>`)
      }
    })
    server.on('upgrade', (_req, socket) => { websocketUpgrades++; socket.destroy() })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing fixture port')
    const port = address.port
    let dnsAnswer = '127.0.0.1'
    let lookups = 0
    const rules = await pinnedBrowserHostRules(['safe.test'], localNetworkPolicy(), async () => {
      lookups++
      return [{ address: dnsAnswer, family: 4 }]
    })
    dnsAnswer = '169.254.169.254' // Rebind after the launch rule is frozen.
    const browser = await chromium.launch({ headless: true, args: ['--proxy-server=direct://', `--host-resolver-rules=${rules}`] })
    try {
      const context = await browser.newContext()
      await context.routeWebSocket('**/*', async ws => { await ws.close({ code: 1008 }) })
      const page = await context.newPage()
      await page.goto(`http://safe.test:${port}/`, { waitUntil: 'load' })
      expect(await page.locator('h1').textContent()).toBe('safe')
      expect(await page.evaluate(() => (window as unknown as { safeLoaded?: boolean }).safeLoaded)).toBe(true)
      expect(safeHits).toBeGreaterThanOrEqual(2)
      expect(blockedHits).toBe(0)
      await page.waitForTimeout(50)
      expect(websocketUpgrades).toBe(0)
      await expect(page.goto(`http://safe.test:${port}/redirect`)).rejects.toThrow()
      expect(blockedHits).toBe(0)
      expect(lookups).toBe(1)
    } finally {
      await browser.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }, 30_000)

  it('blocks WebSocket and off-host subrequests through the actual hosted browser subject', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'w2l-browser-pin-'))
    const keyPath = join(directory, 'key.pem')
    const certPath = join(directory, 'cert.pem')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-days', '1'], { stdio: 'ignore' })
    let safeScriptHits = 0
    let privateHits = 0
    let websocketUpgrades = 0
    const server = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
      if (req.url === '/safe.js') {
        safeScriptHits++
        res.setHeader('content-type', 'application/javascript')
        res.end('window.safeLoaded = true')
      } else if (req.url === '/private.js') {
        privateHits++
        res.setHeader('content-type', 'application/javascript')
        res.end('window.privateLoaded = true')
      } else if (req.url === '/robots.txt') {
        res.setHeader('content-type', 'text/plain')
        res.end('User-agent: *\nAllow: /\n')
      } else {
        res.setHeader('content-type', 'text/html')
        res.end(`<html><body><article><h1>Hosted fixture</h1><p>A substantive document for the restricted browser path.</p></article><script src="https://localhost:${port}/safe.js"></script><script src="https://127.0.0.1:${port}/private.js"></script><script>document.body.setAttribute('data-ws-attempted','true');new WebSocket('wss://localhost:${port}/ws')</script></body></html>`)
      }
    })
    server.on('upgrade', (_req, socket) => { websocketUpgrades++; socket.destroy() })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing fixture port')
    const port = address.port
    const originalLaunch = chromium.launch.bind(chromium)
    const launch = vi.spyOn(chromium, 'launch').mockImplementation(options => originalLaunch({
      ...options,
      // Only this ephemeral self-signed fixture relaxes certificate checks.
      args: [...(options?.args ?? []), '--ignore-certificate-errors'],
    }))
    let renderedHtml = ''
    const subject = new BrowserLocalSubject('standard', null, false, localNetworkPolicy(), null, undefined, null, ['localhost'], html => { renderedHtml = html })
    try {
      const result = await subject.fetch(`https://localhost:${port}/`, Date.now() + 15_000)
      expect(result.evidence.httpStatus).toBe(200)
      expect(renderedHtml).toContain('data-ws-attempted="true"')
      expect(safeScriptHits).toBe(1)
      expect(privateHits).toBe(0)
      expect(websocketUpgrades).toBe(0)
    } finally {
      await subject.teardown()
      launch.mockRestore()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
