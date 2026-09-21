/**
 * Product engine behind the REST surface. One scrape is LadderRunner.
 * One crawl is CrawlOrchestrator. No second fetcher.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildChannels,
  BrowserLocalSubject,
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
import { initializeFirecrawlMonitor, runFirecrawlMonitor as executeMonitor } from '@w2l/runtime'
import { MonitorStore } from '@w2l/runtime'
import { FileSessionBrokerStore, SessionBroker } from '@w2l/bench'
import { FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, type MonitorView } from '@w2l/contracts'
import type { ManagedSessionRef, SessionAccessResult } from '@w2l/contracts'

export interface CrawlWithSteps {
  report: CrawlReport
  steps: readonly StepRecord[]
}

export interface ApiEngine {
  scrape(req: ScrapeRequest): Promise<FetchResult & LadderRunAudit>
  startCrawl(req: CrawlStartRequest): Promise<CrawlAccepted>
  getCrawl(taskId: string): Promise<CrawlReport | null>
  getCrawlWithSteps(taskId: string): Promise<CrawlWithSteps | null>
  runFirecrawlMonitor(triggerKey?: string): Promise<MonitorView>
  getFirecrawlMonitor(): Promise<MonitorView>
  createManagedSession(input: { workspaceId: string; accountRef: string; originScope: string; expiresAt?: string | null }): Promise<ManagedSessionRef>
  authorizeManagedSession(sessionRef: string, accountRef: string): Promise<ManagedSessionRef>
  revokeManagedSession(sessionRef: string): Promise<void>
  getManagedSession(sessionRef: string): Promise<ManagedSessionRef>
  renewManagedSession(sessionRef: string, expiresAt?: string | null): Promise<ManagedSessionRef>
  requestManagedHandoff(sessionRef: string, reason: string, expiresAt?: string | null): Promise<ManagedSessionRef>
  captureManagedSession(input: { sessionRef: string; workspaceId: string; accountRef: string; url: string }): Promise<FetchResult | SessionAccessResult>
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
  const monitorStore = MonitorStore.open(join(taskRoot, 'section-b-control.sqlite'))
  const sessionBroker = new SessionBroker(new FileSessionBrokerStore(join(taskRoot, 'b3-sessions.json')))
  const headed = options.headed === true
  const networkPolicy = options.networkPolicy ?? localNetworkPolicy()
  const defaultMaxPages = options.defaultMaxPages ?? null
  const inflight = new Map<string, Promise<void>>()
  const activeScrapes = new Set<Promise<unknown>>()
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
      const operation = (async () => {
        const run = await runner.run(req.url)
        return {
          ...run.result,
          channelsTried: run.channelsTried,
          ladderTrace: run.ladderTrace,
          summary: run.summary,
        }
      })()
      activeScrapes.add(operation)
      try { return await operation } finally { activeScrapes.delete(operation) }
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

    async runFirecrawlMonitor(triggerKey) {
      const operation = executeMonitor(monitorStore, async () => {
        const result = await this.scrape({ url: FIRECRAWL_INTRO_URL })
        return { result, links: result.links ?? [], audit: { channelsTried: result.channelsTried, ladderTrace: result.ladderTrace, summary: result.summary } }
      }, triggerKey)
      activeScrapes.add(operation)
      try { return await operation } finally { activeScrapes.delete(operation) }
    },

    async getFirecrawlMonitor() {
      initializeFirecrawlMonitor(monitorStore)
      return monitorStore.view(FIRECRAWL_MONITOR_ID, Date.now())
    },

    async createManagedSession(input) {
      const profileDir = join(taskRoot, 'profiles', crypto.randomUUID())
      return sessionBroker.createManagedSession({ ...input, profileDir })
    },

    async authorizeManagedSession(sessionRef, accountRef) {
      return sessionBroker.markAuthorized(sessionRef, accountRef)
    },

    async revokeManagedSession(sessionRef) {
      await sessionBroker.revoke(sessionRef)
    },

    async getManagedSession(sessionRef) { return sessionBroker.getSession(sessionRef) },

    async renewManagedSession(sessionRef, expiresAt) { return sessionBroker.renewExpired(sessionRef, expiresAt) },

    async requestManagedHandoff(sessionRef, reason, expiresAt) { return sessionBroker.requestHandoff(sessionRef, reason, expiresAt) },

    async captureManagedSession(input) {
      const access = await sessionBroker.grant({ ...input, origin: input.url })
      if (access.kind !== 'granted') return access
      const session = await sessionBrokerStoreGet(sessionBroker, input.sessionRef)
      const subject = new BrowserLocalSubject('standard', null, false, networkPolicy, session.profileDir)
      try { return await subject.fetch(input.url) } finally { await subject.teardown() }
    },

    async close() {
      await Promise.all([...inflight.values()].map((job) => job.catch(() => {})))
      await Promise.all([...activeScrapes].map((job) => job.catch(() => {})))
      await Promise.all([...channelsByMode.values()].flatMap((channels) => channels.map((channel) => channel.close?.().catch(() => {}))))
      channelsByMode.clear()
      monitorStore.close()
    },
  }
}

async function sessionBrokerStoreGet(broker: SessionBroker, sessionRef: string): Promise<ManagedSessionRef> {
  return broker.getSession(sessionRef)
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
