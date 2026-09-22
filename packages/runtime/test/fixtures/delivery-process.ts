import { readFileSync } from 'node:fs'
import { hostedNetworkPolicy } from '../../../contracts/src/index.js'
import { DeliveryStore } from '../../src/deliveryStore.js'
import { DeliveryWorker } from '../../src/deliveryWorker.js'

const store = DeliveryStore.open(process.env.DELIVERY_TEST_DB!)
const policy = hostedNetworkPolicy()
policy.privateAllowlist = ['127.0.0.1/32']
const worker = new DeliveryWorker(store, { networkPolicy: policy, ca: readFileSync(process.env.DELIVERY_TEST_CA!), leaseMs: 800, requestTimeoutMs: 600, retryBaseMs: 10 })
try { await worker.processOne() } finally { store.close() }
