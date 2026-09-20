import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const work = await mkdtemp(join(tmpdir(), 'w2l-install-'))
const started = Date.now()
const log = []
function run(command, args, cwd, extra = {}) {
  const startedAt = Date.now()
  try {
    const stdout = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...extra })
    log.push({ command, args, cwd, ok: true, elapsedMs: Date.now() - startedAt, stdout: stdout.slice(-4000) })
    return stdout
  } catch (error) {
    const err = error
    log.push({ command, args, cwd, ok: false, elapsedMs: Date.now() - startedAt, stdout: String(err.stdout ?? '').slice(-4000), stderr: String(err.stderr ?? err.message).slice(-4000) })
    throw error
  }
}

function waitForApi(url, timeoutMs) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { method: 'GET' })
        if (res.ok || res.status < 500) {
          resolve(true)
          return
        }
      } catch {}
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`API did not become ready at ${url}`))
        return
      }
      setTimeout(() => { void tick() }, 300)
    }
    void tick()
  })
}

let status = 'failed'
let error = null
let firstTask = null
let api = null
try {
  run('git', ['clone', '--quiet', root, join(work, 'w2l')])
  const clone = join(work, 'w2l')
  run('git', ['-C', clone, 'checkout', '--quiet', commit])
  run('npm', ['ci'], clone, { timeout: 300000 })
  run('npx', ['playwright', 'install', 'chromium'], clone, { timeout: 180000 })
  const port = process.env.W2L_INSTALL_API_PORT ?? '8791'
  const baseUrl = `http://127.0.0.1:${port}`
  api = spawn('npm', ['run', 'api', '--', '--port', port], { cwd: clone, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let apiOut = ''
  api.stdout?.on('data', (chunk) => { apiOut += chunk.toString() })
  api.stderr?.on('data', (chunk) => { apiOut += chunk.toString() })
  await waitForApi(baseUrl, 20000).catch(() => {
    if (!apiOut.includes('listening')) throw new Error(`API failed to start: ${apiOut.slice(-1000)}`)
  })
  const manifest = JSON.parse(await readFile(join(clone, 'research/phase4_real_tasks.json'), 'utf8'))
  const one = { ...manifest, tasks: [manifest.tasks[0]] }
  await writeFile(join(clone, 'research/phase4_install_one_task.json'), JSON.stringify(one, null, 2) + '\n')
  run('node', ['--import', 'tsx', 'packages/bench/src/phase4Cli.ts'], clone, {
    env: { ...process.env, W2L_API_URL: baseUrl, W2L_PHASE4_MANIFEST: 'research/phase4_install_one_task.json', W2L_PHASE4_OUTPUT: 'output/phase4/install-first-task.json' },
    timeout: 180000,
  })
  firstTask = JSON.parse(await readFile(join(clone, 'output/phase4/install-first-task.json'), 'utf8'))
  const run0 = firstTask.runs?.[0]
  status = run0?.outcome === 'correct_complete' ? 'passed_clean_clone' : 'failed'
} catch (err) {
  error = err instanceof Error ? err.message : String(err)
} finally {
  if (api) api.kill('SIGTERM')
}

const report = {
  protocol: 'phase4-clean-clone-install',
  generatedAt: new Date().toISOString(),
  status,
  operatorIndependence: 'same_machine_clean_clone_not_second_human',
  commit,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  elapsedMs: Date.now() - started,
  workdir: work,
  firstTask: firstTask && { taskId: firstTask.runs?.[0]?.taskId, outcome: firstTask.runs?.[0]?.outcome, lane: firstTask.runs?.[0]?.result?.lane },
  commands: log.map((row) => ({ command: row.command, args: row.args, ok: row.ok, elapsedMs: row.elapsedMs })),
  error,
  note: 'Executed from a clean clone of the current commit on this machine. It proves install+first-task reproducibility, not a second independent developer.',
}
await writeFile('output/phase4/install-smoke.json', JSON.stringify(report, null, 2) + '\n')
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(JSON.stringify({ status: report.status, commit, firstTask: report.firstTask, error }, null, 2))
if (status !== 'passed_clean_clone') process.exitCode = 1
