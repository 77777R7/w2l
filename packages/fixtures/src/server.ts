import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FIXTURES, SOFT_404_BODY, resetFixtureState, type Fixture } from './fixtures.js'

/** Routes whose fixture handles a whole subtree rather than one exact path. */
const PREFIX_ROUTES = ['/redirect/chain/', '/redirect/loop/'] as const

function pathOf(target: string): string {
  return new URL(target, 'http://fixtures.invalid').pathname
}

function resolve(pathname: string): Fixture | undefined {
  const exact = FIXTURES.find((f) => pathOf(f.truth.target) === pathname)
  if (exact) return exact
  const prefix = PREFIX_ROUTES.find((p) => pathname.startsWith(p))
  if (!prefix) return undefined
  return FIXTURES.find((f) => pathOf(f.truth.target).startsWith(prefix))
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const pathname = new URL(req.url ?? '/', 'http://fixtures.invalid').pathname

  // Control route: lets a runner in another process put stateful fixtures back to
  // attempt 1 before each subject. Not part of the suite; no fixture targets it.
  if (pathname === '/__reset') {
    resetFixtureState()
    res.writeHead(204).end()
    return
  }

  const fixture = resolve(pathname)

  if (!fixture) {
    // Unrouted paths return the soft-404 body under HTTP 200 on purpose: the
    // random-path probe compares an arbitrary path against the requested one, so
    // the site must behave like a real soft-404 site everywhere.
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(SOFT_404_BODY),
    })
    res.end(SOFT_404_BODY)
    return
  }

  const spec = fixture.respond(req)

  if (spec.handler) {
    spec.handler(req, res)
    return
  }

  const send = (): void => {
    const body = spec.body ?? ''
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
    res.writeHead(spec.status ?? 200, {
      ...spec.headers,
      'content-length': buf.byteLength,
    })
    if (req.method === 'HEAD') res.end()
    else res.end(buf)
  }

  if (spec.delayMs && spec.delayMs > 0) {
    const timer = setTimeout(send, spec.delayMs)
    res.on('close', () => clearTimeout(timer))
    return
  }
  send()
}

export interface FixtureServer {
  readonly url: string
  readonly port: number
  close: () => Promise<void>
}

export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  resetFixtureState()
  const server: Server = createServer(handle)
  // Hanging fixtures deliberately hold sockets open; without this, close() waits forever.
  server.on('connection', (socket) => socket.unref())

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
