#!/usr/bin/env node
// Freeze a new Amazon.sg cohort using W2L MCP on category LISTING pages only.
// Product detail URLs are collected as links and are never fetched here.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExclusionLedger, isListingUrl, listingSeeds, registeredWorktreeEvidenceDirs, selectUnseenHundred, sha256 } from './unseen-cohort.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const value = name => {
  const at = process.argv.indexOf(name)
  return at < 0 ? null : process.argv[at + 1] ?? null
}
const values = name => process.argv.flatMap((arg, at) => arg === name ? [process.argv[at + 1]] : [])
const statePath = resolve(value('--state-file') ?? process.env.W2L_AMAZON_PUBLIC_STATE_FILE ?? '')
if (!value('--state-file') && !process.env.W2L_AMAZON_PUBLIC_STATE_FILE) throw new Error('Set --state-file or W2L_AMAZON_PUBLIC_STATE_FILE to the fresh anonymous Singapore state')
const when = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const output = resolve(root, value('--output-dir') ?? `.w2l/public-preview/unseen-100-sg/${when}`)
if (!output.startsWith(`${resolve(root, '.w2l')}/`)) throw new Error('--output-dir must be inside ignored .w2l/')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (git('status', '--porcelain')) throw new Error('Freeze a clean source commit before cohort discovery')
const sourceCommit = git('rev-parse', 'HEAD')
const stateBytes = await readFile(statePath)
const stateSha256 = sha256(stateBytes)
const registeredEvidence = (await Promise.all(registeredWorktreeEvidenceDirs(root).map(async dir =>
  await stat(dir).then(() => dir, () => null)))).filter(Boolean)
const ledger = await buildExclusionLedger(root, [...registeredEvidence, ...values('--archive-evidence')])
const oldManifest = JSON.parse(await readFile(resolve(root, 'research/amazon-product-holdout-100-sg.v1.json'), 'utf8'))
await mkdir(output, { recursive: true, mode: 0o700 })
await chmod(output, 0o700)

async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => server.once('error', reject).listen(0, '127.0.0.1', accept))
  const port = server.address().port
  await new Promise(accept => server.close(accept))
  return port
}
async function waitForApi(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`discovery API exited: ${child.exitCode}`)
    try { await fetch(`${baseUrl}/healthz`); return } catch {}
    await new Promise(accept => setTimeout(accept, 100))
  }
  throw new Error('discovery API did not become ready')
}
function resultValue(result) {
  const block = result.content?.find(item => item.type === 'text')
  if (!block || typeof block.text !== 'string') throw new Error('MCP scrape returned no text')
  return JSON.parse(block.text)
}

const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
const api = spawn(process.execPath, ['--import', 'tsx', 'scripts/section-b/amazon-baseline-api.ts'], {
  cwd: root,
  env: { ...process.env, W2L_TASK_ROOT: join(output, 'api-state'),
    W2L_CAPTURE_RAW_DIR: '', W2L_AMAZON_PUBLIC_STATE_FILE: statePath,
    W2L_AMAZON_BASELINE_PORT: String(port), W2L_AMAZON_CONCURRENCY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
api.stderr.on('data', chunk => process.stderr.write(chunk))
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'packages/mcp/src/stdio.ts', '--base-url', baseUrl],
  cwd: root, stderr: 'pipe', maxBufferSize: 64 * 1024 * 1024,
})
transport.stderr?.on('data', chunk => process.stderr.write(chunk))
const client = new Client({ name: 'w2l-public-preview-unseen-discovery', version: '1.0.0' })
const startedAt = new Date().toISOString()
const seedRows = []
try {
  await waitForApi(baseUrl, api)
  await client.connect(transport)
  for (const seed of listingSeeds) {
    const began = performance.now()
    try {
      const scrape = resultValue(await client.callTool({ name: 'scrape', arguments: {
        url: seed, mode: 'standard', formats: ['links'],
      } }))
      const finalUrl = scrape.finalUrl ?? null
      const links = scrape.status === 'success' && isListingUrl(finalUrl)
        ? (scrape.links ?? []).filter(link => typeof link === 'string') : []
      seedRows.push({ seed, finalUrl, status: scrape.status === 'success' && !isListingUrl(finalUrl) ? 'unexpected_final_url' : scrape.status,
        blockReason: scrape.blockReason ?? null, failureReason: scrape.failureReason ?? null,
        links, linksSha256: sha256(Buffer.from(JSON.stringify(links))), clientMs: performance.now() - began })
    } catch (error) {
      seedRows.push({ seed, status: 'error', error: error instanceof Error ? error.message : String(error),
        links: [], clientMs: performance.now() - began })
    }
    process.stdout.write(`${seedRows.length}/${listingSeeds.length} ${seedRows.at(-1).status} ${seed}\n`)
  }
} finally {
  await client.close().catch(() => {})
  if (api.exitCode === null) {
    const stopped = new Promise(accept => api.once('exit', accept))
    api.kill('SIGTERM')
    await Promise.race([stopped, new Promise(accept => setTimeout(accept, 3_000))])
    if (api.exitCode === null) api.kill('SIGKILL')
  }
}
const selected = selectUnseenHundred(seedRows, ledger.excludedAsins)
const discovery = {
  kind: 'amazon-sg-new-cohort-listing-discovery', startedAt, endedAt: new Date().toISOString(),
  sourceCommit, sourceDirty: false, stateSha256, listingOnly: true,
  exclusion: ledger, seeds: seedRows, selected,
  frozen: selected.length === 100 && seedRows.some(row => row.status === 'success'),
  note: 'Unseen means absent from scanned tracked text, local ignored reports, and supplied archived evidence. It does not prove that nobody has ever visited a URL.',
}
const discoveryPath = join(output, 'discovery.json')
const discoveryBytes = Buffer.from(JSON.stringify(discovery, null, 2) + '\n')
await writeFile(discoveryPath, discoveryBytes, { flag: 'wx', mode: 0o600 })
let manifestPath = null
if (discovery.frozen) {
  const manifest = { ...oldManifest, version: 3,
    cohort: 'public-preview-unseen-100-sg', rounds: 1, concurrency: 1,
    discoverySource: [...listingSeeds], urls: selected.map(item => item.url),
    discovery: { sourceCommit, startedAt, report: relative(root, discoveryPath),
      reportSha256: sha256(discoveryBytes), exclusionSourcesSha256: ledger.sourcesSha256,
      excludedAsinsSha256: ledger.excludedAsinsSha256, excludedAsinCount: ledger.excludedAsins.length,
      stateSha256, listingOnly: true },
  }
  manifestPath = join(output, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}
process.stdout.write(JSON.stringify({ frozen: discovery.frozen, selected: selected.length,
  excludedAsins: ledger.excludedAsins.length, discoveryPath, manifestPath }, null, 2) + '\n')
if (!discovery.frozen) process.exitCode = 1
