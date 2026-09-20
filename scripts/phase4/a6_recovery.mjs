import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTENTFUL_STATUS } from '../../packages/contracts/src/status.js'
import { SqliteTaskStore } from '../../packages/runtime/src/index.ts'
import { evaluateAssertions } from '../../packages/bench/src/phase4RealTask.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'research/phase4_a6_real_tasks.json'), 'utf8'))
const tasks = manifest.tasks
const hosts = [...new Set(tasks.map((task) => new URL(task.url).hostname))]
const taskDir = join(root, 'output/phase4/a6-recovery-task')
const killAfterPages = Number(process.env.W2L_A6_RECOVERY_KILL_AFTER ?? 8)
const maxPages = tasks.length + 1

function canonicalize(url) {
  const parsed = new URL(url)
  parsed.hash = ''
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1)
  return parsed.href
}

function listingHtml() {
  const links = tasks.map((task) => `<li><a href="${task.url}">${task.id}</a></li>`).join('')
  return `<!doctype html><html><head><title>A6 recovery seed</title></head><body><main><h1>A6 recovery seed</h1><p>Synthetic listing of the A6 URL set.</p><ul>${links}</ul></main></body></html>`
}

function startSeedServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/' || req.url === '/listing') {
        const body = listingHtml()
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(body)
        return
      }
      res.writeHead(404).end('not found')
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: `http://127.0.0.1:${address.port}/listing` })
    })
  })
}

function spawnCrawl(args) {
  const child = spawn('node', ['--import', 'tsx', 'packages/bench/src/w2lCli.ts', 'crawl', ...args], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, done }
}

async function snapshot(dir) {
  const store = SqliteTaskStore.openReadOnly(dir)
  try {
    const listed = await store.listTasks()
    const task = listed[listed.length - 1]
    if (task === undefined) return { taskId: null, attempts: [], steps: [] }
    const attempts = await store.listAttempts(task.id)
    const steps = await store.listSteps(task.id)
    return {
      taskId: task.id,
      attempts: attempts.map((attempt) => ({ id: attempt.id, status: attempt.status, pagesFetched: attempt.pagesFetched, costUsd: attempt.costUsd, costUnknown: attempt.costUnknown })),
      steps: steps.map((step) => ({
        id: step.id,
        attemptId: step.attemptId,
        url: step.url,
        canonicalUrl: step.canonicalUrl,
        status: step.status,
        lane: step.lane,
        cached: step.cached,
        contentHash: step.contentHash,
        markdown: step.result?.markdown ?? null,
        result: step.result,
      })),
    }
  } finally {
    await store.close()
  }
}

function waitForSteps(dir, minPages, timeoutMs) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const snap = await snapshot(dir)
        const contentful = snap.steps.filter((step) => step.status === 'success' || step.status === 'partial')
        if (contentful.length >= minPages) {
          resolve(snap)
          return
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out waiting for ${minPages} checkpointed pages; saw ${contentful.length}`))
          return
        }
        setTimeout(() => { void tick() }, 400)
      } catch {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out waiting for checkpoint sqlite`))
          return
        }
        setTimeout(() => { void tick() }, 400)
      }
    }
    void tick()
  })
}

function scoreSteps(steps) {
  const latest = new Map()
  for (const step of steps) latest.set(canonicalize(step.canonicalUrl || step.url), step)
  const recovered = []
  const seenCanon = new Set()
  for (const task of tasks) {
    const canon = canonicalize(task.url)
    if (seenCanon.has(canon)) {
      recovered.push({ taskId: task.id, url: task.url, evaluationSet: task.evaluationSet, cached: true, lane: latest.get(canon)?.lane ?? null, status: latest.get(canon)?.status ?? 'missing', outcome: latest.get(canon)?.result && CONTENTFUL_STATUS.has(latest.get(canon).result.status) ? 'correct_complete' : 'partial_missing_fields', aliasOf: canon })
      continue
    }
    seenCanon.add(canon)
    const step = latest.get(canon)
    if (step === undefined || step.result == null) {
      recovered.push({ taskId: task.id, url: task.url, evaluationSet: task.evaluationSet, cached: false, lane: step?.lane ?? null, status: step?.status ?? 'missing', outcome: 'partial_missing_fields' })
      continue
    }
    const assertions = evaluateAssertions(step.result, task.assertions)
    const failed = assertions.some((row) => row.outcome !== 'pass')
    recovered.push({
      taskId: task.id,
      url: task.url,
      evaluationSet: task.evaluationSet,
      cached: step.cached,
      lane: step.lane,
      status: step.status,
      outcome: CONTENTFUL_STATUS.has(step.result.status) && !failed ? 'correct_complete' : 'partial_missing_fields',
    })
  }
  return recovered
}

const seed = await startSeedServer()
await rm(taskDir, { recursive: true, force: true })
await mkdir(taskDir, { recursive: true })
const startedAt = new Date().toISOString()
const t0 = Date.now()
let first = null
let afterKill = null
let resumed = null
let afterResume = null
let error = null
try {
  const crawlArgs = [
    '--max-pages', String(maxPages),
    '--max-depth', '1',
    '--task-dir', taskDir,
    '--allowlist-hosts', ['127.0.0.1', ...hosts].join(','),
    seed.url,
  ]
  const firstRun = spawnCrawl(crawlArgs)
  afterKill = await waitForSteps(taskDir, killAfterPages, 180_000)
  firstRun.child.kill('SIGKILL')
  first = await firstRun.done
  afterKill = await snapshot(taskDir)
  const secondRun = spawnCrawl([
    '--resume', taskDir,
    '--max-pages', String(maxPages),
    '--max-depth', '1',
    '--allowlist-hosts', ['127.0.0.1', ...hosts].join(','),
  ])
  resumed = await secondRun.done
  afterResume = await snapshot(taskDir)
} catch (err) {
  error = err instanceof Error ? err.message : String(err)
} finally {
  seed.server.close()
}

const killUrls = new Set((afterKill?.steps ?? []).map((step) => step.canonicalUrl))
const resumeUrls = new Set((afterResume?.steps ?? []).map((step) => step.canonicalUrl))
const lostUrls = [...killUrls].filter((url) => !resumeUrls.has(url))
const recoveredPages = scoreSteps(afterResume?.steps ?? [])
const uniqueCanons = new Set(tasks.map((task) => canonicalize(task.url)))
const recoveredCanons = new Set(recoveredPages.filter((row) => row.status !== 'missing').map((row) => canonicalize(row.url)))
const failedPages = recoveredPages.filter((row) => row.outcome !== 'correct_complete')
const report = {
  protocol: 'phase4-a6-interrupt-resume',
  generatedAt: new Date().toISOString(),
  startedAt,
  wallMs: Date.now() - t0,
  seedUrl: seed.url,
  taskDir,
  killAfterPages,
  first: first && { code: first.code, signal: first.signal, stdoutTail: first.stdout.slice(-2000), stderrTail: first.stderr.slice(-800) },
  resumed: resumed && { code: resumed.code, signal: resumed.signal, stdoutTail: resumed.stdout.slice(-2000), stderrTail: resumed.stderr.slice(-800) },
  afterKill: afterKill && { taskId: afterKill.taskId, attempts: afterKill.attempts, steps: afterKill.steps.length, urls: afterKill.steps.map((step) => step.canonicalUrl) },
  afterResume: afterResume && { taskId: afterResume.taskId, attempts: afterResume.attempts, steps: afterResume.steps.length, cached: afterResume.steps.filter((step) => step.cached).length, urls: afterResume.steps.map((step) => step.canonicalUrl) },
  lostUrls,
  recoveredPages: recoveredCanons.size,
  recoveredCanonicalTargets: uniqueCanons.size,
  recoveredCorrectComplete: recoveredPages.filter((row) => row.outcome === 'correct_complete').length,
  failedPages,
  sameTaskId: afterKill?.taskId != null && afterKill.taskId === afterResume?.taskId,
  newAttempt: (afterResume?.attempts.length ?? 0) > (afterKill?.attempts.length ?? 0),
  error,
  status: error === null && lostUrls.length === 0 && recoveredCanons.size === uniqueCanons.size && afterKill?.taskId === afterResume?.taskId && (afterResume?.attempts.length ?? 0) >= 2
    ? (failedPages.length === 0 ? 'passed' : 'passed_with_live_fetch_failures')
    : 'failed',
}
await mkdir(dirname(join(root, 'output/phase4/a6-recovery.json')), { recursive: true })
await writeFile(join(root, 'output/phase4/a6-recovery.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ status: report.status, lost: lostUrls.length, recoveredPages: recoveredCanons.size, targets: uniqueCanons.size, correct: report.recoveredCorrectComplete, failed: failedPages.map((row) => row.url), sameTaskId: report.sameTaskId, attempts: afterResume?.attempts.length ?? 0, error }, null, 2))
if (report.status === 'failed') process.exitCode = 1
