/** Real 10-URL W2L batch comparison. Run 1 and 2; run 4 only if comparable. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createApp, createApiEngine } from '@w2l/api'
import { localNetworkPolicy } from '@w2l/contracts'
import { W2L } from '@w2l/sdk'

const manifest = JSON.parse(await readFile('research/amazon-product-baseline.v1.json', 'utf8'))
const schema = JSON.parse(await readFile('research/amazon-product-schema.v1.json', 'utf8'))
const schemaSha256 = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
const startedAt = new Date().toISOString()
const taskRoot = '.w2l/amazon-concurrency'
const observedCurrency = new Map()
let observedRegion = null

async function arm(concurrency) {
  const engine = createApiEngine({
    taskRoot: `${taskRoot}/arm-${concurrency}`,
    workerCount: 4,
    networkPolicy: { ...localNetworkPolicy(), perHostConcurrency: concurrency, perHostMinDelayMs: 250 },
  })
  const app = createApp(engine)
  const client = new W2L({ baseUrl: 'http://w2l.test', fetch: (input, init) => app.request(String(input), init) })
  const began = performance.now()
  let taskId = null
  try {
    taskId = (await client.batchScrape(manifest.urls, { formats: [{ type: 'json', schema, modelFallback: false }] })).taskId
    const signal = AbortSignal.timeout(180_000)
    const report = await client.waitBatch(taskId, { signal })
    const detail = await engine.getCrawlWithSteps(taskId)
    const steps = detail?.steps ?? []
    const byAsin = new Map(steps.map(step => [step.url.match(/\/dp\/([A-Z0-9]{10})/)?.[1], step]))
    const records = manifest.urls.map(url => {
      const asin = url.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null
      const step = byAsin.get(asin)
      const result = step?.result
      const data = result?.json?.data ?? {}
      const region = data.deliveryLocation ?? result?.document?.product?.deliveryLocation?.value ?? null
      const currency = data.currency ?? null
      if (concurrency === 1) {
        if (observedRegion === null && region) observedRegion = region
        if (asin && currency) observedCurrency.set(asin, currency)
      }
      const baselineCurrency = observedCurrency.get(asin)
      const comparisonStatus = region === null || observedRegion === null ? 'region_unobserved'
        : region !== observedRegion || (baselineCurrency && currency && baselineCurrency !== currency) ? 'region_mismatch'
          : 'comparable'
      return {
        asin, url, status: result?.status ?? 'missing', lane: result?.lane ?? null,
        failureReason: result?.failureReason ?? null, blockReason: result?.blockReason ?? null,
        httpStatus: result?.evidence?.httpStatus ?? null,
        cacheEvidence: {
          observed: result?.evidence?.cacheControl !== undefined,
          cacheControl: result?.evidence?.cacheControl ?? null,
          etag: result?.evidence?.etag ?? null,
          lastModified: result?.evidence?.lastModified ?? null,
          setsCookie: result?.evidence?.setsCookie ?? null,
        },
        region, currency, comparisonStatus,
        wallMs: result?.usage?.wallMs ?? null,
        attemptCount: result?.usage?.attemptCount ?? null,
        jsonStatus: result?.json?.status ?? null,
        asinExact: data.asin === asin,
      }
    })
    return {
      concurrency, taskId, clientTotalMs: performance.now() - began,
      taskStatus: report.status, requested: report.requested, completed: report.completed,
      successes: records.filter(row => row.status === 'success').length,
      comparable: records.filter(row => row.comparisonStatus === 'comparable').length,
      regionUnobserved: records.filter(row => row.comparisonStatus === 'region_unobserved').length,
      regionMismatch: records.filter(row => row.comparisonStatus === 'region_mismatch').length,
      records,
    }
  } catch (error) {
    if (taskId) await client.cancelBatch(taskId).catch(() => {})
    return { concurrency, taskId, clientTotalMs: performance.now() - began, error: String(error), records: [] }
  } finally { await engine.close({ cancelActive: true }) }
}

const one = await arm(1)
console.log(JSON.stringify({ concurrency: 1, status: one.taskStatus ?? 'error', successes: one.successes, region: observedRegion, clientTotalMs: Math.round(one.clientTotalMs) }))
const two = await arm(2)
const baselineLaneByAsin = new Map(one.records.map(record => [record.asin, record.lane]))
for (const record of two.records) {
  if (record.comparisonStatus === 'comparable' && record.lane !== baselineLaneByAsin.get(record.asin)) record.comparisonStatus = 'route_mismatch'
}
two.routeMismatch = two.records.filter(record => record.comparisonStatus === 'route_mismatch').length
two.comparable = two.records.filter(record => record.comparisonStatus === 'comparable').length
console.log(JSON.stringify({ concurrency: 2, status: two.taskStatus ?? 'error', successes: two.successes, comparable: two.comparable, clientTotalMs: Math.round(two.clientTotalMs) }))
const arms = [one, two]
const fullyComparable = arms.every(arm => arm.taskStatus === 'completed' && arm.successes === manifest.urls.length && arm.comparable === manifest.urls.length)
if (fullyComparable) {
  const four = await arm(4)
  for (const record of four.records) {
    if (record.comparisonStatus === 'comparable' && record.lane !== baselineLaneByAsin.get(record.asin)) record.comparisonStatus = 'route_mismatch'
  }
  four.routeMismatch = four.records.filter(record => record.comparisonStatus === 'route_mismatch').length
  four.comparable = four.records.filter(record => record.comparisonStatus === 'comparable').length
  arms.push(four)
  console.log(JSON.stringify({ concurrency: 4, status: four.taskStatus ?? 'error', successes: four.successes, comparable: four.comparable, clientTotalMs: Math.round(four.clientTotalMs) }))
}
const evidence = {
  kind: 'real-amazon-batch-via-w2l', startedAt, endedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  node: process.version,
  schemaSha256,
  manifest: 'research/amazon-product-baseline.v1.json',
  observedRegion,
  observedCurrencyByAsin: Object.fromEntries(observedCurrency),
  arm4Decision: fullyComparable ? 'run' : 'withheld: arm 1/2 failed or at least one URL lacked comparable region/currency/route context',
  arms,
}
await mkdir('docs/evidence', { recursive: true })
await writeFile('docs/evidence/amazon-batch-concurrency.json', JSON.stringify(evidence, null, 2) + '\n')
console.log(`wrote docs/evidence/amazon-batch-concurrency.json; 4=${evidence.arm4Decision}`)
