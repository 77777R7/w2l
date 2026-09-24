import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createPreviewServer } from '../../packages/public-preview/dist/server.js'
import { validateAmazonPublicState } from '../../packages/public-preview/dist/preview.js'

// Review-only launcher. Production uses Firestore for restart-safe quota and
// Amazon origin coordination; this process deliberately binds loopback only.
const port = Number(process.env.W2L_PUBLIC_PREVIEW_PORT ?? 8798)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid W2L_PUBLIC_PREVIEW_PORT')

let amazonState = null
if (process.env.W2L_AMAZON_PUBLIC_STATE_FILE) {
  amazonState = await readFile(process.env.W2L_AMAZON_PUBLIC_STATE_FILE, 'utf8')
  validateAmazonPublicState(amazonState)
}

let day = ''
let total = 0
const visitors = new Map()
function decision(visitor, consume) {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) { day = today; total = 0; visitors.clear() }
  if (total >= 100) return 'global_limited'
  const used = visitors.get(visitor) ?? 0
  if (used >= 3) return 'visitor_limited'
  if (consume) { visitors.set(visitor, used + 1); total++ }
  return 'ok'
}
const quota = {
  check: async visitor => decision(visitor, false),
  consume: async visitor => decision(visitor, true),
}

let occupied = false
let nextEligibleAt = 0
const gate = {
  async acquire(signal, deadlineAt) {
    while (occupied || Date.now() < nextEligibleAt) {
      signal.throwIfAborted()
      if (Date.now() >= deadlineAt) throw new Error('Amazon local gate deadline reached')
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, Math.min(100, Math.max(1, deadlineAt - Date.now())))
        const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
    occupied = true
    nextEligibleAt = Date.now() + 250
    return {
      noteRetryAfter: async retryAt => { nextEligibleAt = Math.max(nextEligibleAt, retryAt) },
      release: async retryAt => {
        nextEligibleAt = Math.max(nextEligibleAt, retryAt ?? 0, Date.now() + 250)
        occupied = false
      },
    }
  },
}

const server = createPreviewServer({
  quota,
  amazonGate: gate,
  amazonState,
  staticDir: './apps/public-web/dist',
  visitorCookieSecret: randomBytes(32).toString('hex'),
  enabled: true,
})
server.listen(port, '127.0.0.1', () => {
  console.log(`English public preview: http://127.0.0.1:${port}/`)
  console.log('Local review only: quota and Amazon coordination reset when this process restarts.')
  if (!amazonState) console.log('Amazon.sg preview is unavailable until W2L_AMAZON_PUBLIC_STATE_FILE is set.')
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())
