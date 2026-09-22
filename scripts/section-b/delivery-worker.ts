import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostedNetworkPolicy } from '@w2l/contracts'
import { DeliveryStore } from '../../packages/runtime/src/deliveryStore.js'
import { DeliveryWorker } from '../../packages/runtime/src/deliveryWorker.js'

const args = process.argv.slice(2)
const dbIndex = args.indexOf('--db')
const path = dbIndex === -1 ? join(process.env.W2L_TASK_ROOT ?? '.w2l/api', 'section-b-control.sqlite') : args[dbIndex + 1]
if (!path || (dbIndex !== -1 && path.startsWith('--'))) throw new Error('--db requires a SQLite path')
const store = DeliveryStore.open(path)
const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort(new Error(`delivery worker received ${signal}`)))
const policy = hostedNetworkPolicy()
// Output egress is deliberately independent of W2L crawler network policy.
policy.privateAllowlist = (process.env.W2L_DELIVERY_PRIVATE_ALLOWLIST ?? '').split(',').map(value => value.trim()).filter(Boolean)
const worker = new DeliveryWorker(store, { networkPolicy: policy, proxyUrl: process.env.W2L_DELIVERY_PROXY_URL, ca: process.env.W2L_DELIVERY_CA_FILE ? readFileSync(process.env.W2L_DELIVERY_CA_FILE) : undefined })
console.log(JSON.stringify({ worker: 'delivery', database: path, egress: 'public HTTPS; explicit W2L_DELIVERY_PRIVATE_ALLOWLIST only' }))
try { if (args.includes('--once')) await worker.processOne(controller.signal); else await worker.run(controller.signal) } finally { store.close() }
