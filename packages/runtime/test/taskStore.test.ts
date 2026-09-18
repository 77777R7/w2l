import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CRAWL_BUDGET,
  type Attempt,
  type FetchResult,
  type StepRecord,
  type Task,
} from '@w2l/contracts'
import { CHECKPOINT_FILENAME, MemoryTaskStore, SqliteTaskStore, type TaskStore } from '../src/index.js'

const NOW = '2026-09-18T00:00:00.000Z'
const LATER = '2026-09-18T00:01:00.000Z'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    seedUrl: 'https://example.com/',
    taskDir: '/tmp/w2l-task',
    mode: 'standard',
    status: 'running',
    budget: DEFAULT_CRAWL_BUDGET,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'attempt-1',
    taskId: 'task-1',
    status: 'running',
    startedAt: NOW,
    endedAt: null,
    pagesFetched: 0,
    wallMs: 0,
    costUsd: 0,
    contentTokens: 0,
    budgetExceeded: null,
    ...overrides,
  }
}

function pageResult(url: string): FetchResult {
  return {
    requestedUrl: url,
    status: 'success',
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    lane: 'http',
    escalations: [],
    handoff: null,
    markdown: 'MAIN',
    truncated: false,
    truncatedAt: null,
    compliance: null,
    evidence: {
      finalUrl: url,
      httpStatus: 200,
      redirectChain: [],
      contentType: 'text/html',
      rawBodySha256: 'abc',
      artifacts: [],
    },
    usage: {
      wallMs: 12,
      bytesWire: 100,
      bytesDecompressed: 100,
      requestCount: 1,
      attemptCount: 1,
      contentTokens: 4,
      browserMs: 0,
      externalCostUsd: null,
    },
    trace: [],
  }
}

function step(overrides: Partial<StepRecord> = {}): StepRecord {
  const url = overrides.url ?? 'https://example.com/'
  return {
    id: 'step-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    url,
    canonicalUrl: url,
    depth: 0,
    status: 'success',
    lane: 'http',
    contentHash: 'abc',
    cached: false,
    result: pageResult(url),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const sqlMethods = ['exec', 'prepare', 'pragma', 'transaction', 'serialize'] as const

function expectNoSqlSurface(store: TaskStore): void {
  const exposed = sqlMethods.filter((name) => typeof (store as unknown as Record<string, unknown>)[name] === 'function')
  expect(exposed, 'TaskStore must not leak a SQL handle onto the caller').toEqual([])
}

async function seed(store: TaskStore): Promise<void> {
  await store.putTask(task())
  await store.putAttempt(attempt())
}

function runStoreContract(name: string, open: () => Promise<{ store: TaskStore; cleanup: () => Promise<void> }>): void {
  describe(name, () => {
    let store: TaskStore
    let cleanup: () => Promise<void>

    afterEach(async () => {
      await store.close()
      await cleanup()
    })

    it('round-trips task, attempt, and a URL-granularity step', async () => {
      ;({ store, cleanup } = await open())
      await seed(store)
      await store.putStep(step())

      expect(await store.getTask('task-1')).toEqual(task())
      expect(await store.listTasks()).toEqual([task()])
      expect(await store.getAttempt('attempt-1')).toEqual(attempt())
      expect(await store.getStep('step-1')).toEqual(step())
      expect(await store.listAttempts('task-1')).toEqual([attempt()])
      expect(await store.listSteps('task-1')).toEqual([step()])
      expect(await store.listSteps('task-1', 'attempt-1')).toEqual([step()])
      expect(await store.getStepByCanonicalUrl('task-1', 'https://example.com/')).toEqual(step())
    })

    it('is idempotent: the same (taskId, attemptId, stepId) does not create a second row', async () => {
      ;({ store, cleanup } = await open())
      await seed(store)
      await store.putTask(task())
      await store.putAttempt(attempt())
      await store.putStep(step())
      await store.putStep(step({ status: 'failed', result: null, contentHash: null, updatedAt: LATER }))

      expect(await store.listAttempts('task-1')).toHaveLength(1)
      expect(await store.listSteps('task-1')).toHaveLength(1)
      const stored = await store.getStep('step-1')
      expect(stored?.status).toBe('failed')
      expect(stored?.updatedAt).toBe(LATER)
      expect(stored?.result).toBeNull()
    })

    it('rejects empty caller ids instead of inventing a database key', async () => {
      ;({ store, cleanup } = await open())
      await expect(store.putTask(task({ id: '' }))).rejects.toThrow(/non-empty caller-generated id/)
    })

    it('refuses an attempt or step whose parent does not exist', async () => {
      ;({ store, cleanup } = await open())
      await expect(store.putAttempt(attempt())).rejects.toThrow(/unknown task/)
      await store.putTask(task())
      await expect(store.putStep(step())).rejects.toThrow(/unknown attempt/)
    })

    it('refuses a step whose attempt belongs to a different task', async () => {
      ;({ store, cleanup } = await open())
      await store.putTask(task())
      await store.putTask(task({ id: 'task-2', seedUrl: 'https://other.example/' }))
      await store.putAttempt(attempt({ id: 'attempt-2', taskId: 'task-2' }))
      await expect(store.putStep(step({ attemptId: 'attempt-2' }))).rejects.toThrow(/belongs to task task-2/)
    })

    it('returns the latest step for a canonical URL across attempts', async () => {
      ;({ store, cleanup } = await open())
      await seed(store)
      await store.putAttempt(attempt({ id: 'attempt-2', startedAt: LATER }))
      await store.putStep(step({ contentHash: 'old' }))
      await store.putStep(
        step({
          id: 'step-2',
          attemptId: 'attempt-2',
          contentHash: 'new',
          updatedAt: LATER,
          result: pageResult('https://example.com/'),
        }),
      )

      const latest = await store.getStepByCanonicalUrl('task-1', 'https://example.com/')
      expect(latest?.id).toBe('step-2')
      expect(latest?.contentHash).toBe('new')
      expect(await store.listSteps('task-1', 'attempt-1')).toHaveLength(1)
      expect(await store.listSteps('task-1', 'attempt-2')).toHaveLength(1)
    })

    it('stores one step per URL, never a page fragment', async () => {
      ;({ store, cleanup } = await open())
      await seed(store)
      await store.putStep(step())
      const stored = await store.getStep('step-1')
      expect(stored?.url).toBe('https://example.com/')
      expect(stored).not.toHaveProperty('chunkId')
      expect(stored).not.toHaveProperty('blockId')
    })

    it('does not expose a SQL handle on the TaskStore object', async () => {
      ;({ store, cleanup } = await open())
      expectNoSqlSurface(store)
    })
  })
}

runStoreContract('MemoryTaskStore', async () => ({
  store: new MemoryTaskStore(),
  cleanup: async () => {},
}))

runStoreContract('SqliteTaskStore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'w2l-checkpoint-'))
  return {
    store: SqliteTaskStore.open(dir),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
})

describe('SqliteTaskStore file layout', () => {
  it('writes checkpoint.sqlite next to the task directory with 0600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-checkpoint-'))
    const store = SqliteTaskStore.open(dir)
    try {
      await store.putTask(task({ taskDir: dir }))
      const file = join(dir, CHECKPOINT_FILENAME)
      const info = await stat(file)
      expect(info.isFile()).toBe(true)
      expect(info.mode & 0o777).toBe(0o600)
    } finally {
      await store.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reopens the same file and sees prior rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-checkpoint-'))
    const first = SqliteTaskStore.open(dir)
    try {
      await first.putTask(task({ taskDir: dir }))
      await first.putAttempt(attempt())
      await first.putStep(step())
    } finally {
      await first.close()
    }

    const second = SqliteTaskStore.open(dir)
    try {
      expect((await second.getTask('task-1'))?.seedUrl).toBe('https://example.com/')
      expect(await second.listSteps('task-1')).toHaveLength(1)
    } finally {
      await second.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('@w2l/runtime public surface', () => {
  it('exports the store seam and both backends, not a SQL dialect', async () => {
    const runtime = await import('../src/index.js')
    expect(Object.keys(runtime).sort()).toEqual([
      'CHECKPOINT_FILENAME',
      'CrawlOrchestrator',
      'Frontier',
      'MemoryTaskStore',
      'SqliteTaskStore',
      'canonicalizeUrl',
      'crawlReportFromStore',
      'hostOf',
      'reportFromTaskAttempt',
      'systemClock',
    ])
    expect(runtime).not.toHaveProperty('SCHEMA')
    expect(runtime).not.toHaveProperty('Database')
  })
})
