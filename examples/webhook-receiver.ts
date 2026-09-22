import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { WebhookInbox, verifyWebhookSignature } from '../packages/runtime/src/webhookInbox.js'

const host = process.env.WEBHOOK_HOST ?? '127.0.0.1'
const port = Number(process.env.WEBHOOK_PORT ?? 8788)
const secret = process.env.WEBHOOK_SECRET
if (!secret) throw new Error('WEBHOOK_SECRET is required (use the same value as worker W2L_WEBHOOK_SECRET_DEMO)')
const inbox = WebhookInbox.open(process.env.WEBHOOK_DB ?? '.w2l/receiver.sqlite')
const handler = async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ ok: true })); return }
  // The inspect endpoint requires the shared secret even behind a public tunnel.
  if (req.method === 'GET' && req.url === '/status') {
    if (req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401).end(); return }
    res.end(JSON.stringify(inbox.status())); return
  }
  if (req.method !== 'POST' || req.url !== '/webhook') { res.writeHead(404).end(); return }
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > 1_048_576) { res.writeHead(413).end(); req.destroy(); return }
      chunks.push(buffer)
    }
    const body = Buffer.concat(chunks).toString('utf8')
    const timestamp = req.headers['x-w2l-timestamp']
    const signature = req.headers['x-w2l-signature']
    if (!verifyWebhookSignature(secret, typeof timestamp === 'string' ? timestamp : undefined, typeof signature === 'string' ? signature : undefined, body)) { res.writeHead(401).end(); return }
    const receipt = inbox.receive(body)
    res.writeHead(200).end(JSON.stringify(receipt))
  } catch (error) {
    res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}
const cert = process.env.TLS_CERT_FILE
const key = process.env.TLS_KEY_FILE
if (Boolean(cert) !== Boolean(key)) throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be set together')
if (!cert && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('plain HTTP receiver may only bind loopback; use TLS or a local HTTPS tunnel')
const server = cert && key ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, handler) : createHttpServer(handler)
server.requestTimeout = 30_000
server.listen(port, host, () => {
  const address = server.address()
  const actualPort = address && typeof address === 'object' ? address.port : port
  console.log(JSON.stringify({ receiver: `${cert ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${actualPort}/webhook`, storage: process.env.WEBHOOK_DB ?? '.w2l/receiver.sqlite' }))
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(() => { inbox.close(); process.exit(0) }) })
