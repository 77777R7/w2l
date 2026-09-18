/**
 * Product engine behind the REST surface. One scrape is LadderRunner.
 * One crawl is CrawlOrchestrator. No second fetcher.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildChannels,
  LadderRunner,
  LadderScrapeAtom,
  MemoryRoutingHistory,
  type Channel,
} from '@w2l/bench'
import {
  defaultApiMode,
  localNetworkPolicy,
  type CrawlAccepted,
  type CrawlReport,
  type CrawlStartRequest,
  type FetchResult,
  type NetworkPolicy,
  type ScrapeRequest,
  type StepRecord,
  type Task,
  type LadderRunAudit,
} from '@w2l/contracts'
import type { CrawlPolicy } from '@w2l/http-core'
import { CrawlOrchestrator, crawlReportFromStore, SqliteTaskStore } from '@w2l/runtime'

export interface CrawlWithSteps {
  report: CrawlReport
  steps: readonly StepRecord[]
}

export interface ApiEngine {
  scrape(req: ScrapeRequest): Promise<FetchResult & LadderRunAudit>
  startCrawl(req: CrawlStartRequest): Promise<CrawlAccepted>
  getCrawl(taskId: string): Promise<CrawlReport | null>
  getCrawlWithSteps(taskId: string): Promise<CrawlWithSteps | null>
  close(): Promise<void>
}

export interface ApiEngineOptions {
  taskRoot?: string
  headed?: boolean
  networkPolicy?: NetworkPolicy
  /** Hosted crawl default when the request omits maxPages. Local stays unbounded. */
  defaultMaxPages?: number | null
  /** Test seam: override local ladder channels without changing fetch. */
  channelsFor?: (mode: 'standard' | 'research' | 'authed') => Channel[]
  workerCount?: number
  perHostConcurrency?: number
  perHostMinDelayMs?: number
  crawlDelayMsByHost?: ReadonlyMap<string, number>
}

export function createApiEngine(options: ApiEngineOptions = {}): ApiEngine {
  const taskRoot = options.taskRoot ?? '.w2l/api'
  const headed = options.headed === true
  const networkPolicy = options.networkPolicy ?? localNetworkPolicy()
  const defaultMaxPages = options.defaultMaxPages ?? null
  const inflight = new Map<string, Promise<void>>()
  const createChannels =
    options.channelsFor ??
    ((mode: 'standard' | 'research' | 'authed') => buildChannels(mode, { headed, networkPolicy }))
  const channelsByMode = new Map<string, Channel[]>()
  const historiesByMode = new Map<string, MemoryRoutingHistory>()
  const channelsFor = (mode: 'standard' | 'research' | 'authed'): Channel[] => {
    const existing = channelsByMode.get(mode)
    if (existing !== undefined) return existing
    const channels = createChannels(mode)
    channelsByMode.set(mode, channels)
    return channels
  }
  const historyFor = (mode: string): MemoryRoutingHistory => {
    const existing = historiesByMode.get(mode)
    if (existing !== undefined) return existing
    const history = new MemoryRoutingHistory()
    historiesByMode.set(mode, history)
    return history
  }

  async function loadCrawlWithSteps(taskId: string): Promise<CrawlWithSteps | null> {
    if (!existsSync(join(taskRoot, taskId))) return null
    const store = SqliteTaskStore.openReadOnly(join(taskRoot, taskId))
    try {
      const report = await crawlReportFromStore(store, taskId)
      if (report === null) return null
      const steps =
        report.attemptId.length === 0 ? [] : await store.listSteps(taskId, report.attemptId)
      return { report, steps }
    } finally {
      await store.close()
    }
  }

  return {
    async scrape(req) {
      const mode = defaultApiMode(req.mode)
      const channels = channelsFor(mode)
      const policy: CrawlPolicy = {
        mode,
        ...(req.allowlistedDomains !== undefined && req.allowlistedDomains.length > 0
          ? { allowlistedDomains: req.allowlistedDomains }
          : {}),
      }
      const runner = new LadderRunner(channels, policy, historyFor(mode))
      try {
        const run = await runner.run(req.url)
        return {
          ...run.result,
          channelsTried: run.channelsTried,
          ladderTrace: run.ladderTrace,
          summary: run.summary,
        }
      } finally {
      }
    },

    async startCrawl(req) {
      const mode = defaultApiMode(req.mode)
      const taskId = crypto.randomUUID()
      const taskDir = join(taskRoot, taskId)
      mkdirSync(taskDir, { recursive: true })
      const store = SqliteTaskStore.open(taskDir)
      const now = new Date().toISOString()
      const task: Task = {
        id: taskId,
        seedUrl: req.url,
        taskDir,
        mode,
        status: 'pending',
        budget: {
          maxPages: req.maxPages === undefined ? defaultMaxPages : req.maxPages,
          maxWallMs: null,
          maxCostUsd: null,
          maxTokens: null,
        },
        createdAt: now,
        updatedAt: now,
      }
      await store.putTask(task)

      const channels = channelsFor(mode)
      const policy: CrawlPolicy = {
        mode,
        ...(req.allowlistedDomains !== undefined && req.allowlistedDomains.length > 0
          ? { allowlistedDomains: req.allowlistedDomains }
          : {}),
      }
      const runner = new LadderRunner(channels, policy, historyFor(mode))
      const atom = new LadderScrapeAtom(runner)
      const orchestrator = new CrawlOrchestrator({
        store,
        atom,
        workerCount: options.workerCount,
        perHostConcurrency: options.perHostConcurrency,
        perHostMinDelayMs: options.perHostMinDelayMs,
        crawlDelayMsByHost: options.crawlDelayMsByHost,
      })
      const job = orchestrator
        .run({
          seedUrl: req.url,
          taskDir,
          mode,
          budget: task.budget,
          maxDepth: req.maxDepth === undefined ? null : req.maxDepth,
          allowlistedDomains: req.allowlistedDomains ?? [],
          resumeFrom: null,
          useCached: req.useCached === true,
          taskId,
        })
        .then(async () => {
          inflight.delete(taskId)
           await store.close()
        })
        .catch(async () => {
          inflight.delete(taskId)
          await markCrawlFailed(store, taskId)
           await store.close()
        })
      inflight.set(taskId, job)
      return { taskId }
    },

    async getCrawl(taskId) {
      const detail = await loadCrawlWithSteps(taskId)
      return detail?.report ?? null
    },

    getCrawlWithSteps: loadCrawlWithSteps,

    async close() {
      await Promise.all([...inflight.values()].map((job) => job.catch(() => {})))
      await Promise.all([...channelsByMode.values()].flatMap((channels) => channels.map((channel) => channel.close?.().catch(() => {}))))
      channelsByMode.clear()
    },
  }
}

async function markCrawlFailed(store: SqliteTaskStore, taskId: string): Promise<void> {
  const now = new Date().toISOString()
  try {
    const existing = await store.getTask(taskId)
    if (existing !== null && (existing.status === 'pending' || existing.status === 'running' || existing.status === 'paused')) {
      await store.putTask({ ...existing, status: 'failed', updatedAt: now })
    }
    const attempts = await store.listAttempts(taskId)
    const latest = attempts[attempts.length - 1]
    if (latest !== undefined && latest.status === 'running') {
      await store.putAttempt({ ...latest, status: 'failed', endedAt: now })
    }
  } catch {}
}
