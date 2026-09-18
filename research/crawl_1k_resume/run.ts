/**
 * Volume probe: crawl the 1k synthetic catalog, SIGKILL the process, resume.
 * Does not change runtime. Writes JSON evidence next to this file.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SqliteTaskStore } from '../../packages/runtime/src/index.ts'
import { PAGE_COUNT, startProbeServer } from './site.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outDir = fileURLToPath(new URL('.', import.meta.url))

async function snapshot(taskDir: string) {
  const store = SqliteTaskStore.openReadOnly(taskDir)
  try {
    const tasks = await store.listTasks()
    const task = tasks[tasks.length - 1]
    if (task === undefined) {
      return {
        taskId: null,
        attempts: 0,
        steps: 0,
        urls: [] as string[],
        lanes: [] as string[],
        statuses: [] as string[],
        cached: 0,
        contentful: 0,
      }
    }
    const attempts = await store.listAttempts(task.id)
    const steps = await store.listSteps(task.id)
    return {
      taskId: task.id,
      attempts: attempts.length,
      steps: steps.length,
      urls: steps.map((s) => s.canonicalUrl),
      lanes: [...new Set(steps.map((s) => s.lane).filter((lane): lane is NonNullable<typeof lane> => lane !== null))],
      statuses: [...new Set(steps.map((s) => s.status))],
      cached: steps.filter((s) => s.cached).length,
      contentful: steps.filter((s) => s.status === 'success' || s.status === 'partial').length,
    }
  } finally {
    await store.close()
  }
}

function spawnCrawl(args: string[]): { child: ChildProcess; done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> } {
  const child = spawn('node', ['--import', 'tsx', 'packages/bench/src/w2lCli.ts', 'crawl', ...args], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, done }
}

async function main(): Promise<void> {
  const probe = await startProbeServer()
  const taskDir = join(outDir, 'task')
  mkdirSync(taskDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  let killAtMs: number | null = null
  let first: Awaited<ReturnType<typeof spawnCrawl>['done']> | null = null
  let afterKill: Awaited<ReturnType<typeof snapshot>> | null = null
  let resumed: Awaited<ReturnType<typeof spawnCrawl>['done']> | null = null
  let afterResume: Awaited<ReturnType<typeof snapshot>> | null = null
  let error: string | null = null

  try {
    const crawlArgs = [
      '--max-pages',
      String(PAGE_COUNT + 1),
      '--max-depth',
      '1',
      '--task-dir',
      taskDir,
      `${probe.url}/listing`,
    ]
    const firstRun = spawnCrawl(crawlArgs)
    await new Promise((resolve) => setTimeout(resolve, 8000))
    killAtMs = Date.now() - t0
    firstRun.child.kill('SIGKILL')
    first = await firstRun.done
    afterKill = await snapshot(taskDir)

    const secondRun = spawnCrawl(['--resume', taskDir, '--max-pages', String(PAGE_COUNT + 1), '--max-depth', '1'])
    resumed = await secondRun.done
    afterResume = await snapshot(taskDir)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    await probe.close()
  }

  const lostUrls =
    afterKill === null || afterResume === null ? null : afterKill.urls.filter((url) => !afterResume.urls.includes(url))
  const evidence = {
    startedAt,
    wallMs: Date.now() - t0,
    killAfterMs: killAtMs,
    pageBudget: PAGE_COUNT + 1,
    first: first === null ? null : { code: first.code, signal: first.signal, stdoutTail: first.stdout.slice(-1500), stderrTail: first.stderr.slice(-800) },
    afterKill,
    resumed:
      resumed === null
        ? null
        : { code: resumed.code, signal: resumed.signal, stdoutTail: resumed.stdout.slice(-2000), stderrTail: resumed.stderr.slice(-800) },
    afterResume,
    lostUrls,
    error,
  }
  writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
  const summary = {
    uniqueUrls: afterResume?.urls ? new Set(afterResume.urls).size : 0,
    lost: lostUrls?.length ?? null,
    killSteps: afterKill?.steps ?? null,
    resumeSteps: afterResume?.steps ?? null,
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  await rm(taskDir, { recursive: true, force: true }).catch(() => {})
  if (error !== null) process.exitCode = 1
}

await main()
