import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractTf } from '@w2l/extract-tf'
import { startFixtureServer, type FixtureServer } from '@w2l/fixtures'

/**
 * Page-type integration test against the real fixture server bytes.
 * The router's JSON-LD/microdata/post signals live in the raw response,
 * so this proves the routing path on served HTML — not on hand-built
 * test strings, and not through benchmark aggregate inference.
 */

let server: FixtureServer

beforeAll(async () => {
  server = await startFixtureServer()
})

afterAll(async () => {
  await server.close()
})

const EXPECTED: ReadonlyArray<{ id: string; pageType: string; strategy: string; escalate: boolean }> = [
  { id: 'pt-listing', pageType: 'listing', strategy: 'list', escalate: false },
  { id: 'pt-product', pageType: 'product', strategy: 'table', escalate: false },
  { id: 'pt-collection', pageType: 'collection', strategy: 'article', escalate: false },
  { id: 'pt-forum', pageType: 'forum', strategy: 'article', escalate: false },
]

describe('page-type routing on served fixture bytes', () => {
  it.each(EXPECTED.map((e) => [e.id, e] as const))(
    '%s routes to %s with the %s strategy',
    async (id, expected) => {
      const res = await fetch(`${server.url}/pt/${id.replace(/^pt-/, '')}`)
      expect(res.status).toBe(200)
      const body = await res.text()
      const out = extractTf.extract(body)
      expect(out.pageType, `pageType for ${id}`).toBe(expected.pageType)
      expect(out.strategy, `strategy for ${id}`).toBe(expected.strategy)
      expect(out.escalate, `escalate for ${id}`).toBe(expected.escalate)
    },
  )
})
