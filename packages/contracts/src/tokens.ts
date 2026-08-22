/**
 * Canonical token estimator for benchmark purposes.
 *
 * Deliberately simple and dependency-free so that ground-truth ranges and
 * measured values are produced by the same function. Swapping this out
 * invalidates every stored `expectedMainTokens` range — treat a change here
 * as a suite version bump.
 *
 * Approximates BPE behaviour: ~4 chars/token for prose, with CJK counted
 * closer to 1 char/token.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  let cjk = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)
    ) {
      cjk++
    }
  }
  const nonCjkChars = text.length - cjk
  return Math.ceil(nonCjkChars / 4) + cjk
}

// ---------------------------------------------------------------------------
// Quality escalation: when is a "success" too thin to be the final answer?
// ---------------------------------------------------------------------------

/**
 * A successful HTTP extraction at or below this many tokens is thin enough
 * that the ladder should offer it to a higher lane. This is NOT a content
 * floor that hides loss — thin content is reported as success with its real
 * token count, and the escalation is an addition, never a rewrite.
 *
 * Calibrated against the live-comparison measurements: producthunt.com's JS
 * shell yields ~100-150 tokens over HTTP while the rendered page yields
 * ~24k. A threshold of 200 separates that shell from a real server-rendered
 * page without ever mistaking an honest short page (a terse buy-box, a 404)
 * for a shell — those stay exactly what they are.
 */
export const QUALITY_ESCALATION_MAX_TOKENS = 200

/**
 * Extraction confidence at or below this value marks the result as
 * low-confidence, the second half of the quality signal. `confidenceOf`
 * caps non-article pages at 0.75 and suspiciously small main regions at 0.4;
 * a value of 0.3 sits below both, so only genuinely uncertain extractions
 * escalate.
 */
export const QUALITY_ESCALATION_MAX_CONFIDENCE = 0.3
