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
  /**
   * The original pattern text, verbatim. Kept because the compliance record
   * reports which rules fired, and a record that cited only token arrays would
   * be unverifiable by the publisher whose robots.txt it is quoting.
   */
  pattern: string
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

  return { pattern: raw, tokens, allow, patternLength: raw.length }
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

// ---------------------------------------------------------------------------
// robots.txt parser
// ---------------------------------------------------------------------------

/** One `User-agent:` group and the rules that belong to it. */
export interface RobotsGroup {
  /** The user-agent tokens this group applies to, lowercased. */
  agents: readonly string[]
  rules: readonly CompiledRule[]
  /** `Crawl-delay:` in milliseconds, when the group declared one. */
  crawlDelayMs: number | null
}

export interface RobotsTxt {
  groups: readonly RobotsGroup[]
  /** `Sitemap:` lines, which are global rather than per-group. */
  sitemaps: readonly string[]
}

/**
 * Parse a robots.txt document into user-agent groups.
 *
 * RFC 9309 §2.2.1: consecutive `User-agent` lines share one rule set; the group
 * ends at the first rule line, so a later `User-agent` after any rule starts a
 * new group.  Unknown fields are skipped rather than treated as errors — a
 * parser that throws on an unrecognized directive would refuse to crawl sites
 * that are merely using a non-standard extension.
 */
export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []

  let agents: string[] = []
  let rules: CompiledRule[] = []
  let crawlDelayMs: number | null = null
  // Consecutive User-agent lines accumulate; the first rule line closes the
  // agent list, so the next User-agent must open a fresh group.
  let sawRuleInGroup = false

  const flush = (): void => {
    if (agents.length > 0) groups.push({ agents, rules, crawlDelayMs })
    agents = []
    rules = []
    crawlDelayMs = null
    sawRuleInGroup = false
  }

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line === '') continue

    const colon = line.indexOf(':')
    if (colon < 0) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    switch (field) {
      case 'user-agent':
        if (sawRuleInGroup) flush()
        agents.push(value.toLowerCase())
        break
      case 'allow':
      case 'disallow':
        if (agents.length === 0) break // rule before any group — no owner, skip
        sawRuleInGroup = true
        // An empty `Disallow:` means "nothing is disallowed" and carries no
        // pattern; recording it as a rule matching '' would match every path.
        if (value !== '') rules.push(compileRule(value, field === 'allow'))
        break
      case 'crawl-delay': {
        if (agents.length === 0) break
        sawRuleInGroup = true
        const seconds = Number(value)
        if (Number.isFinite(seconds) && seconds >= 0) crawlDelayMs = Math.round(seconds * 1000)
        break
      }
      case 'sitemap':
        if (value !== '') sitemaps.push(value)
        break
      default:
        break // unknown field: skip, do not fail the document
    }
  }
  flush()

  return { groups, sitemaps }
}

/**
 * Pick the group that governs `userAgent`.
 *
 * RFC 9309 §2.2.1: match is case-insensitive on the product token and the
 * most-specific (longest) matching token wins; `*` is the fallback and is only
 * used when no product token matches.  Returns null when neither applies —
 * "no group for this UA" is a distinct fact from "a group that allows
 * everything", and the compliance record reports it as such.
 */
export function matchRobotsGroup(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase()
  let best: RobotsGroup | null = null
  let bestLen = -1
  let wildcard: RobotsGroup | null = null

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        wildcard ??= group
        continue
      }
      if (ua.includes(agent) && agent.length > bestLen) {
        best = group
        bestLen = agent.length
      }
    }
  }

  return best ?? wildcard
}

/** The rules that fired for a path, most-specific first. */
export interface RobotsMatch {
  allowed: boolean
  /** Every rule whose pattern matched, sorted most-specific first. */
  appliedRules: readonly CompiledRule[]
  /** The token of the group that governed the decision, e.g. `*`. */
  matchedAgent: string | null
  crawlDelayMs: number | null
}

/**
 * Evaluate `path` against a parsed robots.txt for a given user agent, and
 * report *which* rules fired rather than just the verdict.
 *
 * `isAllowed` answers the question; this answers "and prove it". The
 * compliance record embeds `appliedRules`, so a publisher can re-run the same
 * decision against their own robots.txt and get the same answer or catch us
 * misreporting.
 */
export function evaluateRobots(
  robots: RobotsTxt,
  userAgent: string,
  path: string,
): RobotsMatch {
  const group = matchRobotsGroup(robots, userAgent)
  if (group === null) {
    return { allowed: true, appliedRules: [], matchedAgent: null, crawlDelayMs: null }
  }

  const ua = userAgent.toLowerCase()
  const matchedAgent =
    group.agents.find((a) => a !== '*' && ua.includes(a)) ?? group.agents.find((a) => a === '*') ?? null

  const appliedRules = group.rules
    .filter((r) => globMatches(r.tokens, path))
    .sort((a, b) =>
      b.patternLength === a.patternLength
        ? Number(b.allow) - Number(a.allow)
        : b.patternLength - a.patternLength,
    )

  return {
    allowed: isAllowed(group.rules, path),
    appliedRules,
    matchedAgent,
    crawlDelayMs: group.crawlDelayMs,
  }
}
