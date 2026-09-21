import { describe, expect, it } from 'vitest'
import {
  ATTEMPT_STATUS,
  DEFAULT_CRAWL_BUDGET,
  DEFAULT_CRAWL_SPEC,
  RESULT_STATUS,
  STEP_STATUS,
  TASK_STATUS,
  stepStatusFromResult,
  type ResultStatus,
} from '../src/index.js'

describe('checkpoint contract: task → attempt → step', () => {
  it('keeps task and attempt status independent of page ResultStatus', () => {
    expect([...TASK_STATUS]).toEqual(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'])
    expect([...ATTEMPT_STATUS]).toEqual(['running', 'completed', 'failed', 'cancelled', 'interrupted'])
  })

  it('makes every page ResultStatus a legal step status, plus pending/running', () => {
    expect([...STEP_STATUS]).toEqual(['pending', 'running', ...RESULT_STATUS])
    for (const status of RESULT_STATUS) {
      expect(stepStatusFromResult(status)).toBe(status)
    }
  })

  it('does not invent block-level step statuses', () => {
    const retired = ['chunk', 'block', 'partial_block', 'section']
    for (const name of retired) {
      expect(STEP_STATUS as readonly string[]).not.toContain(name)
    }
  })

  it('defaults crawl budget to unbounded on every dimension', () => {
    expect(DEFAULT_CRAWL_BUDGET).toEqual({
      maxPages: null,
      maxWallMs: null,
      maxCostUsd: null,
      maxTokens: null,
    })
  })

  it('maps a FetchResult status onto the matching step status without a second enum', () => {
    const page: ResultStatus = 'blocked'
    expect(stepStatusFromResult(page)).toBe('blocked')
  })

  it('defaults crawl resume to refetch, not --use-cached', () => {
    expect(DEFAULT_CRAWL_SPEC.useCached).toBe(false)
    expect(DEFAULT_CRAWL_SPEC.resumeFrom).toBeNull()
  })
})
