import { describe, it, expect } from 'vitest'
import { compileRule, globMatches, isAllowed } from '../src/robots.js'

// ---------------------------------------------------------------------------
// globMatches — unit tests
// ---------------------------------------------------------------------------

describe('globMatches — literal patterns', () => {
  it('matches exact path', () => {
    const { tokens } = compileRule('/foo/bar', true)
    expect(globMatches(tokens, '/foo/bar')).toBe(true)
  })

  it('prefix-matches: pattern /foo/bar matches longer paths (RFC 9309 §2.2.3)', () => {
    // Robots.txt patterns are prefix-anchored by default.
    // Use /foo/bar$ to force exact-end matching.
    const { tokens } = compileRule('/foo/bar', true)
    expect(globMatches(tokens, '/foo/bar')).toBe(true)
    expect(globMatches(tokens, '/foo/bar/baz')).toBe(true)
    expect(globMatches(tokens, '/foo/bar?q=1')).toBe(true)
  })

  it('does not match when path has different prefix', () => {
    const { tokens } = compileRule('/foo/bar', true)
    expect(globMatches(tokens, '/foo/baz')).toBe(false)
    expect(globMatches(tokens, '/other')).toBe(false)
  })

  it('does not match substring', () => {
    const { tokens } = compileRule('/foo', true)
    expect(globMatches(tokens, '/xfoo')).toBe(false)
  })
})

describe('globMatches — wildcard patterns', () => {
  it('* matches zero characters', () => {
    const { tokens } = compileRule('/foo*', true)
    expect(globMatches(tokens, '/foo')).toBe(true)
  })

  it('* matches any characters', () => {
    const { tokens } = compileRule('/foo*', true)
    expect(globMatches(tokens, '/foo/bar/baz')).toBe(true)
  })

  it('multiple * collapse and still match', () => {
    const { tokens } = compileRule('/a**b', true)
    expect(globMatches(tokens, '/a123b')).toBe(true)
    expect(globMatches(tokens, '/ab')).toBe(true)
    expect(globMatches(tokens, '/axyzb')).toBe(true)
  })

  it('* mid-pattern', () => {
    const { tokens } = compileRule('/foo/*/bar', true)
    expect(globMatches(tokens, '/foo/x/bar')).toBe(true)
    expect(globMatches(tokens, '/foo/x/y/bar')).toBe(true)
    expect(globMatches(tokens, '/foo/bar')).toBe(false)
  })
})

describe('globMatches — $ anchor', () => {
  it('anchored pattern matches exact end', () => {
    const { tokens } = compileRule('/foo$', true)
    expect(globMatches(tokens, '/foo')).toBe(true)
  })

  it('anchored pattern does not match if target is longer', () => {
    const { tokens } = compileRule('/foo$', true)
    expect(globMatches(tokens, '/foobar')).toBe(false)
  })

  it('anchor after wildcard', () => {
    const { tokens } = compileRule('/foo*.html$', true)
    expect(globMatches(tokens, '/foo/bar.html')).toBe(true)
    expect(globMatches(tokens, '/foo/bar.html?q=1')).toBe(false)
  })
})

describe('globMatches — ReDoS resistance', () => {
  it('adversarial many-star non-matching input completes quickly', () => {
    // 20 stars followed by a literal that cannot match the target's tail
    const pattern = '*'.repeat(20) + 'NOMATCH'
    const target = 'a'.repeat(100)
    const { tokens } = compileRule(pattern, true)
    const start = Date.now()
    const result = globMatches(tokens, target)
    const elapsed = Date.now() - start
    expect(result).toBe(false)
    // Must finish in well under 1 second even on a slow CI machine
    expect(elapsed).toBeLessThan(500)
  })

  it('adversarial many-star matching input returns correct result quickly', () => {
    const pattern = '*'.repeat(20) + 'END'
    const target = 'x'.repeat(50) + 'END'
    const { tokens } = compileRule(pattern, true)
    const start = Date.now()
    const result = globMatches(tokens, target)
    const elapsed = Date.now() - start
    expect(result).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })

  it('1000-star pattern against 10KB non-matching path stays sub-second', () => {
    const pattern = '*'.repeat(1000) + 'NOMATCH'
    const target = 'a'.repeat(10_000)
    const { tokens } = compileRule(pattern, true)
    const start = Date.now()
    const result = globMatches(tokens, target)
    const elapsed = Date.now() - start
    expect(result).toBe(false)
    expect(elapsed).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------------------
// isAllowed — precedence and defaults
// ---------------------------------------------------------------------------

describe('isAllowed', () => {
  it('returns true when no rules match', () => {
    const rules = [compileRule('/admin', false)]
    expect(isAllowed(rules, '/about')).toBe(true)
  })

  it('most-specific (longest) rule wins', () => {
    const rules = [
      compileRule('/foo', false),
      compileRule('/foo/bar', true),
    ]
    expect(isAllowed(rules, '/foo/bar')).toBe(true)
    expect(isAllowed(rules, '/foo/baz')).toBe(false)
  })

  it('on tie, allow wins over disallow', () => {
    const rules = [
      compileRule('/foo', false),
      compileRule('/foo', true),
    ]
    expect(isAllowed(rules, '/foo')).toBe(true)
  })

  it('disallow with longer pattern wins over allow with shorter', () => {
    const rules = [
      compileRule('/*', true),
      compileRule('/private/*', false),
    ]
    expect(isAllowed(rules, '/private/doc')).toBe(false)
    expect(isAllowed(rules, '/public/doc')).toBe(true)
  })

  it('empty rule list defaults to allowed', () => {
    expect(isAllowed([], '/anything')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// compileRule — token structure
// ---------------------------------------------------------------------------

describe('compileRule — token structure', () => {
  it('collapses adjacent stars into one star token', () => {
    // '/***/foo' → literal('/') + star + literal('/foo')
    // the three consecutive '*' must collapse to a single star token
    const { tokens } = compileRule('/***/foo', true)
    const kinds = tokens.map(t => t.kind)
    expect(kinds).toEqual(['literal', 'star', 'literal'])
    // exactly one star (not three)
    expect(kinds.filter(k => k === 'star')).toHaveLength(1)
  })

  it('records correct patternLength including $ character', () => {
    const rule = compileRule('/foo$', false)
    expect(rule.patternLength).toBe(5)
  })

  it('records allow flag correctly', () => {
    expect(compileRule('/x', true).allow).toBe(true)
    expect(compileRule('/x', false).allow).toBe(false)
  })
})
