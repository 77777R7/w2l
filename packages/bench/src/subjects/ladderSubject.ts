import { CONTENTFUL_STATUS, type ExecutionContext, type FetchResult, type Subject } from '@w2l/contracts'
import type { CrawlPolicy } from '@w2l/http-core'
import { buildChannels } from '../ladderCli.js'
import { LadderRunner } from '../routing/ladder.js'
import { MemoryRoutingHistory } from '../routing/vendorRouter.js'
import type { SubjectAdapter } from '../subject.js'

export class LadderSubject implements SubjectAdapter {
  readonly meta: Subject = {
    id: 'w2l-ladder',
    displayName: 'W2L ladder (HTTP → browser)',
    version: '0.3.0',
    hosting: 'self_hosted',
  }
  private readonly channels = buildChannels('standard', { keys: { browserbase: '', steel: '' } })
  private readonly runner = new LadderRunner(
    this.channels,
    { mode: 'standard' } satisfies CrawlPolicy,
    new MemoryRoutingHistory(),
  )

  async fetch(url: string, deadlineMs?: number, signal?: AbortSignal, onRetryAfter?: ExecutionContext['onRetryAfter']): Promise<FetchResult> {
    const run = await this.runner.run(url, undefined, { deadlineAt: deadlineMs, signal, onRetryAfter })
    const result = run.result
    return {
      ...result,
      usage: {
        ...result.usage,
        wallMs: run.summary.wallMs,
        browserMs: run.summary.browserMs,
        bytesWire: run.summary.bytesWire,
        bytesDecompressed: run.summary.bytesDecompressed,
        requestCount: run.summary.requestCount,
        attemptCount: run.summary.attemptCount,
        contentTokens: result.usage.contentTokens,
        externalCostUsd: run.summary.externalCost.unknown ? null : run.summary.externalCost.knownSubtotal,
      },
      trace: [
        ...result.trace,
        {
          at: run.summary.wallMs,
          lane: result.lane,
          event: 'benchmark_ladder_summary',
          detail: {
            channelsTried: run.channelsTried,
            contentful: CONTENTFUL_STATUS.has(result.status),
          },
        },
      ],
    }
  }

  async teardown(): Promise<void> {
    await Promise.all(this.channels.map((channel) => channel.close?.().catch(() => {})))
  }
}
