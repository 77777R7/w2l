/**
 * Crawl orchestrator: compose scrapes over a frontier and checkpoint.
 *
 * Never opens Playwright. A page is one ScrapeAtom.scrape(url).
 * Resume restores frontier membership from prior steps. Default is refetch;
 * --use-cached is the only skip-fetch path.
 *
 * Loop stop this slice: the same rawBodySha256 on two distinct canonical
 * URLs. DOM-fingerprint N is out of scope.
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
import { reportFromTaskAttempt } from './crawlReport.js'
import { Frontier } from './frontier.js'
import type { TaskStore } from './taskStore.js'

export interface CrawlClock {
  now(): number
  wait(ms: number): Promise<void>
}

export const systemClock: CrawlClock = {
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface OrchestratorOptions {
  store: TaskStore
  atom: ScrapeAtom
  clock?: CrawlClock
  newId?: () => string
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

  constructor(options: OrchestratorOptions) {
    this.store = options.store
    this.atom = options.atom
    this.clock = options.clock ?? systemClock
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  async run(partial: Pick<CrawlSpec, 'seedUrl' | 'taskDir'> & Partial<CrawlSpec>): Promise<CrawlReport> {
    const spec: CrawlSpec = { ...DEFAULT_CRAWL_SPEC, ...partial }
    const startedAtMs = this.clock.now()
    const startedAt = new Date(startedAtMs).toISOString()

    const { task, attempt } = await this.openRun(spec, startedAt)
    const frontier = new Frontier({
      seedUrl: task.seedUrl,
      maxDepth: spec.maxDepth,
      allowlistedDomains: spec.allowlistedDomains,
    })
    await this.restoreFrontier(frontier, task, spec)

    const seenHash = new Map<string, string>()
    let pagesFetched = 0
    let cachedPages = 0
    let costUsd = 0
    let contentTokens = 0
    let budgetExceeded: BudgetKind | null = null
    let loopDetected = false

    try {
      for (;;) {
        const now = this.clock.now()
        const spent: CrawlBudgetSpent = {
          pages: pagesFetched + cachedPages,
          wallMs: now - startedAtMs,
          costUsd,
          tokens: contentTokens,
        }
        const hit = budgetHit(spec.budget, spent)
        if (hit !== null) {
          budgetExceeded = hit
          break
        }

        const next = frontier.dequeue(now)
        if (next.item === null) {
          if (next.nextReadyAtMs === null) break
          const remainingWait = Math.max(0, next.nextReadyAtMs - now)
          if (spec.budget.maxWallMs !== null && spent.wallMs + remainingWait >= spec.budget.maxWallMs) {
            budgetExceeded = 'time'
            break
          }
          await this.clock.wait(remainingWait)
          continue
        }

        const item = next.item
        try {
          const cached = spec.useCached
            ? await this.store.getStepByCanonicalUrl(task.id, item.canonicalUrl)
            : null
          const reusable = cached !== null && cached.result !== null && CONTENTFUL_STATUS.has(cached.result.status)

          let result: FetchResult
          let links: readonly string[]
          let cachedPage = false
          if (reusable && cached.result !== null) {
            result = cached.result
            links = linksOf(cached.result)
            cachedPage = true
          } else {
            const outcome = await this.atom.scrape(item.url)
            result = outcome.result
            links = outcome.links.length > 0 ? outcome.links : linksOf(outcome.result)
          }

          const hash = result.evidence.rawBodySha256
          if (hash !== null && CONTENTFUL_STATUS.has(result.status)) {
            const prior = seenHash.get(hash)
            if (prior !== undefined && prior !== item.canonicalUrl) {
              result = loopResult(item.url, result)
              links = []
              loopDetected = true
            } else {
              seenHash.set(hash, item.canonicalUrl)
            }
          }

          const at = new Date(this.clock.now()).toISOString()
          const step: StepRecord = {
            id: this.newId(),
            taskId: task.id,
            attemptId: attempt.id,
            url: item.url,
            canonicalUrl: item.canonicalUrl,
            depth: item.depth,
            status: stepStatusFromResult(result.status),
            lane: result.lane,
            contentHash: hash,
            cached: cachedPage,
            result,
            createdAt: at,
            updatedAt: at,
          }
          await this.store.putStep(step)

          if (cachedPage) cachedPages += 1
          else pagesFetched += 1
          costUsd += result.usage.externalCostUsd ?? 0
          contentTokens += result.usage.contentTokens ?? 0

          if (CONTENTFUL_STATUS.has(result.status)) {
            for (const href of links) frontier.enqueue(href, item.depth + 1, item.canonicalUrl)
          }

          if (loopDetected) break
        } finally {
          frontier.release(item.canonicalUrl)
        }
      }
    } finally {
      await this.atom.close().catch(() => {})
    }

    const endedAt = new Date(this.clock.now()).toISOString()
    const status = loopDetected ? 'failed' : 'completed'
    await this.store.putAttempt({
      ...attempt,
      status: loopDetected ? 'failed' : 'completed',
      endedAt,
      pagesFetched: pagesFetched + cachedPages,
      wallMs: this.clock.now() - startedAtMs,
      costUsd,
      contentTokens,
      budgetExceeded,
    })
    const finished: Task = { ...task, status, updatedAt: endedAt }
    await this.store.putTask(finished)

    return reportFromTaskAttempt(
      finished,
      {
        ...attempt,
        status: loopDetected ? 'failed' : 'completed',
        endedAt,
        pagesFetched: pagesFetched + cachedPages,
        wallMs: this.clock.now() - startedAtMs,
        costUsd,
        contentTokens,
        budgetExceeded,
      },
      cachedPages,
    )
  }

  private async openRun(spec: CrawlSpec, startedAt: string): Promise<{ task: Task; attempt: Attempt }> {
    if (spec.resumeFrom !== null) {
      const existing = await this.store.getTask(spec.resumeFrom)
      if (existing === null) throw new Error(`resume: unknown task ${spec.resumeFrom}`)
      const task: Task = { ...existing, status: 'running', updatedAt: startedAt }
      await this.store.putTask(task)
      const attempt = newAttempt(this.newId(), task.id, startedAt)
      await this.store.putAttempt(attempt)
      return { task, attempt }
    }

    if (spec.taskId !== undefined) {
      const existing = await this.store.getTask(spec.taskId)
      if (existing === null) throw new Error(`unknown task ${spec.taskId}`)
      const task: Task = { ...existing, status: 'running', updatedAt: startedAt }
      await this.store.putTask(task)
      const attempt = newAttempt(this.newId(), task.id, startedAt)
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

  private async restoreFrontier(frontier: Frontier, task: Task, spec: CrawlSpec): Promise<void> {
    if (spec.resumeFrom === null) {
      frontier.seed(task.seedUrl)
      return
    }
    const prior = await this.store.listSteps(task.id)
    const contentful = prior.filter((step) => step.result !== null && CONTENTFUL_STATUS.has(step.result.status))
    if (!spec.useCached) {
      for (const step of contentful) frontier.seed(step.url, step.depth)
      for (const step of contentful) {
        for (const href of linksOf(step.result!)) {
          frontier.enqueue(href, step.depth + 1, step.canonicalUrl)
        }
      }
      return
    }
    for (const step of contentful) frontier.seed(step.url, step.depth)
    for (const step of contentful) {
      for (const href of linksOf(step.result!)) {
        frontier.enqueue(href, step.depth + 1, step.canonicalUrl)
      }
    }
    if (contentful.length === 0) frontier.seed(task.seedUrl)
  }
}

interface CrawlBudgetSpent {
  pages: number
  wallMs: number
  costUsd: number
  tokens: number
}

function budgetHit(budget: CrawlBudget, spent: CrawlBudgetSpent): BudgetKind | null {
  if (budget.maxPages !== null && spent.pages >= budget.maxPages) return 'pages'
  if (budget.maxWallMs !== null && spent.wallMs >= budget.maxWallMs) return 'time'
  if (budget.maxCostUsd !== null && spent.costUsd >= budget.maxCostUsd) return 'cost'
  if (budget.maxTokens !== null && spent.tokens >= budget.maxTokens) return 'tokens'
  return null
}

function linksOf(result: FetchResult): readonly string[] {
  return result.links ?? []
}

function newAttempt(id: string, taskId: string, startedAt: string): Attempt {
  return {
    id,
    taskId,
    status: 'running',
    startedAt,
    endedAt: null,
    pagesFetched: 0,
    wallMs: 0,
    costUsd: 0,
    contentTokens: 0,
    budgetExceeded: null,
  }
}

function loopResult(url: string, prior: FetchResult): FetchResult {
  return {
    ...prior,
    requestedUrl: url,
    status: 'failed',
    failureReason: 'loop_detected',
    blockReason: null,
    budgetExceeded: null,
    markdown: null,
    links: [],
    usage: { ...EMPTY_USAGE, wallMs: prior.usage.wallMs, requestCount: prior.usage.requestCount, attemptCount: prior.usage.attemptCount },
  }
}
