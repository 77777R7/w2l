import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { compactScrapeResponse } from '@w2l/api'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

const root = process.cwd()
const manifestFlag = process.argv.indexOf('--manifest')
const manifestPath = manifestFlag >= 0 ? process.argv[manifestFlag + 1] : 'research/amazon-product-baseline.v1.json'
if (!manifestPath) throw new Error('--manifest requires a JSON path')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const schema = JSON.parse(await readFile('research/amazon-product-schema.v1.json', 'utf8'))
const schemaSha256 = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
const manifestSha256 = createHash('sha256').update(await readFile(manifestPath)).digest('hex')
const publicStatePath = '.w2l/amazon-baseline/anonymous-public-state.json'
const publicState = await readFile(publicStatePath)
const stateSha256 = createHash('sha256').update(publicState).digest('hex')
const parsedState = JSON.parse(publicState.toString())
if (!parsedState.cookies?.some(cookie => cookie.name === 'i18n-prefs' && cookie.value === manifest.expectedCurrencyPreference)) {
  throw new Error('anonymous public state does not retain the expected currency preference')
}
const roundsFlag = process.argv.indexOf('--rounds')
const rounds = roundsFlag >= 0 ? Number(process.argv[roundsFlag + 1]) : manifest.rounds
const concurrencyFlag = process.argv.indexOf('--concurrency')
const concurrency = concurrencyFlag >= 0 ? Number(process.argv[concurrencyFlag + 1]) : manifest.concurrency
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')
if (![1, 2, 4].includes(concurrency)) throw new Error('--concurrency must be 1, 2, or 4')
if (typeof manifest.expectedRegion !== 'string' || manifest.expectedRegion.trim().length === 0) throw new Error('manifest.expectedRegion is required')
if (typeof manifest.egressLabel !== 'string' || manifest.egressLabel.trim().length === 0) throw new Error('manifest.egressLabel is required')
const outputRoot = '.w2l/amazon-baseline'

function percentile(values, ratio) {
  if (values.length === 0) return null
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)]
}

function usableRegion(value) {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0 || /^(update|select|choose|change)\s+(your\s+)?location$/i.test(normalized)) return null
  return normalized.replace(/[\u200c\u200d\u200e\u200f]/g, '')
}
function regionCountry(location) {
  if (location === null) return null
  return /^Singapore(?:\s|$)/i.test(location) ? 'Singapore' : location
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
const api = spawn(process.execPath, ['--import', 'tsx', 'scripts/section-b/amazon-baseline-api.ts'], {
  cwd: root, env: { ...process.env, W2L_TASK_ROOT: `${outputRoot}/api-state-${concurrency}`, W2L_CAPTURE_RAW_DIR: `${outputRoot}/raw`, W2L_AMAZON_PUBLIC_STATE_FILE: publicStatePath, W2L_AMAZON_BASELINE_PORT: String(port), W2L_AMAZON_CONCURRENCY: String(concurrency) }, stdio: ['ignore', 'pipe', 'pipe'],
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
const roundDurations = []
let stoppedForGate = false
let observedRegion = null
const observedCurrencyByAsin = new Map()
const startedAt = new Date().toISOString()

try {
  await waitForApi(baseUrl, api)
  await client.connect(transport)
  const tools = await client.listTools()
  for (let round = 1; round <= rounds; round++) {
    const roundStart = performance.now()
    let nextIndex = 0
    if (stoppedForGate) {
      for (const [index, url] of manifest.urls.entries()) records.push({
        round, index: index + 1, asin: url.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null, url,
        clientMs: null, responseBytes: 0, discovery: round === 1, comparable: false,
        comparisonStatus: 'halted_after_gate', outcome: { status: 'not_attempted' },
      })
      roundDurations.push(0)
      continue
    }
    const runOne = async (index) => {
      const url = manifest.urls[index]
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
        const locationText = usableRegion(data.deliveryLocation ?? result.document?.product?.deliveryLocation?.value ?? null)
        const region = regionCountry(locationText)
        const currency = data.currency ?? null
        if (round === 1) {
          if (observedRegion === null && region) observedRegion = region
          if (asin) observedCurrencyByAsin.set(asin, currency)
        }
        const regionMismatch = region !== null && region !== manifest.expectedRegion
        const pinnedCurrency = asin ? observedCurrencyByAsin.get(asin) : null
        const currencyMismatch = round > 1 && pinnedCurrency !== currency
        const comparable = round > 1 && region === manifest.expectedRegion && !currencyMismatch && result.status === 'success'
        const otherKnownAsins = manifest.urls.map(item => item.slice(-10)).filter(item => item !== asin)
        const serializedData = JSON.stringify(data)
        const evidencePaths = new Set((result.json?.evidence ?? []).map(item => item.path))
        const scoredFields = ['asin', 'title', 'price', 'currency', 'seller']
        record = {
          round, index: index + 1, asin, url, finalUrl: result.finalUrl, clientMs: performance.now() - began, responseBytes: called.bytes,
          discovery: round === 1, comparable,
          comparisonStatus: round === 1 ? region === null ? 'region_unobserved' : regionMismatch ? 'region_mismatch' : 'region_discovery' : regionMismatch ? 'region_mismatch' : currencyMismatch ? 'currency_mismatch' : region === null ? 'region_unobserved' : result.status !== 'success' ? 'capture_failed' : 'comparable',
          region, locationText, currency,
          outcome: { status: result.status, lane: result.lane, failureReason: result.failureReason, blockReason: result.blockReason },
          snapshot: { capturedAt: new Date().toISOString(), rawBodySha256: result.snapshot?.rawBodySha256 ?? null, artifacts: result.snapshot?.artifacts ?? [], httpStatus: result.snapshot?.httpStatus ?? null },
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
      if (record.outcome?.status === 'blocked') stoppedForGate = true
      console.log(JSON.stringify({ round, index: index + 1, asin, status: record.outcome?.status ?? 'error', comparisonStatus: record.comparisonStatus, clientMs: Math.round(record.clientMs) }))
    }
    const workers = Array.from({ length: Math.min(concurrency, manifest.urls.length) }, async () => {
      for (;;) {
        if (stoppedForGate) return
        const index = nextIndex++
        if (index >= manifest.urls.length) return
        await runOne(index)
      }
    })
    await Promise.all(workers)
    for (let index = nextIndex; index < manifest.urls.length; index++) {
      const url = manifest.urls[index]
      records.push({
        round, index: index + 1, asin: url.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null, url,
        clientMs: null, responseBytes: 0, discovery: round === 1, comparable: false,
        comparisonStatus: 'halted_after_gate', outcome: { status: 'not_attempted' },
      })
    }
    roundDurations.push(performance.now() - roundStart)
  }

  let responseSize = { passed: false, notTestedReason: 'a gate interrupted the real product capture' }
  if (!stoppedForGate && records.some(record => record.outcome?.status === 'success')) {
    const sampleUrl = manifest.urls[0]
    const compact = textResult(await client.callTool({ name: 'scrape', arguments: { url: sampleUrl, mode: 'standard', formats: ['markdown'], debug: false } }))
    const debug = textResult(await client.callTool({ name: 'scrape', arguments: { url: sampleUrl, mode: 'standard', formats: ['markdown'], debug: true } }))
    const sameCaptureCompact = compactScrapeResponse(debug.value, { url: sampleUrl, mode: 'standard', formats: ['markdown'], debug: false })
    const sameCaptureCompactBytes = Buffer.byteLength(JSON.stringify(sameCaptureCompact))
    responseSize = {
      url: sampleUrl,
      actualCompactBytes: compact.bytes,
      sameCaptureCompactBytes,
      debugBytes: debug.bytes,
      ratio: sameCaptureCompactBytes / debug.bytes,
      nestedBodyAbsent: compact.value.summary === undefined && compact.value.trace === undefined && compact.value.ladderTrace === undefined,
      passed: debug.value.status === 'success' && compact.value.status === 'success'
        && sameCaptureCompactBytes <= debug.bytes * 0.6 && compact.value.summary === undefined,
    }
  }

  const comparable = records.filter(record => record.comparable)
  const assessment = records.filter(record => record.round > 1)
  const attemptedAssessment = assessment.filter(record => record.outcome?.status !== 'not_attempted')
  const successful = comparable.filter(record => record.outcome?.status === 'success')
  const discovery = records.filter(record => record.discovery)
  const discoverySuccessful = discovery.filter(record => record.outcome?.status === 'success')
  const perRoundClientMs = roundDurations
  const timingNames = ['queueMs', 'robotsMs', 'retryWaitMs', 'requestMs', 'bodyReadMs', 'parseMs', 'extractMs', 'serializeMs', 'totalMs']
  const stageTimings = Object.fromEntries(timingNames.map(name => {
    const values = attemptedAssessment.map(record => record.usage?.timings?.[name]).filter(Number.isFinite)
    return [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95), total: values.reduce((sum, value) => sum + value, 0) }]
  }))
  const report = {
    testKind: 'real-amazon-json-via-w2l-stdio-mcp', startedAt, endedAt: new Date().toISOString(),
    source: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      manifest: manifestPath,
      manifestSha256,
      schema: 'research/amazon-product-schema.v1.json',
      schemaSha256,
      anonymousStateSha256: stateSha256,
      anonymousStateFile: publicStatePath,
      baselineLane: 'browser_local_only',
      concurrency,
      egressLabel: manifest.egressLabel,
      identity: manifest.identity ?? null,
      language: manifest.language ?? null,
    },
    mcp: { server: client.getServerVersion(), tools: tools.tools.map(tool => tool.name) },
    region: { policy: manifest.regionPolicy, expectedRegion: manifest.expectedRegion, expectedCurrencyPreference: manifest.expectedCurrencyPreference, observedRegion, observedCurrencyByAsin: Object.fromEntries(observedCurrencyByAsin) },
    summary: {
      discoveryRecords: records.filter(record => record.discovery).length,
      discoverySuccesses: discoverySuccessful.length,
      comparableRecords: comparable.length,
      regionMismatchRecords: records.filter(record => record.comparisonStatus === 'region_mismatch').length,
      currencyMismatchRecords: records.filter(record => record.comparisonStatus === 'currency_mismatch').length,
      successes: successful.length,
      blocked: records.filter(record => record.outcome?.status === 'blocked').length,
      failed: records.filter(record => record.outcome?.status === 'failed' || record.error).length,
      notAttempted: records.filter(record => record.outcome?.status === 'not_attempted').length,
      clientMs: { p50: percentile(attemptedAssessment.map(record => record.clientMs), 0.5), p95: percentile(attemptedAssessment.map(record => record.clientMs), 0.95), total: attemptedAssessment.reduce((sum, record) => sum + record.clientMs, 0) },
      tenPageRunMs: { values: perRoundClientMs, median: stoppedForGate ? null : percentile(perRoundClientMs, 0.5), targetMs: 20_000, passed: rounds >= 3 && !stoppedForGate && percentile(perRoundClientMs, 0.5) <= 20_000 },
      totalMs: { p50: percentile(attemptedAssessment.map(record => record.usage?.totalMs).filter(Number.isFinite), 0.5), p95: percentile(attemptedAssessment.map(record => record.usage?.totalMs).filter(Number.isFinite), 0.95) },
      stageTimings,
      attempts: { total: records.reduce((sum, record) => sum + (record.usage?.attemptCount ?? 0), 0), retriedRecords: records.filter(record => (record.usage?.attemptCount ?? 0) > 1).length },
      responseBytes: { p50: percentile(attemptedAssessment.map(record => record.responseBytes), 0.5), p95: percentile(attemptedAssessment.map(record => record.responseBytes), 0.95), total: attemptedAssessment.reduce((sum, record) => sum + record.responseBytes, 0) },
      checks: {
        asinExact: successful.filter(record => record.checks.asinExact).length,
        titlePresent: successful.filter(record => record.checks.titlePresent).length,
        priceCurrencyConsistent: successful.filter(record => record.checks.priceCurrencyConsistent).length,
        recommendationLeakFree: successful.filter(record => record.checks.recommendationAsinLeaks.length === 0).length,
        evidenceBacked: successful.filter(record => Object.values(record.checks.evidenceBackedFields).every(Boolean)).length,
        coverage: Object.fromEntries(['asin', 'title', 'price', 'currency', 'seller'].map(field => [field, successful.filter(record => {
          const value = record.structured?.data?.[field]
          return value !== null && value !== undefined
        }).length])),
        denominator: successful.length,
      },
    },
    responseSize,
    acceptance: {
      automatedPassed: rounds >= 3
        && discoverySuccessful.length === manifest.urls.length
        && comparable.length === manifest.urls.length * (rounds - 1)
        && !stoppedForGate
        && successful.length === comparable.length
        && successful.every(record => record.checks.asinExact && record.checks.titlePresent && record.checks.recommendationAsinLeaks.length === 0)
        && successful.every(record => record.structured?.status === 'complete')
        && responseSize.passed
        && percentile(perRoundClientMs, 0.5) <= 20_000,
      promotionEligible: false,
      reason: 'promotion also requires reviewed field labels; this runner does not self-certify manual 98% accuracy',
    },
    records,
  }
  await mkdir(outputRoot, { recursive: true })
  const stamp = report.endedAt.replace(/[:.]/g, '-')
  const jsonPath = `${outputRoot}/${stamp}.json`
  const markdownPath = `${outputRoot}/${stamp}.md`
  const markdown = `# Amazon product baseline\n\n- Started: ${report.startedAt}\n- Ended: ${report.endedAt}\n- Clean source commit: ${report.source.commit}${report.source.dirty ? ' (dirty exploratory run)' : ''}\n- Node/npm: ${report.source.node} / ${report.source.npm}\n- Schema/manifest/state SHA256: ${schemaSha256} / ${manifestSha256} / ${stateSha256}\n- Route: stdio MCP → local API → anonymous public browser; concurrency ${concurrency}\n- Region: ${observedRegion ?? 'unobserved'}; expected ${manifest.expectedRegion}\n- Comparable later-round records: ${report.summary.comparableRecords}/${manifest.urls.length * (rounds - 1)}\n- Success/blocked/failed/not attempted: ${report.summary.successes}/${report.summary.blocked}/${report.summary.failed}/${report.summary.notAttempted}\n- Client p50/p95 including attempted failures: ${report.summary.clientMs.p50 ?? 'unavailable'} / ${report.summary.clientMs.p95 ?? 'unavailable'} ms\n- 10-page round wall times: ${report.summary.tenPageRunMs.values.map(value => Math.round(value)).join(' / ')} ms; target median ≤${report.summary.tenPageRunMs.targetMs} ms (${report.summary.tenPageRunMs.passed ? 'PASS' : 'FAIL'})\n- Same-capture compact/debug: ${responseSize.passed ? `${responseSize.sameCaptureCompactBytes}/${responseSize.debugBytes} bytes (${(responseSize.ratio * 100).toFixed(2)}%)` : 'not passed or not tested'}\n\nThe raw JSON retains every fixed URL, including blocked and unattempted records. Latency includes attempted failures and retry time. Field acceptance requires independent HTML-based truth and Howard's signature; this runner never self-certifies the 98% field gate.\n`
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(report, null, 2)), writeFile(`${outputRoot}/latest.json`, JSON.stringify(report, null, 2)),
    writeFile(markdownPath, markdown), writeFile(`${outputRoot}/latest.md`, markdown),
  ])
  console.log(JSON.stringify({ passed: report.acceptance.automatedPassed, promotionEligible: report.acceptance.promotionEligible, jsonPath, markdownPath, summary: report.summary, responseSize, acceptance: report.acceptance }, null, 2))
  if (!report.acceptance.automatedPassed) process.exitCode = 1
} finally {
  await client.close().catch(() => {})
  await stop(api)
}
