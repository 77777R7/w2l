/**
 * Crawl orchestrator: compose scrapes over a frontier and checkpoint.
 *
 * Never opens Playwright. A page is one ScrapeAtom.scrape(url).
 * Resume restores frontier membership from prior steps. Default is refetch;
 * --use-cached is the only skip-fetch path.
 *
 * Same rawBodySha256 on two distinct canonical URLs is duplicate content,
 * not a crawl loop. The duplicate is recorded and skipped; the crawl
 * continues. DOM-fingerprint N / pagination stall is out of this slice.
 */

import {
  CONTENTFUL_STATUS,
  DEFAULT_CRAWL_SPEC,
  stepStatusFromResult,
  type Attempt,
  type BudgetKind,
  type CrawlBudget,
  type CrawlReport,
  type CrawlSpec,
  type FetchResult,
  type ScrapeAtom,
  type StepRecord,
  type Task,
} from '@w2l/contracts'
import { abortableSleep, createExecutionScope, raceWithSignal, throwIfExecutionStopped } from '@w2l/http-core'
import { reportFromTaskAttempt } from './crawlReport.js'
import { Frontier } from './frontier.js'
import type { TaskStore } from './taskStore.js'

export interface CrawlClock {
  now(): number
  wait(ms: number, signal?: AbortSignal): Promise<void>
}

export const systemClock: CrawlClock = {
  now: () => Date.now(),
  wait: (ms, signal) => abortableSleep(ms, signal),
}

export interface OrchestratorOptions {
  store: TaskStore
  atom: ScrapeAtom
  clock?: CrawlClock
  newId?: () => string
  perHostConcurrency?: number
  perHostMinDelayMs?: number
  crawlDelayMsByHost?: ReadonlyMap<string, number>
  workerCount?: number
  signal?: AbortSignal
  /** Service shutdown interrupts work but leaves the task resumable. */
  shutdownSignal?: AbortSignal
}

const EMPTY_USAGE = {
  wallMs: 0,
  bytesWire: 0,
  bytesDecompressed: 0,
  requestCount: 0,
  attemptCount: 0,
  contentTokens: null as number | null,
  browserMs: 0,
  externalCostUsd: null,
}

export class CrawlOrchestrator {
  private readonly store: TaskStore
  private readonly atom: ScrapeAtom
  private readonly clock: CrawlClock
  private readonly newId: () => string
  private readonly frontierOptions: Pick<OrchestratorOptions, 'perHostConcurrency' | 'perHostMinDelayMs' | 'crawlDelayMsByHost'>
  private readonly workerCount: number
  private readonly signal?: AbortSignal
  private readonly shutdownSignal?: AbortSignal

  constructor(options: OrchestratorOptions) {
    this.store = options.store
    this.atom = options.atom
    this.clock = options.clock ?? systemClock
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.frontierOptions = options
    this.workerCount = Math.max(1, options.workerCount ?? 4)
    this.signal = options.signal
    this.shutdownSignal = options.shutdownSignal
  }

  async run(partial: Pick<CrawlSpec, 'seedUrl' | 'taskDir'> & Partial<CrawlSpec>): Promise<CrawlReport> {
    const spec: CrawlSpec = { ...DEFAULT_CRAWL_SPEC, ...partial }
    const startedAtMs = this.clock.now()
    // Injected clocks drive frontier tests; the transport contract is always epoch ms.
    const deadlineAt = spec.budget.maxWallMs === null ? undefined : Date.now() + spec.budget.maxWallMs
    const stopController = new AbortController()
    const scope = createExecutionScope({
      signal: AbortSignal.any([stopController.signal, ...(this.signal ? [this.signal] : []), ...(this.shutdownSignal ? [this.shutdownSignal] : [])]),
      deadlineAt,
    })
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let pollingStopped = false
    let persistedCancellation = false
    let wakeWorkers = (): void => {}
    const startedAt = new Date(startedAtMs).toISOString()

    const seenHash = new Map<string, string>()
    let pagesFetched = 0
    let cachedPages = 0
    let costUsd = 0
    let costUnknown = false
    let contentTokens = 0
    let contentTokensUnknown = false
    let budgetExceeded: BudgetKind | null = null
    let failed: unknown = null
    let task: Task | undefined
    let attempt: Attempt | undefined

    const markTimeBudget = (): void => {
      budgetExceeded = 'time'
      stopController.abort(new DOMException('Crawl wall-time budget exhausted', 'TimeoutError'))
    }
    const stopped = (): boolean => {
      if (scope.signal.aborted && !this.signal?.aborted && !this.shutdownSignal?.aborted && !persistedCancellation && failed === null) budgetExceeded = 'time'
      return scope.signal.aborted
    }
    const onStop = (): void => { wakeWorkers() }
    scope.signal.addEventListener('abort', onStop)
    try {
      const opened = await this.openRun(spec, startedAt)
      task = opened.task
      attempt = opened.attempt
      const frontier = new Frontier({
        seedUrl: task.seedUrl,
        maxDepth: spec.maxDepth,
        allowlistedDomains: spec.allowlistedDomains,
        ...this.frontierOptions,
      })
      await this.restoreFrontier(frontier, task, spec)
      const runningTask = task
      const runningAttempt = attempt
      let activePages = 0
      let reservedPages = 0
      let stopping = false
      const wakeResolvers: Array<() => void> = []
      wakeWorkers = (): void => {
        while (wakeResolvers.length > 0) wakeResolvers.shift()!()
      }

      // Cancellation written by another engine/process must reach an in-flight
      // request, rather than wait for that request to complete before polling.
      const pollCancellation = async (): Promise<void> => {
        try {
          const current = await this.store.getTask(runningTask.id)
          if (pollingStopped) return
          if (current?.status === 'cancelled') {
            persistedCancellation = true
            stopController.abort(new DOMException('Crawl cancelled', 'AbortError'))
          }
        } catch (error) {
          if (pollingStopped) return
          failed = error
          stopController.abort(error)
        }
        if (!pollingStopped && !scope.signal.aborted) pollTimer = setTimeout(() => { void pollCancellation() }, 100)
      }
      pollTimer = setTimeout(() => { void pollCancellation() }, 100)

      const work = async (): Promise<void> => {
        for (;;) {
          const now = this.clock.now()
          if (stopping || stopped()) break
          const persistedTask = await this.store.getTask(runningTask.id)
          if (persistedTask?.status === 'cancelled') {
            persistedCancellation = true
            stopController.abort(new DOMException('Crawl cancelled', 'AbortError'))
          }
          if (stopped()) { stopping = true; break }
          const spent: CrawlBudgetSpent = { pages: pagesFetched + cachedPages + reservedPages, wallMs: now - startedAtMs, costUsd, costUnknown, tokens: contentTokens, tokensUnknown: contentTokensUnknown }
          const hit = budgetHit(spec.budget, spent)
          if (hit !== null) { budgetExceeded = hit; if (hit === 'time') markTimeBudget(); break }
          const next = frontier.dequeue(now)
          if (next.item === null) {
            if (next.nextReadyAtMs === null) {
              if (activePages === 0) break
              await new Promise<void>((resolve) => wakeResolvers.push(resolve))
              continue
            }
            const remainingWait = Math.max(0, next.nextReadyAtMs - now)
            if (spec.budget.maxWallMs !== null && spent.wallMs + remainingWait >= spec.budget.maxWallMs) { markTimeBudget(); break }
            try { await raceWithSignal(this.clock.wait(remainingWait, scope.signal), scope.signal) } catch (error) { if (!stopped()) throw error }
            continue
          }
          const item = next.item
          reservedPages++
          activePages++
          try {
            const cached = spec.useCached ? await this.store.getStepByCanonicalUrl(runningTask.id, item.canonicalUrl) : null
            const reusable = cached !== null && cached.result !== null && CONTENTFUL_STATUS.has(cached.result.status)
            let result: FetchResult
            let links: readonly string[]
            let audit: import('@w2l/contracts').LadderRunAudit | undefined
            let cachedPage = false
            if (reusable && cached.result !== null) {
              result = cached.result; links = linksOf(cached.result); audit = cached.audit; cachedPage = true
            } else {
              const outcome = await raceWithSignal(this.atom.scrape(item.url, scope), scope.signal)
              result = outcome.result; links = outcome.links.length > 0 ? outcome.links : linksOf(outcome.result); audit = outcome.audit
              frontier.setCrawlDelay(item.host, outcome.crawlDelayMs ?? null)
            }
            const latestTask = await this.store.getTask(runningTask.id)
            if (latestTask?.status === 'cancelled') {
              persistedCancellation = true
              stopController.abort(new DOMException('Crawl cancelled', 'AbortError'))
            }
            if (spec.budget.maxWallMs !== null && this.clock.now() - startedAtMs >= spec.budget.maxWallMs) markTimeBudget()
            throwIfExecutionStopped(scope)
            const hash = result.evidence.rawBodySha256
            if (hash !== null && CONTENTFUL_STATUS.has(result.status)) {
              const prior = seenHash.get(hash)
              if (prior !== undefined && prior !== item.canonicalUrl) { result = duplicateResult(item.url, result, prior); links = [] }
              else seenHash.set(hash, item.canonicalUrl)
            }
            const at = new Date(this.clock.now()).toISOString()
            await this.store.putStep({ id: this.newId(), taskId: runningTask.id, attemptId: runningAttempt.id, url: item.url, canonicalUrl: item.canonicalUrl, depth: item.depth, status: stepStatusFromResult(result.status), lane: result.lane, contentHash: result.evidence.rawBodySha256, cached: cachedPage, result, audit, createdAt: at, updatedAt: at })
            if (cachedPage) cachedPages += 1; else pagesFetched += 1
            if (!cachedPage) {
              const meter = audit?.summary
              if (meter !== undefined) {
                costUsd += meter.externalCost.knownSubtotal
                costUnknown ||= meter.externalCost.unknown
                contentTokens += meter.contentTokenMeter.knownSubtotal
                contentTokensUnknown ||= meter.contentTokenMeter.unknown
              } else {
                costUsd += result.usage.externalCostUsd ?? 0
                costUnknown ||= result.usage.externalCostUsd === null
                contentTokens += result.usage.contentTokens ?? 0
                contentTokensUnknown ||= result.usage.contentTokens === null
              }
            }
            if (CONTENTFUL_STATUS.has(result.status)) {
              for (const href of links) frontier.enqueue(href, item.depth + 1, item.canonicalUrl)
              wakeWorkers()
            }
          } catch (err) {
            stopping = true
            wakeWorkers()
            if (stopped()) return
            failed = err
            stopController.abort(err)
            throw err
          } finally {
            reservedPages--
            frontier.release(item.canonicalUrl)
            activePages--
            wakeWorkers()
          }
        }
      }
      const workers = Array.from({ length: this.workerCount }, () => work())
      const settled = await Promise.allSettled(workers)
      const firstFailure = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
      if (firstFailure !== undefined) throw firstFailure.reason
    } catch (err) {
      if (!stopped()) failed = err
    } finally {
      pollingStopped = true
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      scope.signal.removeEventListener('abort', onStop)
      scope.dispose()
      wakeWorkers()
      await this.atom.close().catch(() => {})
    }

    if (task === undefined || attempt === undefined) {
      if (failed !== null) throw failed
      throw new Error('crawl did not open a task')
    }

    const endedAt = new Date(this.clock.now()).toISOString()
    const persistedTask = await this.store.getTask(task.id)
    const cancelled = this.signal?.aborted === true || persistedCancellation || persistedTask?.status === 'cancelled'
    const interrupted = !cancelled && this.shutdownSignal?.aborted === true
    const status = cancelled ? 'cancelled' : interrupted ? 'paused' : failed !== null ? 'failed' : 'completed'
    const finishedAttempt: Attempt = {
      ...attempt,
      status: interrupted ? 'interrupted' : status === 'paused' ? 'interrupted' : status,
      endedAt,
      pagesFetched: pagesFetched + cachedPages,
      wallMs: this.clock.now() - startedAtMs,
       costUsd: costUnknown ? null : costUsd,
       costUnknown,
       contentTokens,
       contentTokensUnknown,
      budgetExceeded,
    }
    const finished: Task = { ...task, status, updatedAt: endedAt }
    try {
      await this.store.putAttempt(finishedAttempt)
    } catch (err) {
      if (failed === null) failed = err
    }
    try {
      await this.store.putTask(finished)
    } catch (err) {
      if (failed === null) failed = err
    }
    if (failed !== null && !cancelled && !interrupted) throw failed

    return reportFromTaskAttempt(finished, finishedAttempt, cachedPages)
  }

  private async openRun(spec: CrawlSpec, startedAt: string): Promise<{ task: Task; attempt: Attempt }> {
    if (spec.resumeFrom !== null) {
      const existing = await this.store.getTask(spec.resumeFrom)
      if (existing === null) throw new Error(`resume: unknown task ${spec.resumeFrom}`)
      if (existing.status === 'cancelled') throw new Error(`resume: task ${spec.resumeFrom} is cancelled`)
      const interruptedId = await this.interruptOpenAttempts(existing.id, startedAt)
      const task: Task = { ...existing, status: 'running', updatedAt: startedAt }
      await this.store.putTask(task)
      const attempt = newAttempt(this.newId(), task.id, startedAt, interruptedId)
      await this.store.putAttempt(attempt)
      return { task, attempt }
    }

    if (spec.taskId !== undefined) {
      const existing = await this.store.getTask(spec.taskId)
      if (existing === null) throw new Error(`unknown task ${spec.taskId}`)
      if (existing.status === 'cancelled') throw new Error(`task ${spec.taskId} is cancelled`)
      const interruptedId = await this.interruptOpenAttempts(existing.id, startedAt)
      const task: Task = { ...existing, status: 'running', updatedAt: startedAt }
      await this.store.putTask(task)
      const attempt = newAttempt(this.newId(), task.id, startedAt, interruptedId)
      await this.store.putAttempt(attempt)
      return { task, attempt }
    }

    const task: Task = {
      id: this.newId(),
      seedUrl: spec.seedUrl,
      taskDir: spec.taskDir,
      mode: spec.mode,
      status: 'running',
      budget: spec.budget,
      createdAt: startedAt,
      updatedAt: startedAt,
    }
    await this.store.putTask(task)
    const attempt = newAttempt(this.newId(), task.id, startedAt)
    await this.store.putAttempt(attempt)
    return { task, attempt }
  }

  private async interruptOpenAttempts(taskId: string, endedAt: string): Promise<string | null> {
    const prior = await this.store.listAttempts(taskId)
    let recoveredFrom: string | null = prior.filter(attempt => attempt.status === 'interrupted').at(-1)?.id ?? null
    for (const attempt of prior) {
      if (attempt.status !== 'running') continue
      const steps = await this.store.listSteps(taskId, attempt.id)
      await this.store.putAttempt({
        ...attempt,
        status: 'interrupted',
        endedAt,
        pagesFetched: steps.length,
        costUsd: attempt.costUnknown === true ? null : attempt.costUsd,
      })
      recoveredFrom = attempt.id
    }
    return recoveredFrom
  }

  private async restoreFrontier(frontier: Frontier, task: Task, spec: CrawlSpec): Promise<void> {
    if (spec.resumeFrom === null) {
      frontier.seed(task.seedUrl)
      return
    }
    const prior = await this.store.listSteps(task.id)
    const contentful = prior.filter((step) => step.result !== null && CONTENTFUL_STATUS.has(step.result.status))
    if (contentful.length === 0) {
      frontier.seed(task.seedUrl)
      return
    }
    for (const step of contentful) frontier.seed(step.url, step.depth)
    for (const step of contentful) {
      for (const href of linksOf(step.result!)) {
        frontier.enqueue(href, step.depth + 1, step.canonicalUrl)
      }
    }
  }
}

interface CrawlBudgetSpent {
  pages: number
  wallMs: number
  costUsd: number
  costUnknown: boolean
  tokens: number
  tokensUnknown: boolean
}

function budgetHit(budget: CrawlBudget, spent: CrawlBudgetSpent): BudgetKind | null {
  if (budget.maxPages !== null && spent.pages >= budget.maxPages) return 'pages'
  if (budget.maxWallMs !== null && spent.wallMs >= budget.maxWallMs) return 'time'
  if (budget.maxCostUsd !== null && spent.costUnknown) return 'cost_unknown'
  if (budget.maxCostUsd !== null && spent.costUsd >= budget.maxCostUsd) return 'cost'
  if (budget.maxTokens !== null && spent.tokensUnknown) return 'tokens_unknown'
  if (budget.maxTokens !== null && spent.tokens >= budget.maxTokens) return 'tokens'
  return null
}

function linksOf(result: FetchResult): readonly string[] {
  return result.links ?? []
}

function newAttempt(id: string, taskId: string, startedAt: string, recoveredFromAttemptId: string | null = null): Attempt {
  return {
    id,
    taskId,
    status: 'running',
    startedAt,
    endedAt: null,
    pagesFetched: 0,
    wallMs: 0,
    costUsd: null,
    costUnknown: true,
    contentTokens: 0,
    contentTokensUnknown: false,
    budgetExceeded: null,
    recoveredFromAttemptId,
  }
}

function duplicateResult(url: string, prior: FetchResult, firstCanonicalUrl: string): FetchResult {
  return {
    ...prior,
    requestedUrl: url,
    status: 'duplicate',
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    markdown: null,
    links: [],
    usage: {
      ...EMPTY_USAGE,
      wallMs: prior.usage.wallMs,
      bytesWire: prior.usage.bytesWire,
      bytesDecompressed: prior.usage.bytesDecompressed,
      requestCount: prior.usage.requestCount,
      attemptCount: prior.usage.attemptCount,
      browserMs: prior.usage.browserMs,
      externalCostUsd: prior.usage.externalCostUsd,
    },
    trace: [
      ...prior.trace,
      {
        at: prior.usage.wallMs,
        lane: prior.lane,
        event: 'duplicate_content',
        detail: { firstCanonicalUrl, rawBodySha256: prior.evidence.rawBodySha256 },
      },
    ],
  }
}
