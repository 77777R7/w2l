/**
 * robots.txt rule compiler and matcher.
 *
 * Wildcards are handled via a token-based double-pointer glob matcher rather
 * than JavaScript regex, which avoids catastrophic backtracking on inputs with
 * many consecutive '*' characters.  Worst-case complexity is O(target_len ×
 * token_count), fully polynomial.
 */

// ---------------------------------------------------------------------------
// Token representation
// ---------------------------------------------------------------------------

type LiteralToken = { kind: 'literal'; text: string }
type StarToken    = { kind: 'star' }
type AnchorToken  = { kind: 'anchor' }   // '$' end-anchor

type Token = LiteralToken | StarToken | AnchorToken

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface CompiledRule {
  tokens: readonly Token[]
  /** Original allow/disallow sense — true means "allow this path". */
  allow: boolean
  /** Length of the original pattern, used for precedence tie-breaking. */
  patternLength: number
}

/**
 * Compile one robots.txt Allow/Disallow pattern.
 *
 * Spec (RFC 9309 §2.2.3 and Google's extension):
 *   - '*' matches any sequence of characters including the empty string
 *   - '$' at the end of the pattern anchors to the end of the URL path
 *   - Adjacent '*' tokens collapse to a single star (semantically identical
 *     and prevents token explosion on pathological inputs like "***...***")
 */
export function compileRule(pattern: string, allow: boolean): CompiledRule {
  const raw = pattern

  // Detect and strip the '$' end-anchor.
  let anchored = false
  let p = raw
  if (p.endsWith('$')) {
    anchored = true
    p = p.slice(0, -1)
  }

  const tokens: Token[] = []
  let i = 0
  while (i < p.length) {
    if (p[i] === '*') {
      // Collapse consecutive stars.
      if (tokens.at(-1)?.kind !== 'star') {
        tokens.push({ kind: 'star' })
      }
      i++
    } else {
      // Collect a run of non-star characters into a single literal token.
      let j = i
      while (j < p.length && p[j] !== '*') j++
      tokens.push({ kind: 'literal', text: p.slice(i, j) })
      i = j
    }
  }

  if (anchored) {
    tokens.push({ kind: 'anchor' })
  }

  return { tokens, allow, patternLength: raw.length }
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

/**
 * Match `target` against the tokens produced by `compileRule`.
 *
 * Algorithm: single forward scan of the token list; when a star is
 * encountered we record the star's position and the current target position
 * as the last "retry point".  If a subsequent literal fails to match, we
 * backtrack to the retry point and advance the target position by one octet
 * (trying to consume one more character via the star) before retrying.
 *
 * This is the classic linear-backtracking glob algorithm; it never
 * re-scans a portion of the token list, so worst-case work is
 * O(target.length × tokens.length).
 */
export function globMatches(tokens: readonly Token[], target: string): boolean {
  let ti = 0        // index into tokens
  let si = 0        // index into target (chars consumed so far)

  // Last-star retry state — set whenever we pass a star token.
  let lastStarTi = -1
  let lastStarSi = -1

  while (ti < tokens.length) {
    const tok = tokens[ti]!

    if (tok.kind === 'star') {
      // Record this as the retry point; the star consumes nothing yet.
      lastStarTi = ti
      lastStarSi = si
      ti++
      continue
    }

    if (tok.kind === 'anchor') {
      // '$' — the remaining target must be empty.
      if (si === target.length) {
        ti++
        continue
      }
      // Mismatch: can we backtrack through a star?
      if (lastStarTi >= 0 && lastStarSi < target.length) {
        lastStarSi++
        si = lastStarSi
        ti = lastStarTi + 1
        continue
      }
      return false
    }

    // Literal token.
    const { text } = tok
    if (target.startsWith(text, si)) {
      si += text.length
      ti++
    } else if (lastStarTi >= 0 && lastStarSi < target.length) {
      // Retry: advance the star by one character and retry from after it.
      lastStarSi++
      si = lastStarSi
      ti = lastStarTi + 1
    } else {
      return false
    }
  }

  // All tokens consumed.  Robots.txt uses PREFIX matching: consuming every
  // token successfully is sufficient, regardless of remaining target characters.
  // Exact-end semantics are enforced only when a '$' anchor token is present;
  // that case is handled inside the loop above.
  return true
}

// ---------------------------------------------------------------------------
// Public rule-check helper
// ---------------------------------------------------------------------------

/**
 * Return true if `path` is allowed by the given compiled rules.
 *
 * Precedence (RFC 9309 §2.2.2): the most-specific (longest pattern) matching
 * rule wins.  Ties are broken in favour of Allow.
 */
export function isAllowed(rules: readonly CompiledRule[], path: string): boolean {
  let best: CompiledRule | null = null

  for (const rule of rules) {
    if (!globMatches(rule.tokens, path)) continue
    if (
      best === null ||
      rule.patternLength > best.patternLength ||
      (rule.patternLength === best.patternLength && rule.allow)
    ) {
      best = rule
    }
  }

  // Default: allow if no rule matched.
  return best === null ? true : best.allow
}
