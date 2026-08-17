import type { GroundTruth, Suite } from '@w2l/contracts'
import { FIXTURES, SUITE_META } from './fixtures.js'

export const FIXTURE_TRUTHS: readonly GroundTruth[] = FIXTURES.map((f) => f.truth)

/**
 * Fixture targets are stored as server-relative paths so the suite is portable
 * across ephemeral ports. Bind them to a live server before running.
 */
export function bindSuite(baseUrl: string): Suite {
  const base = baseUrl.replace(/\/$/, '')
  return {
    name: SUITE_META.name,
    version: SUITE_META.version,
    curatedAt: SUITE_META.curatedAt,
    cases: FIXTURE_TRUTHS.map((t) => ({ ...t, target: `${base}${t.target}` })),
  }
}
