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
