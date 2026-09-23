/**
 * Product engine behind the REST surface. One scrape is LadderRunner.
 * One crawl is CrawlOrchestrator. No second fetcher.
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildChannels,
  BrowserLocalSubject,
  LadderRunner,
  LadderScrapeAtom,
  MemoryRoutingHistory,
  ResilientHttpSubject,
  OriginScheduler,
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
  type BatchStartRequest,
  type BatchStatusResponse,
  RequestError,
  type FetchResult,
  type NetworkPolicy,
  type ScrapeRequest,
  type StepRecord,
  type Task,
  type CrawlPageQuery,
  type ExecutionContext,
  type CompactScrapeResponse,
  type ScrapeResponse,
  type ScrapeAtom,
  type DeliveryDestinationInput,
  type DeliveryDestination,
  type DeliveryQuery,
  type WebhookDelivery,
  type DeliveryDetail,
  type DeliveryPage,
  type DeliveryPageQuery,
  type MonitorPreview,
  type MonitorRun,
  type MonitorRunDetail,
} from '@w2l/contracts'
import { createExecutionScope, type CrawlPolicy } from '@w2l/http-core'
import { CrawlOrchestrator, canonicalizeUrl, crawlReportFromStore, reportFromTaskAttempt, SqliteTaskStore, type StepPageQuery } from '@w2l/runtime'
import { initializeFirecrawlMonitor, runFirecrawlMonitor as executeMonitor, runConfiguredMonitor } from '@w2l/runtime'
import { MonitorStore, DeliveryStore, assessConfiguredDocument, assessFirecrawlIntroduction } from '@w2l/runtime'
import { FileSessionBrokerStore, SessionBroker } from '@w2l/bench'
import { FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, type MonitorView, type MonitorRevision } from '@w2l/contracts'
import type { ManagedSessionRef, SessionAccessResult } from '@w2l/contracts'
import { extractStructured, prepareScrapeResponse, structuredModelConfigFromEnv } from './structured.js'

export interface CrawlWithSteps {
  report: CrawlReport
  steps: readonly StepRecord[]
}

export interface ApiEngine {
  scrape(req: ScrapeRequest, context?: ExecutionContext): Promise<ScrapeResponse | CompactScrapeResponse>
  startCrawl(req: CrawlStartRequest): Promise<CrawlAccepted>
  startBatch(req: BatchStartRequest): Promise<CrawlAccepted>
  getBatch(taskId: string): Promise<BatchStatusResponse | null>
  getBatchItems(taskId: string, query?: CrawlPageQuery): Promise<CrawlPageList<CrawlPage> | null>
  cancelBatch(taskId: string): Promise<BatchStatusResponse | null>
  getCrawl(taskId: string): Promise<CrawlReport | null>
  getCrawlWithSteps(taskId: string): Promise<CrawlWithSteps | null>
  getCrawlPages(taskId: string, query?: CrawlPageQuery): Promise<CrawlPageList<CrawlPage> | null>
  getCrawlErrors(taskId: string, query?: CrawlPageQuery): Promise<CrawlPageList<CrawlError> | null>
  cancelCrawl(taskId: string): Promise<CrawlReport | null>
  runFirecrawlMonitor(triggerKey?: string, context?: ExecutionContext): Promise<MonitorView>
  getFirecrawlMonitor(): Promise<MonitorView>
  configureMonitor(revision: MonitorRevision, initialEnabled?: boolean): MonitorRevision
  previewMonitor(revision: MonitorRevision, context?: ExecutionContext): Promise<MonitorPreview>
  getMonitor(id: string): MonitorView | null
  getMonitorRun(id: string, runId: string): MonitorRunDetail | null
  listMonitors(): MonitorView[]
  enqueueMonitorRun(id: string, triggerKey?: string): MonitorRun
  runMonitor(id: string, triggerKey?: string, context?: ExecutionContext): Promise<MonitorView>
  cancelMonitorRun(id: string, runId: string): MonitorView
  setMonitorEnabled(id: string, enabled: boolean): MonitorView
  createDeliveryDestination(input: DeliveryDestinationInput): DeliveryDestination
  listDeliveryDestinations(monitorId?: string): DeliveryDestination[]
  setDeliveryDestinationEnabled(id: string, enabled: boolean): DeliveryDestination
  listDeliveries(query?: DeliveryQuery): WebhookDelivery[]
  getDeliveriesPage(query?: DeliveryPageQuery): DeliveryPage
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
  /** Restrict a hosted public-document pilot to the HTTP rung. */
  httpOnly?: boolean
  /** Server-owned acquisition rule; callers cannot disable it per request. */
  channelPolicy?: (url: string) => 'ladder' | 'http_only' | 'browser_only'
  /** Operator-created anonymous marketplace state, scoped by BrowserLocalSubject. */
  publicPreferenceState?: string | null
  browserAllowedHosts?: readonly string[]
  /** Hosted single-owner resource ceiling; absent locally for compatibility. */
  maxActiveBatches?: number
  batchMaxWallMs?: number | null
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
  const networkPolicy: NetworkPolicy = {
    ...(options.networkPolicy ?? localNetworkPolicy()),
    ...(options.perHostConcurrency === undefined ? {} : { perHostConcurrency: options.perHostConcurrency }),
    ...(options.perHostMinDelayMs === undefined ? {} : { perHostMinDelayMs: options.perHostMinDelayMs }),
  }
  const originScheduler = new OriginScheduler(networkPolicy)
  const conditionalHttp = new ResilientHttpSubject('standard', networkPolicy, originScheduler)
  const defaultMaxPages = options.defaultMaxPages ?? null
  const inflight = new Map<string, Promise<void>>()
  let batchStartInProgress = false
  const activeScrapes = new Set<Promise<unknown>>()
  const crawlControllers = new Map<string, AbortController>()
  const createChannels =
    options.channelsFor ??
    ((mode: 'standard' | 'research' | 'authed') => {
      const channels = buildChannels(mode, { headed, networkPolicy, originScheduler, publicPreferenceState:options.publicPreferenceState, browserAllowedHosts:options.browserAllowedHosts })
      return options.httpOnly ? channels.filter(channel => channel.id === 'http') : channels
    })
  const channelsByMode = new Map<string, Channel[]>()
  const historiesByMode = new Map<string, MemoryRoutingHistory>()
  const channelsFor = (mode: 'standard' | 'research' | 'authed'): Channel[] => {
    const existing = channelsByMode.get(mode)
    if (existing !== undefined) return existing
    const channels = createChannels(mode)
    channelsByMode.set(mode, channels)
    return channels
  }
  const channelsForUrl = (mode: 'standard' | 'research' | 'authed', url: string): Channel[] => {
    const channels = channelsFor(mode)
    const policy = options.channelPolicy?.(url) ?? 'ladder'
    const selected = policy === 'ladder' ? channels : channels.filter(channel => channel.id === (policy === 'http_only' ? 'http' : 'browser_local'))
    if (selected.length === 0) throw new RequestError(`capture channel unavailable for ${policy}`)
    return selected
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

  async function activeBatchCount(): Promise<number> {
    let count = 0
    for (const name of existsSync(taskRoot) ? readdirSync(taskRoot) : []) {
      if (!existsSync(join(taskRoot, name, 'checkpoint.sqlite'))) continue
      const store = SqliteTaskStore.openReadOnly(join(taskRoot, name))
      try {
        const task = await store.getTask(name)
        if (task?.batch && ['pending', 'running', 'paused'].includes(task.status)) count++
      } finally { await store.close() }
    }
    return count
  }

  async function loadCrawlPageList(taskId: string, query: CrawlPageQuery | undefined, kind: StepPageQuery['kind'], allAttempts = false): Promise<CrawlPageList<CrawlPage> | null> {
    if (!existsSync(join(taskRoot, taskId))) return null
    const store = SqliteTaskStore.openReadOnly(join(taskRoot, taskId))
    try {
      const report = allAttempts ? null : await crawlReportFromStore(store, taskId)
      if (!allAttempts && report === null) return null
      if (allAttempts && await store.getTask(taskId) === null) return null
      const page = await store.listStepsPage(taskId, {
        attemptId: query?.attemptId ?? (!allAttempts && report !== null && report.attemptId.length > 0 ? report.attemptId : undefined),
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

  function launchTask(task: Task, store: SqliteTaskStore, req: { maxDepth: number | null; allowlistedDomains: readonly string[]; useCached: boolean; resume: boolean }): void {
    const mode = defaultApiMode(task.mode)
    const runner = new LadderRunner(channelsForUrl(mode, task.seedUrl), { mode, ...(req.allowlistedDomains.length ? { allowlistedDomains: req.allowlistedDomains } : {}) }, historyFor(mode))
    const ladder = new LadderScrapeAtom(runner)
    const atom: ScrapeAtom = task.batch === undefined ? ladder : {
      async scrape(url, context) {
        const outcome = await ladder.scrape(url, context)
        const formats = task.batch!.formats
        const wants = (name: 'markdown' | 'links' | 'json') => formats.some(format => typeof format === 'string' ? format === name : name === 'json')
        const custom = formats.find(format => typeof format === 'object')
        const json = wants('json') ? await extractStructured(outcome.result, custom, context ?? {}, structuredModelConfigFromEnv()) : undefined
        const audit = outcome.audit === undefined ? undefined : {
          ...outcome.audit,
          summary: {
            ...outcome.audit.summary,
            attempts: outcome.audit.summary.attempts.map(attempt => ({
              ...attempt,
              result: { ...attempt.result, markdown: null, links: [] },
            })),
          },
        }
        return { ...outcome, ...(audit === undefined ? {} : { audit }), result: {
          ...outcome.result,
          markdown: wants('markdown') ? outcome.result.markdown : null,
          links: wants('links') || task.batch!.includeLinks ? outcome.result.links : [],
          ...(json === undefined ? {} : { json }),
        } }
      },
      close: () => ladder.close(),
    }
    const controller = new AbortController()
    crawlControllers.set(task.id, controller)
    const orchestrator = new CrawlOrchestrator({
      store, atom,
      workerCount: options.workerCount,
      perHostConcurrency: Math.min(4, networkPolicy.perHostConcurrency),
      perHostMinDelayMs: networkPolicy.perHostMinDelayMs,
      crawlDelayMsByHost: options.crawlDelayMsByHost,
      shutdownSignal: shutdownController.signal,
      signal: controller.signal,
    })
    const job = orchestrator.run({
      seedUrl: task.seedUrl,
      ...(task.batch ? { seedUrls: task.batch.urls } : {}),
      taskDir: task.taskDir,
      mode,
      budget: task.budget,
      maxDepth: req.maxDepth,
      allowlistedDomains: req.allowlistedDomains,
      resumeFrom: req.resume ? task.id : null,
      useCached: req.useCached,
      taskId: task.id,
    }).then(async () => {
      inflight.delete(task.id); crawlControllers.delete(task.id)
      await store.close()
    }).catch(async () => {
      inflight.delete(task.id); crawlControllers.delete(task.id)
      await markCrawlFailed(store, task.id)
      await store.close()
    })
    inflight.set(task.id, job)
  }

  // A running batch has a durable URL list and per-URL checkpoints. Reopen it
  // after a process crash; completed steps are skipped by restoreFrontier.
  for (const name of existsSync(taskRoot) ? readdirSync(taskRoot) : []) {
    const taskDir = join(taskRoot, name)
    if (!existsSync(join(taskDir, 'checkpoint.sqlite'))) continue
    const store = SqliteTaskStore.open(taskDir)
    void store.getTask(name).then(task => {
      if (task?.batch && ['pending', 'running', 'paused'].includes(task.status)) {
        launchTask(task, store, { maxDepth: 0, allowlistedDomains: [...new Set(task.batch.urls.map(url => new URL(url).hostname))], useCached: false, resume: true })
      } else void store.close()
    }).catch(() => { void store.close() })
  }

  return {
    async scrape(req, context = {}) {
      const overallStart = performance.now()
      const scope = createExecutionScope({...context, signal: context.signal ? AbortSignal.any([context.signal, shutdownController.signal]) : shutdownController.signal, deadlineAt: context.deadlineAt ?? Date.now() + 300_000})
      const mode = defaultApiMode(req.mode)
      const channels = channelsForUrl(mode, req.url)
      const policy: CrawlPolicy = {
        mode,
        ...(req.allowlistedDomains !== undefined && req.allowlistedDomains.length > 0
          ? { allowlistedDomains: req.allowlistedDomains }
          : {}),
      }
      const runner = new LadderRunner(channels, policy, historyFor(mode))
      const operation = (async () => {
        const run = await runner.run(req.url, undefined, scope)
        const full: ScrapeResponse = {
          ...run.result,
          channelsTried: run.channelsTried,
          ladderTrace: run.ladderTrace,
          summary: run.summary,
        }
        return prepareScrapeResponse(full, req, scope, null, overallStart)
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
      launchTask(task, store, { maxDepth: req.maxDepth ?? null, allowlistedDomains: req.allowlistedDomains ?? [], useCached: req.useCached === true, resume: false })
      return { taskId }
    },

    async startBatch(req) {
      if (batchStartInProgress) throw new RequestError('another batch submission is in progress')
      batchStartInProgress = true
      try {
      if (options.maxActiveBatches !== undefined && await activeBatchCount() >= options.maxActiveBatches) {
        throw new RequestError('active batch limit reached')
      }
      const canonical = req.urls.map(url => canonicalizeUrl(url))
      if (canonical.some(url => url === null) || new Set(canonical).size !== canonical.length) throw new RequestError('urls must be unique after canonicalization')
      const taskId = crypto.randomUUID()
      const taskDir = join(taskRoot, taskId)
      const store = SqliteTaskStore.open(taskDir)
      const now = new Date().toISOString()
      const urls = [...req.urls]
      const task: Task = {
        id: taskId, seedUrl: urls[0]!, taskDir, mode: defaultApiMode(req.mode), status: 'pending',
        budget: { maxPages: null, maxWallMs: options.batchMaxWallMs ?? null, maxCostUsd: null, maxTokens: null },
        batch: { urls, formats: req.formats ?? ['markdown'], includeLinks: req.includeLinks === true },
        createdAt: now, updatedAt: now,
      }
      await store.putTask(task)
      launchTask(task, store, { maxDepth: 0, allowlistedDomains: [...new Set(urls.map(url => new URL(url).hostname))], useCached: false, resume: false })
      return { taskId }
      } finally { batchStartInProgress = false }
    },

    async getBatch(taskId) {
      if (!existsSync(join(taskRoot, taskId, 'checkpoint.sqlite'))) return null
      const store = SqliteTaskStore.openReadOnly(join(taskRoot, taskId))
      try {
        const task = await store.getTask(taskId)
        if (!task?.batch) return null
        const attempts = await store.listAttempts(taskId)
        const latest = attempts.at(-1)
        const report = latest
          ? reportFromTaskAttempt(task, latest, 0)
          : await crawlReportFromStore(store, taskId)
        if (!report) return null
        const completed = await store.countCompletedSteps(taskId)
        return { ...report, requested: task.batch.urls.length, completed, remaining: Math.max(0, task.batch.urls.length - completed) }
      } finally { await store.close() }
    },

    async getBatchItems(taskId, query) {
      if (await this.getBatch(taskId) === null) return null
      const page = await loadCrawlPageList(taskId, { ...query, limit: Math.min(50, query?.limit ?? 10) }, 'all', true)
      if (page === null || query?.debug === true) return page
      return { ...page, items: page.items.map(({ audit: _audit, ...item }) => ({ ...item, trace: [] })) }
    },

    async cancelBatch(taskId) {
      if (await this.getBatch(taskId) === null) return null
      await this.cancelCrawl(taskId)
      return this.getBatch(taskId)
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
    configureMonitor(revision, initialEnabled = true) { return monitorStore.createOrGetRevision(revision, initialEnabled) },
    async previewMonitor(revision, context = {}) {
      // Assessment and capture are identical to a run, but no monitor or event is persisted.
      const result = revision.config?.captureMode === 'http'
        ? await conditionalHttp.fetch(revision.url, context.deadlineAt ?? Date.now() + 300_000, context.signal)
        : await this.scrape({url:revision.url,debug:true}, context) as ScrapeResponse
      const assessment = revision.config ? assessConfiguredDocument(result, revision) : assessFirecrawlIntroduction(result)
      return {url:revision.url,finalUrl:result.evidence.finalUrl ?? null,status:result.status,assessment,sampleMarkdown:result.markdown?.slice(0, 3000) ?? null,capturedAt:Date.now()}
    },
    getMonitor(id) { return monitorStore.hasMonitor(id) ? monitorStore.view(id, Date.now()) : null },
    getMonitorRun(id, runId) { return monitorStore.runDetail(id, runId) },
    listMonitors() { return monitorStore.listMonitorIds().map((id) => monitorStore.view(id, Date.now())) },
    enqueueMonitorRun(id, triggerKey) { return monitorStore.enqueueRun(id, triggerKey) },
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
        const result = await this.scrape({url: revision.url, debug: true}, capture) as ScrapeResponse
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
    getDeliveriesPage: (query) => deliveryStore.listDeliveriesPage(query),
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
    ...(result?.json === undefined ? {} : { json: result.json }),
    failureReason: result?.failureReason ?? null,
    blockReason: result?.blockReason ?? null,
    budgetExceeded: result?.budgetExceeded ?? null,
    evidence: result?.evidence ?? null,
    usage: result?.usage ?? null,
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
