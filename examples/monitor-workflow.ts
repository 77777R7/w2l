import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { W2L, type MonitorView } from '@w2l/sdk'

// Run from the repository root after npm ci and npm run typecheck.
// See docs/onboarding.md for separate API, source and worker terminals.
const sourcePort = Number(process.env.W2L_SOURCE_PORT ?? 8790)
const sourceUrl = `http://127.0.0.1:${sourcePort}/product`
const stateFile = process.env.W2L_SOURCE_STATE ?? '.w2l/onboarding-source.json'
const monitorId = process.env.W2L_MONITOR_ID ?? 'onboarding-price'
const destinationId = process.env.W2L_DESTINATION_ID ?? 'onboarding-webhook'
const client = new W2L({
  baseUrl: process.env.W2L_API_URL ?? 'http://127.0.0.1:8787',
  token: process.env.W2L_API_TOKEN,
})

async function readPrice(): Promise<string> {
  try {
    const data = JSON.parse(await readFile(stateFile, 'utf8')) as { price?: unknown }
    if (typeof data.price !== 'string' || !/^\d+(?:\.\d+)?$/.test(data.price)) throw new Error(`Invalid price in ${stateFile}`)
    return data.price
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '10.00'
    throw error
  }
}

function printView(view: MonitorView): void {
  console.log(JSON.stringify({ monitorId, enabled: view.enabled, baseline: view.baseline,
    latestRun: view.runs[0] ?? null, events: view.events, outbox: view.outbox }, null, 2))
}

async function main(): Promise<void> {
  switch (process.argv[2] ?? 'help') {
    case 'source': {
      const server = createServer(async (req, res) => {
        try {
          if (req.url === '/robots.txt') {
            res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /\n')
            return
          }
          if (req.url !== '/product') { res.writeHead(404).end('Not found'); return }
          const price = await readPrice()
          const etag = `"${createHash('sha256').update(price).digest('hex')}"`
          if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, { etag }).end()
            console.log('GET /product -> 304; no response body')
            return
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag })
          res.end(`<!doctype html><html><head><title>W2L sample product</title></head><body><main><article>
            <h1>W2L sample product</h1><h2>Price</h2><p>${price}</p><h2>Description</h2>
            <p>This controlled demonstration product supplies a stable public document identity and an exact decimal price.
            Its source content is deliberately served from this developer-owned local process. The example changes only
            the price field so that a developer can inspect a committed baseline, an unchanged conditional request and
            a verified business change. These observations are sample data, not market prices or production evidence.</p>
            </article></main></body></html>`)
          console.log(`GET /product -> 200; price=${price}`)
        } catch (error) { res.writeHead(500).end(error instanceof Error ? error.message : String(error)) }
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(sourcePort, '127.0.0.1', resolve)
      })
      console.log(`Controlled source: ${sourceUrl}; price state: ${stateFile}`)
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close())
      break
    }
    case 'price': {
      const price = process.argv[3]
      if (price === undefined || !/^\d+(?:\.\d+)?$/.test(price)) throw new Error('Usage: price <nonnegative decimal>')
      await mkdir(dirname(stateFile), { recursive: true })
      await writeFile(stateFile, JSON.stringify({ price }) + '\n')
      console.log(`Source price saved: ${price}; the next run detects it`)
      break
    }
    case 'setup': {
      const existing = (await client.listMonitors()).find((view) => view.revision.monitorId === monitorId)
      if (existing && existing.revision.url !== sourceUrl) throw new Error('Monitor already exists with a different source URL; choose W2L_MONITOR_ID')
      if (!existing) await client.createMonitor({
        monitorId, revision: 1, url: sourceUrl, ruleVersion: 'sample-price/v1',
        intervalMs: 60_000, staleAfterMs: 180_000,
        config: { adapter: 'markdown-sections/v1', workspaceId: 'onboarding', entityKey: 'sample-product', viewKey: 'public',
          expectedTitle: 'W2L sample product', schemaVersion: 'sample-price/v1', captureMode: 'http', conditionalRequests: true,
          fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true, currency: 'USD' }] },
      })
      const webhookUrl = process.env.W2L_WEBHOOK_URL
      if (webhookUrl) {
        const prior = (await client.listDeliveryDestinations({ monitorId })).find((destination) => destination.id === destinationId)
        if (prior && prior.url !== webhookUrl) throw new Error('Destination already has a different URL; choose W2L_DESTINATION_ID')
        if (!prior) await client.createDeliveryDestination({ id: destinationId, monitorId, url: webhookUrl,
          ...(process.env.W2L_WEBHOOK_SECRET_ENV ? { secretEnv: process.env.W2L_WEBHOOK_SECRET_ENV } : {}) })
      }
      printView(await client.getMonitor(monitorId))
      break
    }
    case 'run':
      printView(await client.runMonitor(monitorId, { triggerKey: process.env.W2L_TRIGGER_KEY ?? `manual:${randomUUID()}` }))
      break
    case 'inspect':
      printView(await client.getMonitor(monitorId))
      console.log(JSON.stringify({ deliveries: await client.listDeliveries({ monitorId }) }, null, 2))
      break
    case 'delivery': {
      const id = process.argv[3]
      if (!id) throw new Error('Usage: delivery <deliveryId>')
      console.log(JSON.stringify(await client.getDelivery(id), null, 2))
      break
    }
    case 'retry': {
      const id = process.argv[3]
      if (!id) throw new Error('Usage: retry <deliveryId>')
      console.log(JSON.stringify(await client.retryDelivery(id), null, 2))
      break
    }
    case 'pause': printView(await client.pauseMonitor(monitorId)); break
    case 'resume': printView(await client.resumeMonitor(monitorId)); break
    case 'cancel': {
      const runId = process.argv[3]
      if (!runId) throw new Error('Usage: cancel <runId>')
      printView(await client.cancelMonitorRun(monitorId, runId))
      break
    }
    default:
      console.log('Usage: node --import tsx examples/monitor-workflow.ts source|price <decimal>|setup|run|inspect|delivery <id>|retry <id>|pause|resume|cancel <runId>')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
