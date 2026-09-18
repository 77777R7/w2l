import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFixtureServer, type FixtureServer } from '@w2l/fixtures'
import { CHECKPOINT_FILENAME, CrawlOrchestrator, SqliteTaskStore } from '@w2l/runtime'
import { CRAWL_USAGE, latestTaskId, parseCrawlArgs } from '../src/crawlCli.js'
import { LadderScrapeAtom } from '../src/scrapeAtom.js'
import { buildChannels } from '../src/ladderCli.js'
import { LadderRunner } from '../src/routing/ladder.js'
import { MemoryRoutingHistory } from '../src/routing/vendorRouter.js'

describe('crawl CLI arguments', () => {
  it('requires a URL unless --resume', () => {
    expect(() => parseCrawlArgs([])).toThrow(/usage: w2l crawl/)
    expect(() => parseCrawlArgs(['crawl'])).toThrow(/usage: w2l crawl/)
  })

  it('accepts the crawl prefix and scrape-like flags', () => {
    expect(parseCrawlArgs(['crawl', 'https://example.com/'])).toMatchObject({
      url: 'https://example.com/',
      mode: 'standard',
      headed: false,
      resume: false,
      useCached: false,
      maxPages: null,
    })
    expect(parseCrawlArgs(['--research', '--headed', '--max-pages', '20', 'https://example.com/p'])).toMatchObject({
      mode: 'research',
      headed: true,
      maxPages: 20,
      url: 'https://example.com/p',
    })
  })

  it('parses --resume with an optional task dir', () => {
    expect(parseCrawlArgs(['--resume', '/tmp/task'])).toMatchObject({
      resume: true,
      taskDir: '/tmp/task',
      url: null,
    })
    expect(parseCrawlArgs(['--resume', 'https://example.com/'])).toMatchObject({
      resume: true,
      url: 'https://example.com/',
    })
  })

  it('rejects unknown flags and headed-by-default', () => {
    expect(() => parseCrawlArgs(['--stealth', 'https://example.com/'])).toThrow(/unknown flag --stealth/)
    expect(parseCrawlArgs(['https://example.com/']).headed).toBe(false)
    expect(CRAWL_USAGE).toContain('w2l crawl')
    expect(CRAWL_USAGE).toContain('--headed')
  })
})

describe('w2l crawl against the fixture graph', () => {
  let server: FixtureServer

  beforeAll(async () => {
    server = await startFixtureServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('crawls listing → items, then resumes from the same sqlite after a simulated kill', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-crawl-'))
    const seed = `${server.url}/crawl/listing`
    const host = new URL(server.url).hostname
    const policy = { mode: 'standard' as const, allowlistedDomains: [host] }
    const store = SqliteTaskStore.open(dir)
    const channels = buildChannels('standard', {
      localSubjects: { browser_local: { fetch: async () => { throw new Error('CI crawl must stay on HTTP; browser arm was reached') } } },
    })
    expect(channels.map((c) => c.id)).toEqual(['http', 'browser_local'])
    const runner = new LadderRunner(channels, policy, new MemoryRoutingHistory())
    const atom = new LadderScrapeAtom(runner)
    const first = new CrawlOrchestrator({ store, atom })
    try {
      const report = await first.run({
        seedUrl: seed,
        taskDir: dir,
        allowlistedDomains: [host],
        budget: { maxPages: 1, maxWallMs: null, maxCostUsd: null, maxTokens: null },
      })
      expect(report.pagesFetched).toBe(1)
      expect(report.budgetExceeded).toBe('pages')
      const firstSteps = await store.listSteps(report.taskId)
      expect(firstSteps.map((s) => s.canonicalUrl)).toEqual([seed])
      expect(firstSteps[0]?.result?.links).toEqual(
        expect.arrayContaining([
          `${server.url}/crawl/item/1`,
          `${server.url}/crawl/item/2`,
          `${server.url}/crawl/item/3`,
          seed,
        ]),
      )
    } finally {
      await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
      await store.close()
    }

    const reopened = SqliteTaskStore.open(dir)
    const resumeId = await latestTaskId(reopened)
    const resumeChannels = buildChannels('standard', {
      localSubjects: { browser_local: { fetch: async () => { throw new Error('CI crawl must stay on HTTP; browser arm was reached') } } },
    })
    const resumeRunner = new LadderRunner(resumeChannels, policy, new MemoryRoutingHistory())
    const resumeAtom = new LadderScrapeAtom(resumeRunner)
    const second = new CrawlOrchestrator({ store: reopened, atom: resumeAtom })
    try {
      const resumed = await second.run({
        seedUrl: seed,
        taskDir: dir,
        resumeFrom: resumeId,
        allowlistedDomains: [host],
        budget: { maxPages: 20, maxWallMs: null, maxCostUsd: null, maxTokens: null },
      })
      expect(resumed.taskId).toBe(resumeId)
      expect(resumed.attemptId).not.toBeUndefined()
      expect(resumed.pagesFetched).toBeGreaterThanOrEqual(4)
      const steps = await reopened.listSteps(resumed.taskId)
      const urls = new Set(steps.map((s) => s.canonicalUrl))
      expect(urls.has(seed)).toBe(true)
      expect(urls.has(`${server.url}/crawl/item/1`)).toBe(true)
      expect(urls.has(`${server.url}/crawl/item/2`)).toBe(true)
      expect(urls.has(`${server.url}/crawl/item/3`)).toBe(true)
      expect(join(dir, CHECKPOINT_FILENAME)).toBe(`${dir}/${CHECKPOINT_FILENAME}`)
    } finally {
      await Promise.all(resumeChannels.map((c) => c.close?.().catch(() => {})))
      await reopened.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
