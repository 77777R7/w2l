/**
 * Same-host 1000-page catalog for the crawl resume volume probe.
 * Not part of the ground-truth fixture suite. No hard gates. Items do not
 * link back to the listing, so loop_detected cannot fire on a cycle.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const PAGE_COUNT = 1000

const PROSE =
  '<p>The harbour lantern kiln reached one thousand two hundred forty degrees before the glaze vitrified on this catalog piece.</p>' +
  '<p>Sediment cores from the estuary date to eighteen seventy three and were logged against the almanac kept at the plinth house.</p>' +
  '<p>Later experiments repeated the same steps and the temperature curve matched the first recording within fifteen degrees of mercury.</p>'

function listingBody(): string {
  const items = Array.from({ length: PAGE_COUNT }, (_, i) => {
    const n = i + 1
    return `<li><a href="/item/${n}">Catalog item ${String(n).padStart(4, '0')}</a></li>`
  }).join('\n')
  return `<!doctype html><html><head><title>1k catalog</title></head><body><main><h1>One thousand lanterns</h1><p>Synthetic listing of ${PAGE_COUNT} items for the crawl resume probe.</p><ul>${items}</ul>${PROSE}</main></body></html>`
}

function itemBody(n: string): string {
  return `<!doctype html><html><head><title>Item ${n}</title></head><body><article><h1>Catalog item ${n}</h1><p>Harbour lantern teapot catalog item ${n} is glazed cobalt and listed in the synthetic 1k set.</p>${PROSE}</article></body></html>`
}

function send(res: ServerResponse, body: string): void {
  const buf = Buffer.from(body)
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.byteLength })
  res.end(buf)
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const pathname = new URL(req.url ?? '/', 'http://probe.invalid').pathname
  if (pathname === '/' || pathname === '/listing') {
    send(res, listingBody())
    return
  }
  const item = pathname.match(/^\/item\/(\d+)$/)
  if (item !== null) {
    const n = Number(item[1])
    if (n >= 1 && n <= PAGE_COUNT) {
      send(res, itemBody(String(n)))
      return
    }
  }
  res.writeHead(404).end('not found')
}

export interface ProbeServer {
  url: string
  port: number
  close: () => Promise<void>
}

export async function startProbeServer(port = 0): Promise<ProbeServer> {
  const server = createServer(handle)
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

const entry = process.argv[1]
if (entry !== undefined && import.meta.url.endsWith(entry.replace(/\\/g, '/'))) {
  const port = Number(process.env['PROBE_PORT'] ?? 0)
  const server = await startProbeServer(port)
  process.stdout.write(`1k probe listening on ${server.url}\n`)
}
