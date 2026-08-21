import { afterEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/providerCli.js'

/**
 * The provider CLI spends money. Every guard here exists because getting it
 * wrong bills a real account or points a real vendor session somewhere the
 * operator did not name.
 */

const saved = {
  bb: process.env.BROWSERBASE_API_KEY,
  steel: process.env.STEEL_API_KEY,
}

function setKeys(bb: string | null, steel: string | null): void {
  if (bb === null) delete process.env.BROWSERBASE_API_KEY
  else process.env.BROWSERBASE_API_KEY = bb
  if (steel === null) delete process.env.STEEL_API_KEY
  else process.env.STEEL_API_KEY = steel
}

afterEach(() => {
  setKeys(saved.bb ?? null, saved.steel ?? null)
})

describe('provider CLI arguments', () => {
  it('infers the vendor from the single key present', () => {
    setKeys('bb_key', null)
    expect(parseArgs(['https://example.com/p'])).toEqual({
      url: 'https://example.com/p',
      vendor: 'browserbase',
    })

    setKeys(null, 'steel_key')
    expect(parseArgs(['https://example.com/p']).vendor).toBe('steel')
  })

  it('refuses to guess which account to bill when both keys are set', () => {
    setKeys('bb_key', 'steel_key')
    // Silently picking one would charge an account the operator never named.
    expect(() => parseArgs(['https://example.com/p'])).toThrow(/pass --vendor to say which to bill/)
  })

  it('honours an explicit --vendor even when the other key is the only one set', () => {
    setKeys('bb_key', 'steel_key')
    expect(parseArgs(['--vendor', 'steel', 'https://example.com/p']).vendor).toBe('steel')
    expect(parseArgs(['--vendor=browserbase', 'https://example.com/p']).vendor).toBe('browserbase')
  })

  it('says so when there is no credential at all', () => {
    setKeys(null, null)
    expect(() => parseArgs(['https://example.com/p'])).toThrow(/no vendor credential in the environment/)
  })

  it('rejects an unknown vendor rather than falling back to a default', () => {
    setKeys('bb_key', null)
    expect(() => parseArgs(['--vendor', 'scrapling', 'https://example.com/p'])).toThrow(
      /--vendor must be browserbase or steel/,
    )
    expect(() => parseArgs(['--vendor'])).toThrow(/got \(nothing\)/)
  })

  it('rejects an unknown flag instead of ignoring it', () => {
    setKeys('bb_key', null)
    // A silently-dropped flag is how a run ends up doing something other than
    // what the command said.
    expect(() => parseArgs(['--stealth', 'https://example.com/p'])).toThrow(/unknown flag --stealth/)
  })

  it('requires a real URL', () => {
    setKeys('bb_key', null)
    expect(() => parseArgs([])).toThrow(/usage: w2l-provider/)
    expect(() => parseArgs(['not-a-url'])).toThrow(/not a URL: not-a-url/)
  })

  it('treats an empty key as absent, not as a credential', () => {
    setKeys('', 'steel_key')
    expect(parseArgs(['https://example.com/p']).vendor).toBe('steel')
  })
})
