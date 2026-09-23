import { serve } from '@hono/node-server'
import { readFileSync } from 'node:fs'
import { createApp, createApiEngine } from '@w2l/api'
import { BrowserLocalSubject, OriginScheduler, type Channel } from '@w2l/bench'
import { identityForRoute, localNetworkPolicy } from '@w2l/contracts'

const path = process.env.W2L_AMAZON_PUBLIC_STATE_FILE
if (!path) throw new Error('W2L_AMAZON_PUBLIC_STATE_FILE is required for this benchmark-only API')
const state = readFileSync(path, 'utf8')
const parsed = JSON.parse(state) as { cookies?: { domain: string }[]; origins?: { origin: string }[] }
if (!Array.isArray(parsed.cookies) || parsed.cookies.some(cookie => !/(^|\.)amazon\.(com|sg)$/i.test(cookie.domain))
  || !Array.isArray(parsed.origins) || parsed.origins.some(origin => !/(^|\.)amazon\.(com|sg)$/i.test(new URL(origin.origin).hostname))) {
  throw new Error('public preference state contains an out-of-scope origin')
}
const perHostConcurrency = Number(process.env.W2L_AMAZON_CONCURRENCY ?? 2)
if (![1, 2, 4].includes(perHostConcurrency)) throw new Error('baseline concurrency must be 1, 2, or 4')
const networkPolicy = { ...localNetworkPolicy(), perHostConcurrency }
const scheduler = new OriginScheduler(networkPolicy)
const subject = new BrowserLocalSubject('standard', null, false, networkPolicy, null, scheduler, state)
const channel: Channel = {
  id: 'browser_local',
  identity: identityForRoute('standard'),
  fetch: (url, _session, execution) => subject.fetch(url, execution?.deadlineAt, execution?.signal, execution?.onRetryAfter),
  close: () => subject.teardown(),
}
const engine = createApiEngine({
  taskRoot: process.env.W2L_TASK_ROOT ?? '.w2l/amazon-baseline/api-state',
  networkPolicy,
  channelsFor: mode => {
    if (mode !== 'standard') throw new Error('Amazon public baseline only accepts standard mode')
    return [channel]
  },
})
const app = createApp(engine)
// A benchmark round owns no persistent browser state; the public preference
// is restored into each fresh context. Recycle Chromium between rounds so a
// long live test does not depend on one growing DevTools connection.
app.post('/baseline/reset-browser', async c => {
  await subject.teardown()
  return c.json({ reset: true })
})
const port = Number(process.env.W2L_AMAZON_BASELINE_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('W2L_AMAZON_BASELINE_PORT is required')
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close()
  void engine.close({ cancelActive: true }).catch(error => { console.error(error); process.exitCode = 1 })
})
console.log(`w2l-amazon-baseline-api listening on 127.0.0.1:${port}`)
