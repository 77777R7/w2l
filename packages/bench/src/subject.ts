import type { FetchResult, Subject } from '@w2l/contracts'

/**
 * A subject under test: wraps one crawler implementation so the benchmark
 * runner can drive it uniformly.
 */
export interface SubjectAdapter {
  readonly meta: Subject

  /**
   * Execute one case: fetch the target URL and return a FetchResult.
   * The adapter translates its internal result shape into the canonical contract.
   */
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>

  /**
   * Clean up any persistent state (browser contexts, connection pools).
   * Called after all cases finish.
   */
  teardown(): Promise<void>
}
