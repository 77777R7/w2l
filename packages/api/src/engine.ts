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
  ResilientHttpSubject,
  type Channel,
} from '@w2l/bench'
import {
  defaultApiMode,
  localNetworkPolicy,
  type CrawlAccepted,
  type CrawlError,
  type CrawlPage,
  type CrawlPageList,
  type CrawlReport,
  type CrawlStartRequest,
  type FetchResult,
  type NetworkPolicy,
  type ScrapeRequest,
  type StepRecord,
  type Task,
  type LadderRunAudit,
  type CrawlPageQuery,
  type ExecutionContext,
  type DeliveryDestinationInput,
  type DeliveryDestination,
  type DeliveryQuery,
  type WebhookDelivery,
  type DeliveryDetail,
} from '@w2l/contracts'
import { createExecutionScope, type CrawlPolicy } from '@w2l/http-core'
import { CrawlOrchestrator, crawlReportFromStore, SqliteTaskStore, type StepPageQuery } from '@w2l/runtime'
import { initializeFirecrawlMonitor, runFirecrawlMonitor as executeMonitor, runConfiguredMonitor } from '@w2l/runtime'
import { MonitorStore, DeliveryStore } from '@w2l/runtime'
import { FileSessionBrokerStore, SessionBroker } from '@w2l/bench'
import { FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, type MonitorView, type MonitorRevision } from '@w2l/contracts'
import type { ManagedSessionRef, SessionAccessResult } from '@w2l/contracts'

export interface CrawlWithSteps {
  report: CrawlReport
  steps: readonly StepRecord[]
}

export interface ApiEngine {
  scrape(req: ScrapeRequest, context?: ExecutionContext): Promise<FetchResult & LadderRunAudit>
  startCrawl(req: CrawlStartRequest): Promise<CrawlAccepted>
  getCrawl(taskId: string): Promise<CrawlReport | null>
  getCrawlWithSteps(taskId: string): Promise<CrawlWithSteps | null>
  getCrawlPages(taskId: string, query?: CrawlPageQuery): Promise<CrawlPageList<CrawlPage> | null>
  getCrawlErrors(taskId: string, query?: CrawlPageQuery): Promise<CrawlPageList<CrawlError> | null>
  cancelCrawl(taskId: string): Promise<CrawlReport | null>
  runFirecrawlMonitor(triggerKey?: string, context?: ExecutionContext): Promise<MonitorView>
  getFirecrawlMonitor(): Promise<MonitorView>
  configureMonitor(revision: MonitorRevision): MonitorRevision
  getMonitor(id: string): MonitorView | null
  listMonitors(): MonitorView[]
  runMonitor(id: string, triggerKey?: string, context?: ExecutionContext): Promise<MonitorView>
  cancelMonitorRun(id: string, runId: string): MonitorView
  setMonitorEnabled(id: string, enabled: boolean): MonitorView
  createDeliveryDestination(input: DeliveryDestinationInput): DeliveryDestination
  listDeliveryDestinations(monitorId?: string): DeliveryDestination[]
  setDeliveryDestinationEnabled(id: string, enabled: boolean): DeliveryDestination
  listDeliveries(query?: DeliveryQuery): WebhookDelivery[]
  getDelivery(id: string): DeliveryDetail | null
  retryDelivery(id: string): WebhookDelivery
  createManagedSession(input: { workspaceId: string; accountRef: string; originScope: string; expiresAt?: string | null }): Promise<ManagedSessionRef>
  authorizeManagedSession(sessionRef: string, accountRef: string): Promise<ManagedSessionRef>
  revokeManagedSession(sessionRef: string): Promise<void>
  getManagedSession(sessionRef: string): Promise<ManagedSessionRef>
  renewManagedSession(sessionRef: string, expiresAt?: string | null): Promise<ManagedSessionRef>
  requestManagedHandoff(sessionRef: string, reason: string, expiresAt?: string | null): Promise<ManagedSessionRef>
  captureManagedSession(input: { sessionRef: string; workspaceId: string; accountRef: string; url: string }): Promise<FetchResult | SessionAccessResult>
  close(options?: {cancelActive?: boolean}): Promise<void>
}

export interface ApiEngineOptions {
  taskRoot?: string
  monitorLeaseMs?: number
  monitorAttemptTimeoutMs?: number
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
  const monitorStore = MonitorStore.open(join(taskRoot, 'section-b-control.sqlite'), {leaseMs: options.monitorLeaseMs, attemptTimeoutMs: options.monitorAttemptTimeoutMs})
  const deliveryStore = DeliveryStore.open(join(taskRoot, 'section-b-control.sqlite'))
  const shutdownController = new AbortController()
  const monitorControllers = new Map<string, Set<AbortController>>()
  const sessionBroker = new SessionBroker(new FileSessionBrokerStore(join(taskRoot, 'b3-sessions.json')))
  const headed = options.headed === true
  const networkPolicy = options.networkPolicy ?? localNetworkPolicy()
  const conditionalHttp = new ResilientHttpSubject('standard', networkPolicy)
  const defaultMaxPages = options.defaultMaxPages ?? null
  const inflight = new Map<string, Promise<void>>()
  const activeScrapes = new Set<Promise<unknown>>()
  const crawlControllers = new Map<string, AbortController>()
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

  async function loadCrawlPageList(taskId: string, query: CrawlPageQuery | undefined, kind: StepPageQuery['kind']): Promise<CrawlPageList<CrawlPage> | null> {
    if (!existsSync(join(taskRoot, taskId))) return null
    const store = SqliteTaskStore.openReadOnly(join(taskRoot, taskId))
    try {
      const report = await crawlReportFromStore(store, taskId)
      if (report === null) return null
      const page = await store.listStepsPage(taskId, {
        attemptId: query?.attemptId ?? (report.attemptId.length > 0 ? report.attemptId : undefined),
        cursor: query?.cursor,
        limit: query?.limit ?? 50,
        kind,
      })
      return {
        items: page.steps.map((step) => toCrawlPage(step)),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      }
    } finally {
      await store.close()
    }
  }

  return {
    async scrape(req, context = {}) {
      const scope = createExecutionScope({...context, signal: context.signal ? AbortSignal.any([context.signal, shutdownController.signal]) : shutdownController.signal, deadlineAt: context.deadlineAt ?? Date.now() + 300_000})
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
        const run = await runner.run(req.url, undefined, scope)
        return {
          ...run.result,
          channelsTried: run.channelsTried,
          ladderTrace: run.ladderTrace,
          summary: run.summary,
        }
      })()
      activeScrapes.add(operation)
      try { return await operation } finally { activeScrapes.delete(operation); scope.dispose() }
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
        shutdownSignal: shutdownController.signal,
        signal: (() => {
          const controller = new AbortController()
          crawlControllers.set(taskId, controller)
          return controller.signal
        })(),
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
          crawlControllers.delete(taskId)
           await store.close()
        })
        .catch(async () => {
          inflight.delete(taskId)
          crawlControllers.delete(taskId)
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

    getCrawlPages: (taskId, query) => loadCrawlPageList(taskId, query, 'pages'),

    getCrawlErrors: async (taskId, query) => {
      const page = await loadCrawlPageList(taskId, query, 'errors')
      if (page === null) return null
      return page
    },

    async cancelCrawl(taskId) {
      if (!existsSync(join(taskRoot, taskId))) return null
      const store = SqliteTaskStore.open(join(taskRoot, taskId))
      try {
        const task = await store.getTask(taskId)
        if (task === null) return null
        if (task.status === 'pending' || task.status === 'running' || task.status === 'paused') {
          const now = new Date().toISOString()
          await store.putTask({ ...task, status: 'cancelled', updatedAt: now })
          const attempts = await store.listAttempts(taskId)
          const latest = attempts[attempts.length - 1]
          if (latest?.status === 'running') await store.putAttempt({ ...latest, status: 'cancelled', endedAt: now })
          crawlControllers.get(taskId)?.abort()
        }
      } finally {
        await store.close()
      }
      return (await loadCrawlWithSteps(taskId))?.report ?? null
    },

    async runFirecrawlMonitor(triggerKey, context) {
      initializeFirecrawlMonitor(monitorStore)
      return this.runMonitor(FIRECRAWL_MONITOR_ID, triggerKey, context)
    },
    async getFirecrawlMonitor() {
      initializeFirecrawlMonitor(monitorStore)
      return monitorStore.view(FIRECRAWL_MONITOR_ID, Date.now())
    },
    configureMonitor(revision) { return monitorStore.createOrGetRevision(revision) },
    getMonitor(id) { return monitorStore.hasMonitor(id) ? monitorStore.view(id, Date.now()) : null },
    listMonitors() { return monitorStore.listMonitorIds().map((id) => monitorStore.view(id, Date.now())) },
    async runMonitor(id, triggerKey, context = {}) {
      const revision = monitorStore.getRevision(id)
      const controller = new AbortController()
      const controllers = monitorControllers.get(id) ?? new Set<AbortController>()
      controllers.add(controller); monitorControllers.set(id, controllers)
      const signal = AbortSignal.any([controller.signal, shutdownController.signal, ...(context.signal ? [context.signal] : [])])
      const operation = runConfiguredMonitor(monitorStore, revision, async (capture) => {
        if (capture.captureMode === 'http') {
          const result = await conditionalHttp.fetch(revision.url, capture.deadlineAt, capture.signal, capture, capture.onRetryAfter)
          return {result, links: result.links ?? []}
        }
        const result = await this.scrape({url: revision.url}, capture)
        return {result, links: result.links ?? [], audit: {channelsTried: result.channelsTried, ladderTrace: result.ladderTrace, summary: result.summary}}
      }, triggerKey, {...context, signal})
      activeScrapes.add(operation)
      try { return await operation } finally {
        activeScrapes.delete(operation); controllers.delete(controller)
        if (!controllers.size) monitorControllers.delete(id)
      }
    },
    cancelMonitorRun(id, runId) {
      const view = monitorStore.cancel(id, runId)
      // Only abort live work when the cancelled run is the currently active one.
      if (!view.runs.some(run => run.state === 'running')) for (const controller of monitorControllers.get(id) ?? []) controller.abort()
      return view
    },
    setMonitorEnabled(id, enabled) {
      const view = monitorStore.setEnabled(id, enabled)
      if (!enabled) for (const controller of monitorControllers.get(id) ?? []) controller.abort()
      return view
    },
    createDeliveryDestination(input) {
      return monitorStore.registerDestination(input)
    },
    listDeliveryDestinations: (id) => deliveryStore.listDestinations(id),
    setDeliveryDestinationEnabled: (id, enabled) => deliveryStore.setDestinationEnabled(id, enabled),
    listDeliveries: (query) => deliveryStore.listDeliveries(query),
    getDelivery(id) { const delivery = deliveryStore.getDelivery(id); return delivery ? {delivery, attempts: deliveryStore.attempts(id)} : null },
    retryDelivery: (id) => deliveryStore.replayDeadLetter(id),

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

    async close(options = {}) {
      if (options.cancelActive) {
        shutdownController.abort(new DOMException('service shutdown', 'ShutdownError'))
      }
      await Promise.all([...inflight.values()].map((job) => job.catch(() => {})))
      await Promise.all([...activeScrapes].map((job) => job.catch(() => {})))
      await Promise.all([...channelsByMode.values()].flatMap((channels) => channels.map((channel) => channel.close?.().catch(() => {}))))
      channelsByMode.clear()
      crawlControllers.clear()
      monitorStore.close()
      deliveryStore.close()
    },
  }
}

function toCrawlPage(step: StepRecord): CrawlPage {
  const result = step.result
  return {
    id: step.id,
    url: step.url,
    canonicalUrl: step.canonicalUrl,
    depth: step.depth,
    status: step.status,
    lane: step.lane,
    markdown: result?.markdown ?? null,
    failureReason: result?.failureReason ?? null,
    blockReason: result?.blockReason ?? null,
    budgetExceeded: result?.budgetExceeded ?? null,
    evidence: result?.evidence ?? null,
    trace: result?.trace ?? [],
    audit: step.audit,
    cached: step.cached,
    contentHash: step.contentHash,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
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
