// Discover a frozen, unseen Amazon product cohort through W2L's MCP scrape path.
// Discovery is deliberately separate from product evaluation: no failed product
// may be replaced after the manifest has been frozen.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

const marketplaceArg = process.argv.indexOf('--marketplace')
const marketplace = marketplaceArg < 0 ? 'com' : process.argv[marketplaceArg + 1]
if (!['com', 'sg'].includes(marketplace)) throw new Error('--marketplace must be com or sg')
const outputRoot = marketplace === 'com' ? '.w2l/amazon-holdout' : '.w2l/amazon-holdout-sg'
const statePath = '.w2l/amazon-baseline/anonymous-public-state.json'
const manifestPath = marketplace === 'com'
  ? 'research/amazon-product-holdout-100.v1.json'
  : 'research/amazon-product-holdout-100-sg.v1.json'
try {
  await access(manifestPath)
  throw new Error(`holdout manifest already frozen: ${manifestPath}`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const baseline = JSON.parse(await readFile('research/amazon-product-baseline.v1.json', 'utf8'))
const excluded = new Set(baseline.urls.map(url => url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1]).filter(Boolean))
if (marketplace === 'sg') {
  const prior = JSON.parse(await readFile('research/amazon-product-holdout-100.v1.json', 'utf8'))
  for (const url of prior.urls) excluded.add(url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1])
}
const stateSha256 = createHash('sha256').update(await readFile(statePath)).digest('hex')
const seeds = ['electronics', 'home-garden', 'beauty', 'pet-supplies', 'sporting-goods', 'office-products', 'toys-and-games', 'automotive']
  .map(category => `https://www.amazon.${marketplace}/gp/bestsellers/${category}`)

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitForApi(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`API exited during startup: ${child.exitCode}`)
    try { await fetch(baseUrl); return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('benchmark API did not become ready')
}
function productAsin(link) {
  try {
    const url = new URL(link)
    if (!new RegExp(`(^|\\.)amazon\\.${marketplace}$`, 'i').test(url.hostname)) return null
    return url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() ?? null
  } catch { return null }
}
function resultValue(result) {
  const block = result.content?.find(item => item.type === 'text')
  if (!block || typeof block.text !== 'string') throw new Error('MCP response omitted text')
  return JSON.parse(block.text)
}

const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
const api = spawn(process.execPath, ['--import', 'tsx', 'scripts/section-b/amazon-baseline-api.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, W2L_TASK_ROOT: `${outputRoot}/api-state`, W2L_CAPTURE_RAW_DIR: `${outputRoot}/raw`, W2L_AMAZON_PUBLIC_STATE_FILE: statePath, W2L_AMAZON_BASELINE_PORT: String(port), W2L_AMAZON_CONCURRENCY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
api.stderr.on('data', chunk => process.stderr.write(chunk))
const client = new Client({ name: 'w2l-amazon-holdout-discovery', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'packages/mcp/src/stdio.ts', '--base-url', baseUrl],
  cwd: process.cwd(), stderr: 'pipe', maxBufferSize: 64 * 1024 * 1024,
})
transport.stderr?.on('data', chunk => process.stderr.write(chunk))

const captures = []
const bySeed = new Map()
const startedAt = new Date().toISOString()
try {
  await waitForApi(baseUrl, api)
  await client.connect(transport)
  for (const seed of seeds) {
    const began = performance.now()
    let record
    try {
      const result = resultValue(await client.callTool({ name: 'scrape', arguments: { url: seed, mode: 'standard', formats: ['links'] } }))
      const ids = [...new Set((result.links ?? []).map(productAsin).filter(asin => asin && !excluded.has(asin)))]
      bySeed.set(seed, ids)
      record = { seed, finalUrl: result.finalUrl ?? null, status: result.status, blockReason: result.blockReason ?? null, failureReason: result.failureReason ?? null, lane: result.lane ?? null, rawBodySha256: result.snapshot?.rawBodySha256 ?? null, links: result.links?.length ?? 0, unseenAsins: ids.length, clientMs: performance.now() - began }
    } catch (error) {
      record = { seed, status: 'error', error: String(error), clientMs: performance.now() - began }
    }
    captures.push(record)
    console.log(JSON.stringify(record))
    if (record.status !== 'success') break
  }
  // Round-robin across source categories so one category does not dominate.
  const selected = []
  const seen = new Set()
  let index = 0
  while (selected.length < 100 && [...bySeed.values()].some(ids => index < ids.length)) {
    for (const seed of seeds) {
      const asin = bySeed.get(seed)?.[index]
      if (!asin || seen.has(asin)) continue
      seen.add(asin)
      selected.push({ asin, seed, url: `https://www.amazon.${marketplace}/dp/${asin}` })
      if (selected.length === 100) break
    }
    index++
  }
  const endedAt = new Date().toISOString()
  const report = { testKind: 'amazon-holdout-discovery-via-w2l-mcp', startedAt, endedAt,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    anonymousStateSha256: stateSha256, excludedAsins: [...excluded], captures, selected,
    frozen: selected.length === 100 && captures.every(capture => capture.status === 'success'),
  }
  await mkdir(outputRoot, { recursive: true })
  await writeFile(`${outputRoot}/discovery.json`, JSON.stringify(report, null, 2))
  if (report.frozen) {
    const manifest = { ...baseline, version: 2, cohort: `100-unseen-holdout-${marketplace}`, discoverySource: seeds,
      rounds: 1, concurrency: 1, urls: selected.map(item => item.url) }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  }
  console.log(JSON.stringify({ frozen: report.frozen, selected: selected.length, discoveryReport: `${outputRoot}/discovery.json`, manifest: report.frozen ? manifestPath : null }))
  if (!report.frozen) process.exitCode = 1
} finally {
  await client.close().catch(() => {})
  if (api.exitCode === null) {
    const stopped = new Promise(resolve => api.once('exit', resolve))
    api.kill('SIGTERM')
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3_000))])
    if (api.exitCode === null) api.kill('SIGKILL')
  }
}
