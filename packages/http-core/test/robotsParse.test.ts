import { describe, expect, it } from 'vitest'
import {
  compileRule,
  evaluateRobots,
  matchRobotsGroup,
  parseRobotsTxt,
  isAllowed,
} from '../src/robots.js'

// ---------------------------------------------------------------------------
// parseRobotsTxt — grouping
// ---------------------------------------------------------------------------

describe('parseRobotsTxt — grouping', () => {
  it('parses a single group', () => {
    const r = parseRobotsTxt('User-agent: *\nDisallow: /private\n')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]!.agents).toEqual(['*'])
    expect(r.groups[0]!.rules).toHaveLength(1)
    expect(r.groups[0]!.rules[0]!.pattern).toBe('/private')
    expect(r.groups[0]!.rules[0]!.allow).toBe(false)
  })

  it('consecutive User-agent lines share one rule set (RFC 9309 §2.2.1)', () => {
    const r = parseRobotsTxt('User-agent: alpha\nUser-agent: beta\nDisallow: /x\n')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]!.agents).toEqual(['alpha', 'beta'])
  })

  it('a User-agent after a rule line starts a new group', () => {
    const r = parseRobotsTxt(
      'User-agent: alpha\nDisallow: /a\nUser-agent: beta\nDisallow: /b\n',
    )
    expect(r.groups).toHaveLength(2)
    expect(r.groups[0]!.agents).toEqual(['alpha'])
    expect(r.groups[1]!.agents).toEqual(['beta'])
    expect(r.groups[1]!.rules[0]!.pattern).toBe('/b')
  })

  it('strips comments and blank lines', () => {
    const r = parseRobotsTxt('# top comment\n\nUser-agent: *  # trailing\nDisallow: /x # why\n\n')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]!.rules[0]!.pattern).toBe('/x')
  })

  it('handles CRLF line endings', () => {
    const r = parseRobotsTxt('User-agent: *\r\nDisallow: /x\r\n')
    expect(r.groups[0]!.rules[0]!.pattern).toBe('/x')
  })

  it('field names are case-insensitive', () => {
    const r = parseRobotsTxt('USER-AGENT: *\nDISALLOW: /x\nALLOW: /x/ok\n')
    expect(r.groups[0]!.rules.map((x) => [x.pattern, x.allow])).toEqual([
      ['/x', false],
      ['/x/ok', true],
    ])
  })

  it('empty Disallow means nothing is disallowed, and is not recorded as a rule', () => {
    // A rule compiled from '' would match every path and disallow the site.
    const r = parseRobotsTxt('User-agent: *\nDisallow:\n')
    expect(r.groups[0]!.rules).toHaveLength(0)
    expect(isAllowed(r.groups[0]!.rules, '/anything')).toBe(true)
  })

  it('rules appearing before any User-agent are skipped', () => {
    const r = parseRobotsTxt('Disallow: /orphan\nUser-agent: *\nDisallow: /real\n')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]!.rules.map((x) => x.pattern)).toEqual(['/real'])
  })

  it('unknown fields are skipped rather than failing the document', () => {
    const r = parseRobotsTxt('User-agent: *\nRequest-rate: 1/5\nDisallow: /x\n')
    expect(r.groups[0]!.rules.map((x) => x.pattern)).toEqual(['/x'])
  })

  it('collects Sitemap lines globally', () => {
    const r = parseRobotsTxt('Sitemap: https://e.com/s1.xml\nUser-agent: *\nSitemap: https://e.com/s2.xml\n')
    expect(r.sitemaps).toEqual(['https://e.com/s1.xml', 'https://e.com/s2.xml'])
  })

  it('parses Crawl-delay into milliseconds', () => {
    const r = parseRobotsTxt('User-agent: *\nCrawl-delay: 2.5\n')
    expect(r.groups[0]!.crawlDelayMs).toBe(2500)
  })

  it('an empty document yields no groups', () => {
    expect(parseRobotsTxt('').groups).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// matchRobotsGroup — user-agent selection
// ---------------------------------------------------------------------------

describe('matchRobotsGroup', () => {
  const doc = parseRobotsTxt(
    [
      'User-agent: *',
      'Disallow: /everyone',
      '',
      'User-agent: w2l',
      'Disallow: /w2l-only',
      '',
      'User-agent: w2l-research',
      'Disallow: /research-only',
    ].join('\n'),
  )

  it('picks the most-specific matching token, not the first', () => {
    const g = matchRobotsGroup(doc, 'Mozilla/5.0 (compatible; w2l-research/0.1)')
    expect(g!.rules[0]!.pattern).toBe('/research-only')
  })

  it('falls back to a shorter token when the longer one does not match', () => {
    const g = matchRobotsGroup(doc, 'Mozilla/5.0 (compatible; w2l/0.1)')
    expect(g!.rules[0]!.pattern).toBe('/w2l-only')
  })

  it('uses * only when no product token matches', () => {
    const g = matchRobotsGroup(doc, 'Mozilla/5.0 (Macintosh) Chrome/151.0.0.0')
    expect(g!.rules[0]!.pattern).toBe('/everyone')
  })

  it('matching is case-insensitive', () => {
    const g = matchRobotsGroup(doc, 'W2L-RESEARCH/0.1')
    expect(g!.rules[0]!.pattern).toBe('/research-only')
  })

  it('returns null when there is no matching group and no wildcard', () => {
    const narrow = parseRobotsTxt('User-agent: googlebot\nDisallow: /\n')
    expect(matchRobotsGroup(narrow, 'w2l/0.1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// evaluateRobots — the decision plus its evidence
// ---------------------------------------------------------------------------

describe('evaluateRobots', () => {
  const doc = parseRobotsTxt(
    ['User-agent: *', 'Disallow: /private', 'Allow: /private/public', 'Crawl-delay: 1'].join('\n'),
  )

  it('allows an unmatched path and reports no rules fired', () => {
    const m = evaluateRobots(doc, 'w2l/0.1', '/about')
    expect(m.allowed).toBe(true)
    expect(m.appliedRules).toHaveLength(0)
    expect(m.matchedAgent).toBe('*')
  })

  it('disallows a matched path and cites the rule that did it', () => {
    const m = evaluateRobots(doc, 'w2l/0.1', '/private/secret')
    expect(m.allowed).toBe(false)
    expect(m.appliedRules.map((r) => r.pattern)).toEqual(['/private'])
  })

  it('most-specific allow overrides a broader disallow, and both are cited', () => {
    const m = evaluateRobots(doc, 'w2l/0.1', '/private/public/doc')
    expect(m.allowed).toBe(true)
    // Both rules matched; the record must show both so the verdict is checkable.
    expect(m.appliedRules.map((r) => r.pattern)).toEqual(['/private/public', '/private'])
  })

  it('sorts applied rules most-specific first', () => {
    const wide = parseRobotsTxt('User-agent: *\nDisallow: /a\nDisallow: /a/b/c\nDisallow: /a/b\n')
    const m = evaluateRobots(wide, 'w2l/0.1', '/a/b/c/d')
    expect(m.appliedRules.map((r) => r.pattern)).toEqual(['/a/b/c', '/a/b', '/a'])
  })

  it('surfaces the group crawl-delay', () => {
    expect(evaluateRobots(doc, 'w2l/0.1', '/x').crawlDelayMs).toBe(1000)
  })

  it('no matching group is allowed-by-default with a null matchedAgent', () => {
    const narrow = parseRobotsTxt('User-agent: googlebot\nDisallow: /\n')
    const m = evaluateRobots(narrow, 'w2l/0.1', '/anything')
    expect(m.allowed).toBe(true)
    expect(m.matchedAgent).toBeNull()
    expect(m.appliedRules).toHaveLength(0)
  })

  it('a disallow-everything group blocks the root', () => {
    const closed = parseRobotsTxt('User-agent: *\nDisallow: /\n')
    expect(evaluateRobots(closed, 'w2l/0.1', '/').allowed).toBe(false)
    expect(evaluateRobots(closed, 'w2l/0.1', '/deep/path').allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CompiledRule now carries its source pattern
// ---------------------------------------------------------------------------

describe('compileRule — pattern retention', () => {
  it('keeps the original pattern text verbatim, including the $ anchor', () => {
    expect(compileRule('/foo*.html$', false).pattern).toBe('/foo*.html$')
  })
})
