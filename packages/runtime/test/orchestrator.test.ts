import { describe, expect, it } from 'vitest'
import { DEFAULT_CRAWL_BUDGET, type FetchResult, type ScrapeAtom, type ScrapeOutcome } from '@w2l/contracts'
import { CrawlOrchestrator, type CrawlClock } from '../src/orchestrator.js'
import { MemoryTaskStore } from '../src/memoryStore.js'

class FakeClock implements CrawlClock {
  t = 1_000
  now(): number {
    return this.t
  }
  async wait(ms: number): Promise<void> {
    this.t += ms
  }
}

function page(
  url: string,
  over: { markdown?: string; links?: readonly string[]; hash?: string; wallMs?: number; cost?: number } = {},
): FetchResult {
  const markdown = over.markdown ?? `MAIN ${url}`
  return {
    requestedUrl: url,
    status: 'success',
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    lane: 'http',
    escalations: [],
    markdown,
    links: over.links ?? [],
    truncated: false,
    truncatedAt: null,
    compliance: null,
    evidence: {
      finalUrl: url,
      httpStatus: 200,
      redirectChain: [],
      contentType: 'text/html',
      rawBodySha256: over.hash ?? url,
      artifacts: [],
    },
    usage: {
      wallMs: over.wallMs ?? 5,
      bytesWire: 10,
      bytesDecompressed: 10,
      requestCount: 1,
      attemptCount: 1,
      contentTokens: 4,
      browserMs: 0,
      externalCostUsd: over.cost ?? null,
    },
    trace: [],
  }
}

class FakeAtom implements ScrapeAtom {
  readonly fetches: string[] = []
  constructor(private readonly pages: ReadonlyMap<string, ScrapeOutcome>) {}

  async scrape(url: string): Promise<ScrapeOutcome> {
    this.fetches.push(url)
    const hit = this.pages.get(url)
    if (hit === undefined) throw new Error(`fake atom has no page for ${url}`)
    return hit
  }

  async close(): Promise<void> {}
}

class ConcurrentAtom implements ScrapeAtom {
  active = 0
  maxActive = 0
  constructor(private readonly pages: ReadonlyMap<string, ScrapeOutcome>) {}
  async scrape(url: string): Promise<ScrapeOutcome> {
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    this.active--
    const hit = this.pages.get(url)
    if (hit === undefined) throw new Error(`fake atom has no page for ${url}`)
    return hit
  }
  async close(): Promise<void> {}
}

function outcome(url: string, links: readonly string[], hash = url): ScrapeOutcome {
  const result = page(url, { links, hash })
  return { result, links }
}

function runWith(atom: FakeAtom, spec: Parameters<CrawlOrchestrator['run']>[0], store = new MemoryTaskStore()) {
  const clock = new FakeClock()
  const orchestrator = new CrawlOrchestrator({ store, atom, clock })
  return { store, atom, clock, orchestrator, go: () => orchestrator.run(spec) }
}

const SEED = 'https://fixture.test/listing'
const ITEM_A = 'https://fixture.test/a'
const ITEM_B = 'https://fixture.test/b'

describe('CrawlOrchestrator with a fake scrape atom', () => {
  it('scrapes the seed, enqueues only contentful links, and does not import Playwright', async () => {
    const atom = new FakeAtom(
      new Map([
        [SEED, outcome(SEED, [ITEM_A, ITEM_B])],
        [ITEM_A, outcome(ITEM_A, [])],
        [ITEM_B, outcome(ITEM_B, [])],
      ]),
    )
    const { go } = runWith(atom, { seedUrl: SEED, taskDir: '/tmp/w2l-crawl' })
    const report = await go()
    expect(report.status).toBe('completed')
    expect(report.pagesFetched).toBe(3)
    expect(report.loopDetected).toBe(false)
    expect(atom.fetches).toEqual([SEED, ITEM_A, ITEM_B])
    const runtime = await import('../src/orchestrator.js')
    expect(Object.keys(runtime).sort()).toEqual(['CrawlOrchestrator', 'systemClock'])
  })

  it('does not enqueue links from a non-contentful page', async () => {
    const blocked: FetchResult = {
      ...page(SEED, { links: [ITEM_A] }),
      status: 'blocked',
      blockReason: 'captcha',
      markdown: null,
    }
    const atom = new FakeAtom(new Map([[SEED, { result: blocked, links: [ITEM_A] }]]))
    const { go } = runWith(atom, { seedUrl: SEED, taskDir: '/tmp/w2l-crawl' })
    const report = await go()
    expect(report.pagesFetched).toBe(1)
    expect(atom.fetches).toEqual([SEED])
  })

  it('stops at --max-pages with budget_exceeded: pages', async () => {
    const atom = new FakeAtom(
      new Map([
        [SEED, outcome(SEED, [ITEM_A, ITEM_B])],
        [ITEM_A, outcome(ITEM_A, [])],
        [ITEM_B, outcome(ITEM_B, [])],
      ]),
    )
    const { store, go } = runWith(atom, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      budget: { maxPages: 1, maxWallMs: null, maxCostUsd: null, maxTokens: null },
    })
    const report = await go()
    expect(report.pagesFetched).toBe(1)
    expect(report.budgetExceeded).toBe('pages')
    expect(atom.fetches).toEqual([SEED])
    const attempt = await store.getAttempt(report.attemptId)
    expect(attempt?.budgetExceeded).toBe('pages')
  })

  it('stops on time and cost budgets', async () => {
    const atom = new FakeAtom(new Map([[SEED, outcome(SEED, [])]]))
    const timed = runWith(atom, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      budget: { maxPages: null, maxWallMs: 0, maxCostUsd: null, maxTokens: null },
    })
    const timeReport = await timed.go()
    expect(timeReport.budgetExceeded).toBe('time')
    expect(timeReport.pagesFetched).toBe(0)

    const twoPage = new FakeAtom(
      new Map([
        [SEED, { result: page(SEED, { cost: 5, links: [ITEM_A] }), links: [ITEM_A] }],
        [ITEM_A, outcome(ITEM_A, [])],
      ]),
    )
    const capped = runWith(twoPage, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      budget: { maxPages: null, maxWallMs: null, maxCostUsd: 5, maxTokens: null },
    })
    const cappedReport = await capped.go()
    expect(cappedReport.pagesFetched).toBe(1)
    expect(cappedReport.budgetExceeded).toBe('cost')
    expect(twoPage.fetches).toEqual([SEED])
  })

  it('marks a later URL with the same body as duplicate and keeps crawling', async () => {
    const atom = new FakeAtom(
      new Map([
        [SEED, outcome(SEED, [ITEM_A, ITEM_B], 'same-body')],
        [ITEM_A, outcome(ITEM_A, [SEED], 'same-body')],
        [ITEM_B, outcome(ITEM_B, [], 'other')],
      ]),
    )
    const { store, go } = runWith(atom, { seedUrl: SEED, taskDir: '/tmp/w2l-crawl' })
    const report = await go()
    expect(report.loopDetected).toBe(false)
    expect(report.status).toBe('completed')
    expect(atom.fetches).toEqual([SEED, ITEM_A, ITEM_B])
    const steps = await store.listSteps(report.taskId, report.attemptId)
    const dup = steps.find((s) => s.canonicalUrl === ITEM_A)
    expect(dup?.status).toBe('duplicate')
    expect(dup?.result?.status).toBe('duplicate')
    expect(dup?.contentHash).toBe('same-body')
    expect(dup?.result?.failureReason).toBeNull()
    expect(dup?.result?.markdown).toBeNull()
    expect(dup?.result?.trace.some((t) => t.event === 'duplicate_content')).toBe(true)
    const other = steps.find((s) => s.canonicalUrl === ITEM_B)
    expect(other?.status).toBe('success')
  })

  it('restores the queue on resume and refetches by default', async () => {
    const pages = new Map([
      [SEED, outcome(SEED, [ITEM_A])],
      [ITEM_A, outcome(ITEM_A, [])],
    ])
    const store = new MemoryTaskStore()
    const firstAtom = new FakeAtom(pages)
    const first = runWith(firstAtom, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      budget: { maxPages: 1, maxWallMs: null, maxCostUsd: null, maxTokens: null },
    }, store)
    const firstReport = await first.go()
    expect(firstAtom.fetches).toEqual([SEED])

    const resumeAtom = new FakeAtom(pages)
    const resumed = runWith(resumeAtom, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      resumeFrom: firstReport.taskId,
    }, store)
    const resumeReport = await resumed.go()
    expect(resumeReport.taskId).toBe(firstReport.taskId)
    expect(resumeReport.attemptId).not.toBe(firstReport.attemptId)
    expect(resumeAtom.fetches).toEqual([SEED, ITEM_A])
    expect(resumeReport.cachedPages).toBe(0)
  })

  it('skips the fake fetch for cached pages only with --use-cached, and marks them', async () => {
    const pages = new Map([
      [SEED, outcome(SEED, [ITEM_A])],
      [ITEM_A, outcome(ITEM_A, [])],
    ])
    const store = new MemoryTaskStore()
    const firstAtom = new FakeAtom(pages)
    const first = runWith(firstAtom, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      budget: { maxPages: 1, maxWallMs: null, maxCostUsd: null, maxTokens: null },
    }, store)
    const firstReport = await first.go()

    const resumeAtom = new FakeAtom(pages)
    const resumed = runWith(resumeAtom, {
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      resumeFrom: firstReport.taskId,
      useCached: true,
    }, store)
    const resumeReport = await resumed.go()
    expect(resumeAtom.fetches).toEqual([ITEM_A])
    expect(resumeReport.cachedPages).toBe(1)
    expect(resumeReport.pagesFetched).toBe(2)
    const steps = await store.listSteps(resumeReport.taskId, resumeReport.attemptId)
    const cached = steps.find((s) => s.canonicalUrl === SEED)
    expect(cached?.cached).toBe(true)
    expect(cached?.result?.markdown).toContain('MAIN')
  })

  it('writes failed when scrape throws and does not leave the task running', async () => {
    const atom = new FakeAtom(new Map())
    const { store, go } = runWith(atom, { seedUrl: SEED, taskDir: '/tmp/w2l-crawl' })
    await expect(go()).rejects.toThrow(/fake atom has no page/)
    const tasks = await store.listTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe('failed')
    const attempts = await store.listAttempts(tasks[0]!.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.status).toBe('failed')
    expect(attempts[0]?.endedAt).not.toBeNull()
  })

  it('runs bounded workers instead of awaiting every page serially', async () => {
    const pages = new Map<string, ScrapeOutcome>([[SEED, outcome(SEED, [ITEM_A, ITEM_B])], [ITEM_A, outcome(ITEM_A, [])], [ITEM_B, outcome(ITEM_B, [])]])
    const atom = new ConcurrentAtom(pages)
    const clock = new FakeClock()
    const report = await new CrawlOrchestrator({ store: new MemoryTaskStore(), atom, clock, workerCount: 2, perHostMinDelayMs: 0 }).run({ seedUrl: SEED, taskDir: '/tmp/w2l-crawl' })
    expect(report.pagesFetched).toBe(3)
    expect(atom.maxActive).toBe(2)
  })

  it('does not oversubscribe maxPages while workers are in flight', async () => {
    const pages = new Map<string, ScrapeOutcome>([
      [SEED, outcome(SEED, [ITEM_A, ITEM_B])],
      [ITEM_A, outcome(ITEM_A, [])],
      [ITEM_B, outcome(ITEM_B, [])],
    ])
    const atom = new ConcurrentAtom(pages)
    const report = await new CrawlOrchestrator({
      store: new MemoryTaskStore(),
      atom,
      clock: new FakeClock(),
      workerCount: 4,
      perHostMinDelayMs: 0,
    }).run({
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      budget: { maxPages: 2, maxWallMs: null, maxCostUsd: null, maxTokens: null },
    })
    expect(report.pagesFetched).toBe(2)
  })

  it('accounts for ladder attempts and keeps unknown meters explicit', async () => {
    const atom: ScrapeAtom = {
      async scrape(url) {
        return {
          result: page(url, { cost: 2 }),
          links: [],
          audit: {
            channelsTried: ['http', 'provider'],
            ladderTrace: [],
            summary: {
              channelsTried: ['http', 'provider'],
              attempts: [],
              wallMs: 2,
              browserMs: 0,
              bytesWire: null,
              bytesDecompressed: 0,
              requestCount: 2,
              attemptCount: 2,
              contentTokens: null,
              externalCostUsd: null,
              externalCost: { knownSubtotal: 2, unknown: true },
              contentTokenMeter: { knownSubtotal: 4, unknown: true },
              artifacts: [],
            },
          },
        }
      },
      async close() {},
    }
    const report = await new CrawlOrchestrator({ store: new MemoryTaskStore(), atom, clock: new FakeClock() }).run({ seedUrl: SEED, taskDir: '/tmp/w2l-crawl' })
    expect(report.costUsd).toBeNull()
    expect(report.costUnknown).toBe(true)
    expect(report.contentTokensUnknown).toBe(true)
  })

  it('writes failed when the store throws after a scrape', async () => {
    const store = new MemoryTaskStore()
    const original = store.putStep.bind(store)
    store.putStep = async (step) => {
      await original(step)
      throw new Error('checkpoint write failed')
    }
    const atom = new FakeAtom(new Map([[SEED, outcome(SEED, [])]]))
    const { go } = runWith(atom, { seedUrl: SEED, taskDir: '/tmp/w2l-crawl' }, store)
    await expect(go()).rejects.toThrow(/checkpoint write failed/)
    const tasks = await store.listTasks()
    expect(tasks[0]?.status).toBe('failed')
    const attempts = await store.listAttempts(tasks[0]!.id)
    expect(attempts[0]?.status).toBe('failed')
  })

  it('reseeds the seed URL when resume finds no contentful checkpoint', async () => {
    const store = new MemoryTaskStore()
    const startedAt = '2026-09-18T00:00:00.000Z'
    await store.putTask({
      id: 'task-kill',
      seedUrl: SEED,
      taskDir: '/tmp/w2l-crawl',
      mode: 'standard',
      status: 'running',
      budget: DEFAULT_CRAWL_BUDGET,
      createdAt: startedAt,
      updatedAt: startedAt,
    })
    await store.putAttempt({
      id: 'attempt-kill',
      taskId: 'task-kill',
      status: 'running',
      startedAt,
      endedAt: null,
      pagesFetched: 0,
      wallMs: 0,
      costUsd: 0,
      contentTokens: 0,
      budgetExceeded: null,
    })

    const atom = new FakeAtom(
      new Map([
        [SEED, outcome(SEED, [ITEM_A])],
        [ITEM_A, outcome(ITEM_A, [])],
      ]),
    )
    const resumed = runWith(
      atom,
      { seedUrl: SEED, taskDir: '/tmp/w2l-crawl', resumeFrom: 'task-kill' },
      store,
    )
    const report = await resumed.go()
    expect(report.taskId).toBe('task-kill')
    expect(report.status).toBe('completed')
    expect(report.loopDetected).toBe(false)
    expect(atom.fetches).toEqual([SEED, ITEM_A])
    expect(report.pagesFetched).toBe(2)
    const attempts = await store.listAttempts('task-kill')
    const killed = attempts.find((row) => row.id === 'attempt-kill')
    expect(killed?.status).toBe('interrupted')
    expect(killed?.endedAt).not.toBeNull()
    expect(report.attemptId).not.toBe('attempt-kill')
    const resumedAttempt = attempts.find((row) => row.id === report.attemptId)
    expect(resumedAttempt?.recoveredFromAttemptId).toBe('attempt-kill')
  })
})

describe('CrawlOrchestrator execution lifecycle', () => {
  function waitingAtom() {
    let started!: () => void
    const active = new Promise<void>(resolve => { started = resolve })
    let seenSignal: AbortSignal | undefined
    let seenDeadline: number | undefined
    let closed = false
    const atom: ScrapeAtom = {
      async scrape(_url, context) {
        seenSignal = context?.signal
        seenDeadline = context?.deadlineAt
        started()
        return new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () => reject(context.signal!.reason), { once: true })
        })
      },
      async close() { closed = true },
    }
    return { atom, active, signal: () => seenSignal, deadline: () => seenDeadline, closed: () => closed }
  }

  it('aborts active work and wakes idle workers on explicit cancellation', async () => {
    const store = new MemoryTaskStore()
    const pending = waitingAtom()
    const controller = new AbortController()
    const run = new CrawlOrchestrator({ store, atom: pending.atom, signal: controller.signal, workerCount: 4 }).run({ seedUrl: SEED, taskDir: '/tmp/lifecycle' })
    await pending.active
    controller.abort()
    const report = await run
    expect(report.status).toBe('cancelled')
    expect(pending.signal()?.aborted).toBe(true)
    expect(pending.closed()).toBe(true)
    expect((await store.getAttempt(report.attemptId))?.status).toBe('cancelled')
    expect(await store.listSteps(report.taskId)).toEqual([])
  })

  it('wall deadline aborts a live request and records a time budget instead of failure', async () => {
    const store = new MemoryTaskStore()
    const pending = waitingAtom()
    const started = Date.now()
    const report = await new CrawlOrchestrator({ store, atom: pending.atom, workerCount: 4 }).run({ seedUrl: SEED, taskDir: '/tmp/lifecycle', budget: { maxWallMs: 80, maxPages: null, maxCostUsd: null, maxTokens: null } })
    expect(report.status).toBe('completed')
    expect(report.budgetExceeded).toBe('time')
    expect(report.pagesFetched).toBe(0)
    expect(pending.deadline()).toBeGreaterThanOrEqual(started + 80)
    expect(pending.signal()?.aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect((await store.getAttempt(report.attemptId))?.status).toBe('completed')
  })

  it('interrupts a long frontier politeness wait without fetching another page', async () => {
    const store = new MemoryTaskStore()
    const controller = new AbortController()
    const atom = new FakeAtom(new Map([[SEED, outcome(SEED, [ITEM_A])]]))
    const run = new CrawlOrchestrator({ store, atom, signal: controller.signal, perHostMinDelayMs: 60_000, workerCount: 1 }).run({ seedUrl: SEED, taskDir: '/tmp/lifecycle', budget: { ...DEFAULT_CRAWL_BUDGET, maxWallMs: null } })
    await expect.poll(async () => (await store.listTasks()).length && (await store.listSteps((await store.listTasks())[0]!.id)).length).toBe(1)
    const started = Date.now()
    controller.abort()
    const report = await run
    expect(report.status).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(atom.fetches).toEqual([SEED])
  })

  it('service shutdown checkpoints paused/interrupted and permits resume', async () => {
    const store = new MemoryTaskStore()
    const shutdown = new AbortController()
    const pending = waitingAtom()
    const run = new CrawlOrchestrator({ store, atom: pending.atom, shutdownSignal: shutdown.signal }).run({ seedUrl: SEED, taskDir: '/tmp/lifecycle' })
    await pending.active
    shutdown.abort(new DOMException('service shutdown', 'ShutdownError'))
    const report = await run
    expect(report.status).toBe('paused')
    expect((await store.getAttempt(report.attemptId))?.status).toBe('interrupted')
    const resumed = await new CrawlOrchestrator({ store, atom: new FakeAtom(new Map([[SEED, outcome(SEED, [])]])) }).run({ seedUrl: SEED, taskDir: '/tmp/lifecycle', resumeFrom: report.taskId })
    expect(resumed.status).toBe('completed')
    expect(resumed.taskId).toBe(report.taskId)
  })

  it('observes another SQLite connection cancelling an in-flight request', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { SqliteTaskStore } = await import('../src/sqliteStore.js')
    const dir = await mkdtemp(join(tmpdir(), 'w2l-cancel-'))
    const local = SqliteTaskStore.open(dir)
    const other = SqliteTaskStore.open(dir)
    try {
      const pending = waitingAtom()
      const run = new CrawlOrchestrator({ store: local, atom: pending.atom }).run({ seedUrl: SEED, taskDir: dir })
      await pending.active
      const task = (await other.listTasks())[0]!
      await other.putTask({ ...task, status: 'cancelled', updatedAt: new Date().toISOString() })
      const report = await run
      expect(report.status).toBe('cancelled')
      expect(pending.signal()?.aborted).toBe(true)
      expect((await other.getAttempt(report.attemptId))?.status).toBe('cancelled')
      expect(await other.listSteps(task.id)).toEqual([])
    } finally { await local.close(); await other.close(); await rm(dir, { recursive: true, force: true }) }
  })
})
