#!/usr/bin/env node
/**
 * Frozen 100-product cohort through the *deployed* public HTTPS preview.
 * Raw rendered pages cross the wire only under the owner evaluation token and
 * are saved in the caller's ignored .w2l directory for same-capture review.
 * The default cohort was seen in earlier local experiments. Pass the ignored
 * manifest created by discover-unseen-100.mjs for a new candidate cohort.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHTML } from 'linkedom'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const argument = name => {
  const at = process.argv.indexOf(name)
  return at < 0 ? null : process.argv[at + 1] ?? null
}
const manifestPath = resolve(root, argument('--manifest') ?? 'research/amazon-product-holdout-100-sg.v1.json')
const schemaPath = resolve(root, 'research/amazon-product-schema.v1.json')
const baseUrl = argument('--base-url') ?? process.env.W2L_PREVIEW_BASE_URL
const token = process.env.W2L_EVAL_TOKEN
if (!baseUrl || !token || token.length < 32) throw new Error('Set W2L_PREVIEW_BASE_URL and a 32+ character W2L_EVAL_TOKEN in the local environment; do not put the token on the command line')
const base = new URL(baseUrl)
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Public-path evaluation requires the root of a deployed HTTPS origin')
const previewEndpoint = new URL('/api/preview', base)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (git('status', '--porcelain')) throw new Error('Commit and verify the source before evaluating the final public path')
const commit = git('rev-parse', 'HEAD')
const node = process.version
const npm = execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const manifestBytes = await readFile(manifestPath)
const schemaBytes = await readFile(schemaPath)
const manifest = JSON.parse(manifestBytes.toString('utf8'))
if (!Array.isArray(manifest.urls) || manifest.urls.length !== 100 || new Set(manifest.urls).size !== 100
  || !/^\d{6}$/.test(manifest.expectedPostalCode ?? '')
  || manifest.urls.some(url => !/^https:\/\/www\.amazon\.sg\/dp\/[A-Z0-9]{10}$/.test(url))) {
  throw new Error('Expected the frozen 100 unique Amazon.sg /dp/{ASIN} URLs')
}
const newCohort = manifest.cohort === 'public-preview-unseen-100-sg'
if (newCohort) {
  if (!manifest.discovery?.listingOnly || manifest.discovery.sourceCommit !== commit
    || !manifest.discovery.report || !manifest.discovery.reportSha256) {
    throw new Error('Unseen cohort is missing same-commit listing-only discovery provenance')
  }
  const discoveryBytes = await readFile(resolve(root, manifest.discovery.report))
  if (sha256(discoveryBytes) !== manifest.discovery.reportSha256) throw new Error('Unseen discovery report hash changed')
  const discovery = JSON.parse(discoveryBytes.toString('utf8'))
  if (!discovery.frozen || !discovery.listingOnly || discovery.sourceCommit !== commit
    || discovery.exclusion?.sourcesSha256 !== manifest.discovery.exclusionSourcesSha256
    || discovery.exclusion?.excludedAsinsSha256 !== manifest.discovery.excludedAsinsSha256
    || discovery.stateSha256 !== manifest.discovery.stateSha256
    || JSON.stringify(discovery.selected.map(item => item.url)) !== JSON.stringify(manifest.urls)
    || discovery.selected.some(item => discovery.exclusion.excludedAsins.includes(item.asin))) {
    throw new Error('Unseen manifest does not match its frozen exclusion ledger and listing discovery')
  }
}

const startedAt = new Date().toISOString()
const outputRoot = resolve(argument('--output-dir') ?? join(root, '.w2l/public-preview/final-100', startedAt.replaceAll(':', '-').replaceAll('.', '-')))
const rawDir = join(outputRoot, 'raw')
await mkdir(rawDir, { recursive: true, mode: 0o700 })
await chmod(outputRoot, 0o700)
await chmod(rawDir, 0o700)
const reportPath = join(outputRoot, 'report.json')
const reviewPath = join(outputRoot, 'field-review.md')
const records = manifest.urls.map((url, offset) => ({
  index: offset + 1,
  asin: /\/dp\/([A-Z0-9]{10})$/.exec(url)[1],
  url,
  outcome: { status: 'not_attempted' },
  structured: { status: 'not_attempted', data: null, issues: [] },
  snapshot: { capturedAt: null, rawBodySha256: null, artifacts: [] },
}))
const percentile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}
const source = {
  commit, dirty: false, node, npm, deployedOrigin: base.origin,
  manifest: relative(root, manifestPath), manifestSha256: sha256(manifestBytes),
  schema: 'research/amazon-product-schema.v1.json', schemaFileSha256: sha256(schemaBytes),
  schemaSha256: sha256(JSON.stringify(JSON.parse(schemaBytes.toString('utf8')))),
  anonymousStateSha256: null,
  route: 'HTTPS public page API with owner-only evaluation witness',
  egress: 'deployed Cloud Run egress; actual address not inferred',
  identity: manifest.identity, language: manifest.language,
  cohort: newCohort
    ? 'new 100 URL public-path candidate; unseen relative to frozen exclusion ledger'
    : 'fixed 100 URL public-path regression; previously seen in local evaluation',
}
const report = {
  kind: newCohort ? 'public-preview-amazon-new-100-holdout' : 'public-preview-amazon-fixed-100-regression', startedAt, endedAt: null,
  runStatus: 'in_progress', source, expectedRegion: manifest.expectedRegion,
  expectedCurrencyPreference: manifest.expectedCurrencyPreference,
  expectedPostalCode: manifest.expectedPostalCode,
  summary: null, humanFieldReview: { status: 'pending', note: 'Accuracy, visible-field coverage, and recommendation leakage require independent same-capture raw-HTML review and Howard sign-off.' },
  records,
}
const saveReport = async () => {
  const pendingPath = `${reportPath}.tmp`
  await writeFile(pendingPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  await rename(pendingPath, reportPath)
}
await saveReport()

let provenanceFailure = null
const runBegan = performance.now()
for (const record of records) {
  const requestStarted = performance.now()
  const capturedAt = new Date().toISOString()
  try {
    const response = await fetch(previewEndpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(70_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: record.url }),
    })
    const responseText = await response.text()
    const clientMs = performance.now() - requestStarted
    let payload
    try { payload = JSON.parse(responseText) }
    catch { throw new Error(`non-JSON HTTP ${response.status} response`) }
    const evaluation = payload.evaluation
    if (!evaluation || evaluation.sourceCommit !== commit) {
      provenanceFailure = `deployed source commit ${evaluation?.sourceCommit ?? 'missing'} did not equal local clean commit ${commit}`
      record.error = provenanceFailure
    }
    if (evaluation?.schemaSha256 !== source.schemaSha256) {
      provenanceFailure = `deployed schema SHA256 ${evaluation?.schemaSha256 ?? 'missing'} did not equal frozen schema ${source.schemaSha256}`
      record.error = [record.error, provenanceFailure].filter(Boolean).join('; ')
    }
    if (newCohort && !evaluation?.amazonStateSha256) {
      provenanceFailure = 'deployed Amazon preference state hash is missing'
      record.error = [record.error, provenanceFailure].filter(Boolean).join('; ')
    }
    if (evaluation?.amazonStateSha256) {
      if (source.anonymousStateSha256 && source.anonymousStateSha256 !== evaluation.amazonStateSha256) {
        provenanceFailure = 'anonymous Amazon preference state hash changed during the run'
        record.error = provenanceFailure
      }
      if (newCohort && evaluation.amazonStateSha256 !== manifest.discovery.stateSha256) {
        provenanceFailure = 'deployed Amazon preference state differs from the frozen discovery state'
        record.error = [record.error, provenanceFailure].filter(Boolean).join('; ')
      }
      source.anonymousStateSha256 = evaluation.amazonStateSha256
    }
    const expectedStateHash = process.env.W2L_EXPECT_AMAZON_STATE_SHA256
    if (expectedStateHash && evaluation?.amazonStateSha256 !== expectedStateHash) {
      provenanceFailure = 'deployed Amazon preference state hash differs from expected hash'
      record.error = provenanceFailure
    }
    const raw = evaluation?.rawHtml
    const observedRawHash = typeof raw === 'string' ? sha256(Buffer.from(raw, 'utf8')) : null
    const rawHashVerified = observedRawHash !== null && observedRawHash === evaluation.rawBodySha256
    let artifact = null
    let selectedAsin = null
    if (rawHashVerified) {
      artifact = join(rawDir, `${String(record.index).padStart(3, '0')}-${observedRawHash}.html`)
      await writeFile(artifact, raw, { flag: 'wx', mode: 0o600 })
      const document = parseHTML(raw).document
      selectedAsin = document.querySelector('input[name="ASIN"], #ASIN')?.getAttribute('value')?.trim().toUpperCase() ?? null
    }
    record.capturedAt = capturedAt
    record.httpStatus = response.status
    record.clientMs = clientMs
    record.serverTotalMs = typeof payload.totalMs === 'number' ? payload.totalMs : null
    record.responseBytes = Buffer.byteLength(responseText, 'utf8')
    record.finalUrl = payload.finalUrl ?? null
    record.title = payload.title ?? null
    record.reason = payload.reason ?? null
    record.outcome = { status: payload.status ?? 'malformed', lane: payload.product ? 'browser_local' : null }
    record.structured = { status: payload.product?.status ?? 'missing', data: payload.product?.data ?? null, issues: payload.product?.issues ?? [] }
    record.region = payload.product?.region ?? null
    record.currency = payload.product?.currency ?? null
    record.selectedAsin = selectedAsin
    record.rawHashVerified = rawHashVerified
    record.requestedMatchesSelected = selectedAsin === record.asin
    record.snapshot = { capturedAt, rawBodySha256: observedRawHash, artifacts: artifact ? [artifact] : [] }
    record.fieldEvidence = evaluation?.fieldEvidence ?? []
    record.usage = evaluation?.usage ?? null
    if (!rawHashVerified) record.error = [record.error, 'owner evaluation did not return a hash-matched raw HTML witness'].filter(Boolean).join('; ')
  } catch (error) {
    record.capturedAt = capturedAt
    record.clientMs = performance.now() - requestStarted
    record.outcome = { status: 'request_failed' }
    record.error = error instanceof Error ? error.message : String(error)
  }
  await saveReport()
  process.stdout.write(`${record.index}/100 ${record.asin} ${record.outcome.status} ${Math.round(record.clientMs ?? 0)} ms\n`)
  // Never continue through a different candidate version or preference state.
  if (provenanceFailure) break
}

const attempted = records.filter(row => row.outcome.status !== 'not_attempted')
const times = attempted.map(row => row.clientMs).filter(value => typeof value === 'number')
const totalMs = performance.now() - runBegan
report.endedAt = new Date().toISOString()
report.runStatus = provenanceFailure ? 'invalid_provenance' : attempted.length === 100 ? 'completed' : 'interrupted'
report.summary = {
  denominator: 100, attempted: attempted.length, notAttempted: 100 - attempted.length,
  requestSuccesses: records.filter(row => row.outcome.status === 'success').length,
  structuredComplete: records.filter(row => row.structured.status === 'complete').length,
  requestedMatchesSelectedRaw: records.filter(row => row.requestedMatchesSelected).length,
  emittedAsinMatchesRequested: records.filter(row => row.structured.data?.asin === row.asin).length,
  regionSingapore: records.filter(row => new RegExp(`\\bSingapore[\\s,·-]*${manifest.expectedPostalCode}\\b`, 'i').test(row.region ?? '')).length,
  postcodeVisibleInOutput: records.filter(row => (row.region ?? '').includes(manifest.expectedPostalCode)).length,
  currencySgd: records.filter(row => row.currency === 'SGD').length,
  rawHashesVerified: records.filter(row => row.rawHashVerified).length,
  statusRetryCount: records.reduce((sum, row) => sum + (row.usage?.statusRetryCount ?? 0), 0),
  retryWaitMs: records.reduce((sum, row) => sum + (row.usage?.retryWaitMs ?? 0), 0),
  latencyClientMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95), max: times.length ? Math.max(...times) : null, firstPage: records[0].clientMs ?? null },
  latencyServerMs: { p50: percentile(records.map(row => row.serverTotalMs).filter(value => typeof value === 'number'), 0.5), p95: percentile(records.map(row => row.serverTotalMs).filter(value => typeof value === 'number'), 0.95) },
  responseBytes: { p50: percentile(records.map(row => row.responseBytes).filter(value => typeof value === 'number'), 0.5), p95: percentile(records.map(row => row.responseBytes).filter(value => typeof value === 'number'), 0.95) },
  batchClientMs: totalMs, failure: provenanceFailure,
  serviceCostUsd: null, serviceCostStatus: 'unknown; reconcile with Google Cloud Billing',
}
await saveReport()

const rows = records.map(row => {
  const path = row.snapshot.artifacts[0]
  const relativeRaw = path ? `raw/${path.split('/').at(-1)}` : '—'
  return `| ${row.index} | ${row.asin} | ${row.outcome.status} | ${row.structured.status} | ${row.selectedAsin ?? '—'} | ${row.region ?? '—'} | ${row.currency ?? '—'} | ${path ? `[HTML](${relativeRaw})` : '—'} | 待复核 |`
})
await writeFile(reviewPath, `# 公网页面入口 Amazon.sg 固定 100 URL 复核表\n\n- 采集：${startedAt} 至 ${report.endedAt}\n- 干净源码：${commit}\n- Manifest：${source.manifest}\n- Manifest SHA256：${source.manifestSha256}\n- Schema SHA256：${source.schemaFileSha256}\n- 匿名地区状态 SHA256：${source.anonymousStateSha256 ?? '未取得'}\n- ${newCohort ? '此集合由仅访问榜单页的发现流程冻结；“未见”仅指排除账本中的已有记录，须按同次 HTML 独立复核。' : '此集合在先前本地实验已见过；此轮是公网路径回归，不能称为新的未见商品。'}\n- 自动核验只覆盖传输、同次 HTML 哈希、请求/页面选中 ASIN、结构化状态和地区/币种。价格、标题、卖家等字段准确率与可见字段覆盖率仍须根据本轮每个 HTML 独立人工复核；推荐内容串入亦须复核。失败与未采集行保留在 100 的分母中。\n\n| # | 请求 ASIN | 采集 | JSON | 页面选中 ASIN | 地区 | 币种 | 原始 HTML | 人工真值与串入 |\n|---:|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n复核人：待填写  \n复核日期：待填写  \n结论：待填写\n`, { mode: 0o600 })
process.stdout.write(JSON.stringify({ reportPath, reviewPath, runStatus: report.runStatus, summary: report.summary }, null, 2) + '\n')
if (report.runStatus !== 'completed' || report.summary.requestSuccesses !== 100 || report.summary.structuredComplete !== 100
  || report.summary.requestedMatchesSelectedRaw !== 100 || report.summary.emittedAsinMatchesRequested !== 100
  || report.summary.regionSingapore !== 100 || report.summary.postcodeVisibleInOutput !== 100
  || report.summary.currencySgd !== 100 || report.summary.rawHashesVerified !== 100) {
  process.exitCode = 1
}
