import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { compactScrapeResponse } from '@w2l/api'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

const root = process.cwd()
const manifest = JSON.parse(await readFile('research/amazon-product-baseline.v1.json', 'utf8'))
const schema = JSON.parse(await readFile('research/amazon-product-schema.v1.json', 'utf8'))
const schemaSha256 = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
const outputRoot = '.w2l/amazon-baseline'

function percentile(values, ratio) {
  if (values.length === 0) return null
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)]
}

function textResult(result) {
  const block = result.content?.find(item => item.type === 'text')
  if (!block || typeof block.text !== 'string') throw new Error('MCP result omitted text content')
  return { value: JSON.parse(block.text), bytes: Buffer.byteLength(block.text) }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not allocate test port')
  await new Promise(resolve => server.close(resolve))
  return address.port
}

async function waitForApi(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`API exited during startup with ${child.exitCode}`)
    try { await fetch(url); return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('API did not become ready')
}

function stop(child) {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    child.once('exit', resolve)
    child.kill('SIGTERM')
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 3_000).unref()
  })
}

const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
const api = spawn(process.execPath, ['--import', 'tsx', 'packages/api/src/cli.ts', '--port', String(port)], {
  cwd: root, env: { ...process.env, W2L_TASK_ROOT: `${outputRoot}/api-state` }, stdio: ['ignore', 'pipe', 'pipe'],
})
api.stderr.on('data', chunk => process.stderr.write(chunk))

const client = new Client({ name: 'w2l-amazon-baseline', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'packages/mcp/src/stdio.ts', '--base-url', baseUrl],
  cwd: root,
  stderr: 'pipe',
  maxBufferSize: 64 * 1024 * 1024,
})
transport.stderr?.on('data', chunk => process.stderr.write(chunk))

const records = []
let observedRegion = null
const observedCurrencyByAsin = new Map()
const startedAt = new Date().toISOString()

try {
  await waitForApi(baseUrl, api)
  await client.connect(transport)
  const tools = await client.listTools()
  for (let round = 1; round <= manifest.rounds; round++) {
    for (const [index, url] of manifest.urls.entries()) {
      const asin = url.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null
      const began = performance.now()
      let record
      try {
        const called = textResult(await client.callTool({
          name: 'scrape',
          arguments: { url, mode: 'standard', formats: [{ type: 'json', schema, modelFallback: false }] },
        }))
        const result = called.value
        const data = result.json?.data ?? {}
        const region = data.deliveryLocation ?? result.document?.product?.deliveryLocation?.value ?? null
        const currency = data.currency ?? null
        if (round === 1) {
          if (observedRegion === null && region) observedRegion = region
          if (asin && currency) observedCurrencyByAsin.set(asin, currency)
        }
        const regionMismatch = round > 1 && observedRegion !== null && region !== null && region !== observedRegion
        const pinnedCurrency = asin ? observedCurrencyByAsin.get(asin) : null
        const currencyMismatch = round > 1 && pinnedCurrency && currency && pinnedCurrency !== currency
        const comparable = round > 1 && !regionMismatch && !currencyMismatch && observedRegion !== null
        const otherKnownAsins = manifest.urls.map(item => item.slice(-10)).filter(item => item !== asin)
        const serializedData = JSON.stringify(data)
        const evidencePaths = new Set((result.json?.evidence ?? []).map(item => item.path))
        const scoredFields = ['asin', 'title', 'price', 'currency', 'seller']
        record = {
          round, index: index + 1, asin, url, clientMs: performance.now() - began, responseBytes: called.bytes,
          discovery: round === 1, comparable,
          comparisonStatus: round === 1 ? 'region_discovery' : regionMismatch || currencyMismatch ? 'region_mismatch' : observedRegion === null ? 'region_unobserved' : 'comparable',
          region, currency,
          outcome: { status: result.status, lane: result.lane, failureReason: result.failureReason, blockReason: result.blockReason },
          usage: result.usage,
          structured: result.json,
          checks: {
            asinExact: asin !== null && data.asin === asin,
            titlePresent: typeof data.title === 'string' && data.title.trim().length > 0,
            priceCurrencyConsistent: data.price === null || data.price === undefined || typeof data.currency === 'string',
            recommendationAsinLeaks: otherKnownAsins.filter(item => serializedData.includes(item)),
            evidenceBackedFields: Object.fromEntries(scoredFields.map(field => [field, data[field] === null || data[field] === undefined || evidencePaths.has(`/${field}`)])),
          },
        }
      } catch (error) {
        record = { round, index: index + 1, asin, url, clientMs: performance.now() - began, responseBytes: 0, discovery: round === 1, comparable: false, comparisonStatus: 'request_error', error: String(error) }
      }
      records.push(record)
      console.log(JSON.stringify({ round, index: index + 1, asin, status: record.outcome?.status ?? 'error', comparisonStatus: record.comparisonStatus, clientMs: Math.round(record.clientMs) }))
    }
  }

  const sampleUrl = manifest.urls[0]
  const compact = textResult(await client.callTool({ name: 'scrape', arguments: { url: sampleUrl, mode: 'standard', formats: ['markdown'], debug: false } }))
  const debug = textResult(await client.callTool({ name: 'scrape', arguments: { url: sampleUrl, mode: 'standard', formats: ['markdown'], debug: true } }))
  const sameCaptureCompact = compactScrapeResponse(debug.value, { url: sampleUrl, mode: 'standard', formats: ['markdown'], debug: false })
  const sameCaptureCompactBytes = Buffer.byteLength(JSON.stringify(sameCaptureCompact))
  const responseSize = {
    url: sampleUrl,
    actualCompactBytes: compact.bytes,
    sameCaptureCompactBytes,
    debugBytes: debug.bytes,
    ratio: sameCaptureCompactBytes / debug.bytes,
    nestedBodyAbsent: compact.value.summary === undefined && compact.value.trace === undefined && compact.value.ladderTrace === undefined,
    passed: sameCaptureCompactBytes <= debug.bytes * 0.6 && compact.value.summary === undefined,
  }

  const comparable = records.filter(record => record.comparable)
  const successful = comparable.filter(record => record.outcome?.status === 'success')
  const timingNames = ['queueMs', 'robotsMs', 'cooldownWaitMs', 'transportMs', 'retryWaitMs', 'extractMs', 'formatMs', 'modelMs', 'totalMs']
  const stageTimings = Object.fromEntries(timingNames.map(name => {
    const values = comparable.map(record => record.usage?.timings?.[name]).filter(Number.isFinite)
    return [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95), total: values.reduce((sum, value) => sum + value, 0) }]
  }))
  const report = {
    testKind: 'real-amazon-json-via-w2l-stdio-mcp', startedAt, endedAt: new Date().toISOString(),
    source: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      schemaSha256,
      manifest: 'research/amazon-product-baseline.v1.json',
      schema: 'research/amazon-product-schema.v1.json',
    },
    mcp: { server: client.getServerVersion(), tools: tools.tools.map(tool => tool.name) },
    region: { policy: manifest.regionPolicy, observedRegion, observedCurrencyByAsin: Object.fromEntries(observedCurrencyByAsin) },
    summary: {
      discoveryRecords: records.filter(record => record.discovery).length,
      comparableRecords: comparable.length,
      regionMismatchRecords: records.filter(record => record.comparisonStatus === 'region_mismatch').length,
      successes: successful.length,
      blocked: comparable.filter(record => record.outcome?.status === 'blocked').length,
      failed: comparable.filter(record => record.outcome?.status === 'failed' || record.error).length,
      clientMs: { p50: percentile(comparable.map(record => record.clientMs), 0.5), p95: percentile(comparable.map(record => record.clientMs), 0.95), total: comparable.reduce((sum, record) => sum + record.clientMs, 0) },
      totalMs: { p50: percentile(comparable.map(record => record.usage?.totalMs).filter(Number.isFinite), 0.5), p95: percentile(comparable.map(record => record.usage?.totalMs).filter(Number.isFinite), 0.95) },
      stageTimings,
      attempts: { total: comparable.reduce((sum, record) => sum + (record.usage?.attemptCount ?? 0), 0), retriedRecords: comparable.filter(record => (record.usage?.attemptCount ?? 0) > 1).length },
      responseBytes: { p50: percentile(comparable.map(record => record.responseBytes), 0.5), p95: percentile(comparable.map(record => record.responseBytes), 0.95), total: comparable.reduce((sum, record) => sum + record.responseBytes, 0) },
      checks: {
        asinExact: successful.filter(record => record.checks.asinExact).length,
        titlePresent: successful.filter(record => record.checks.titlePresent).length,
        priceCurrencyConsistent: successful.filter(record => record.checks.priceCurrencyConsistent).length,
        recommendationLeakFree: successful.filter(record => record.checks.recommendationAsinLeaks.length === 0).length,
        evidenceBacked: successful.filter(record => Object.values(record.checks.evidenceBackedFields).every(Boolean)).length,
        coverage: Object.fromEntries(['asin', 'title', 'price', 'currency', 'seller'].map(field => [field, successful.filter(record => record.structured?.data?.[field] !== null && record.structured?.data?.[field] !== undefined).length])),
        denominator: successful.length,
      },
    },
    responseSize,
    records,
  }
  await mkdir(outputRoot, { recursive: true })
  const stamp = report.endedAt.replace(/[:.]/g, '-')
  const jsonPath = `${outputRoot}/${stamp}.json`
  const markdownPath = `${outputRoot}/${stamp}.md`
  const markdown = `# Amazon product baseline\n\n- Started: ${report.startedAt}\n- Ended: ${report.endedAt}\n- Commit: ${report.source.commit}${report.source.dirty ? ' (dirty working tree)' : ''}\n- Node/npm: ${report.source.node} / ${report.source.npm}\n- Schema SHA256: ${schemaSha256}\n- Region: ${observedRegion ?? 'unobserved'}\n- Comparable records: ${report.summary.comparableRecords}/${records.length} (round 1 is discovery-only)\n- Success/blocked/failed: ${report.summary.successes}/${report.summary.blocked}/${report.summary.failed}\n- Client p50/p95: ${Math.round(report.summary.clientMs.p50 ?? 0)} / ${Math.round(report.summary.clientMs.p95 ?? 0)} ms\n- End-to-end p50/p95: ${Math.round(report.summary.totalMs.p50 ?? 0)} / ${Math.round(report.summary.totalMs.p95 ?? 0)} ms\n- Transport p50/p95: ${Math.round(report.summary.stageTimings.transportMs.p50 ?? 0)} / ${Math.round(report.summary.stageTimings.transportMs.p95 ?? 0)} ms\n- Extract p50/p95: ${Math.round(report.summary.stageTimings.extractMs.p50 ?? 0)} / ${Math.round(report.summary.stageTimings.extractMs.p95 ?? 0)} ms\n- ASIN exact: ${report.summary.checks.asinExact}/${report.summary.checks.denominator}\n- Title present: ${report.summary.checks.titlePresent}/${report.summary.checks.denominator}\n- Evidence-backed scored fields: ${report.summary.checks.evidenceBacked}/${report.summary.checks.denominator}\n- Recommendation ASIN leak-free: ${report.summary.checks.recommendationLeakFree}/${report.summary.checks.denominator}\n- Same-capture compact/debug bytes: ${responseSize.sameCaptureCompactBytes}/${responseSize.debugBytes} (${(responseSize.ratio * 100).toFixed(2)}%, ${responseSize.passed ? 'PASS' : 'FAIL'})\n\nThe first round pins the observed delivery region and per-ASIN currency context. Region-unobserved or mismatched records are retained as evidence but excluded from latency and field conclusions. Raw values, stage timings, retries, response sizes, issues and field evidence are in the JSON report.\n`
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(report, null, 2)), writeFile(`${outputRoot}/latest.json`, JSON.stringify(report, null, 2)),
    writeFile(markdownPath, markdown), writeFile(`${outputRoot}/latest.md`, markdown),
  ])
  console.log(JSON.stringify({ passed: report.summary.failed === 0 && responseSize.passed && report.summary.checks.asinExact === report.summary.checks.denominator && report.summary.checks.evidenceBacked === report.summary.checks.denominator, jsonPath, markdownPath, summary: report.summary, responseSize }, null, 2))
} finally {
  await client.close().catch(() => {})
  await stop(api)
}
