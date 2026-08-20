import type { CheckResult, FalseSuccessCheck, GroundTruth } from '@w2l/contracts'
import { CONTENTFUL_STATUS, EVIDENCE_ONLY_CHECKS } from '@w2l/contracts'
import type { FetchResult } from '@w2l/contracts'
import { estimateTokens, evaluateExpectedTable } from '@w2l/contracts'

/**
 * Run the five false-success checks against a contentful result.
 * Annotation-dependent checks return 'unknown' when ground truth is unavailable.
 */
export function checkFalseSuccess(
  result: FetchResult,
  truth: GroundTruth,
): readonly CheckResult[] {
  const checks: CheckResult[] = []

  // Check 1: missing_required_content
  const hasAnnotation = truth.mustContain.length > 0 || truth.expectedTable != null
  if (hasAnnotation && result.markdown) {
    const missing = truth.mustContain.filter((s) => !result.markdown!.includes(s))
    if (truth.expectedTable != null) {
      const tableCheck = evaluateExpectedTable(result.markdown, truth.expectedTable)
      if (!tableCheck.pass) missing.push(...tableCheck.issues.map((i) => `[table] ${i}`))
    }
    checks.push({
      check: 'missing_required_content',
      outcome: missing.length === 0 ? 'pass' : 'fail',
      detail: missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
    })
  } else {
    checks.push({
      check: 'missing_required_content',
      outcome: 'unknown',
      detail: 'No mustContain/expectedTable annotation or no markdown',
    })
  }

  // Check 2: challenge_text_returned
  const challengePatterns = [
    'Just a moment',
    'Enable JavaScript and cookies',
    'Checking your browser',
    'Are you a robot',
    'Access denied',
    'Cloudflare',
  ]
  const md = result.markdown ?? ''
  const foundChallenge = challengePatterns.some((p) => md.includes(p))
  checks.push({
    check: 'challenge_text_returned',
    outcome: foundChallenge ? 'fail' : 'pass',
    detail: foundChallenge ? 'Challenge page boilerplate detected' : null,
  })

  // Check 3: content_yield_below_floor
  if (result.markdown && truth.expectedMainTokens) {
    const tokens = estimateTokens(result.markdown)
    const { min, max } = truth.expectedMainTokens
    const tooLow = tokens < min
    const bannedPresent =
      truth.mustNotContain.length > 0 &&
      truth.mustNotContain.some((s) => result.markdown!.includes(s))
    checks.push({
      check: 'content_yield_below_floor',
      outcome: tooLow || bannedPresent ? 'fail' : 'pass',
      detail:
        tooLow
          ? `Tokens ${tokens} < floor ${min}`
          : bannedPresent
            ? 'Banned boilerplate present'
            : null,
    })
  } else {
    checks.push({
      check: 'content_yield_below_floor',
      outcome: 'unknown',
      detail: 'No expectedMainTokens annotation or no markdown',
    })
  }

  // Check 4: wrong_page_content
  // Simplified: if finalUrl differs from requestedUrl and status is success, suspect redirect to home/login.
  // A real implementation compares content hash against known wrong-page patterns.
  const wrongPage =
    result.status === 'success' &&
    result.evidence.finalUrl !== result.requestedUrl &&
    result.evidence.redirectChain.length > 0
  checks.push({
    check: 'wrong_page_content',
    outcome: wrongPage ? 'fail' : 'pass',
    detail: wrongPage ? `Redirected to ${result.evidence.finalUrl}` : null,
  })

  // Check 5: silent_truncation
  const silentTrunc = result.truncated && result.truncatedAt === null
  checks.push({
    check: 'silent_truncation',
    outcome: silentTrunc ? 'fail' : 'pass',
    detail: silentTrunc ? 'truncated flag set but truncatedAt is null' : null,
  })

  return checks
}

/**
 * Determine if this result is a false success: status is contentful but
 * at least one check failed.
 */
export function isFalseSuccess(
  result: FetchResult,
  checks: readonly CheckResult[],
): boolean {
  if (!CONTENTFUL_STATUS.has(result.status)) return false
  return checks.some((c) => c.outcome === 'fail')
}
