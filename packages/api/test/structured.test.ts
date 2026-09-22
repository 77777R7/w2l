import { describe, expect, it } from 'vitest'
import type { FetchResult, JsonFormatRequest, ProductFacts } from '@w2l/contracts'
import { extractStructured } from '../src/structured.js'

const product: ProductFacts = {
  name: { value: 'Subject headphones', source: 'dom', path: '#productTitle' },
  price: { value: '1299.00', source: 'dom', path: '#corePrice_feature_div' },
  priceCurrency: { value: 'INR', source: 'dom', path: '#corePrice_feature_div' },
  sku: { value: 'B012345678', source: 'dom', path: 'url:/dp/{asin}' },
  brand: { value: 'SoundCo', source: 'dom', path: '#bylineInfo' },
  availability: { value: 'In Stock', source: 'dom', path: '#availability' },
  kind: 'physical',
  subjectId: { value: 'B012345678', source: 'dom', path: 'url:/dp/{asin}' },
  seller: { value: 'SoundCo Direct', source: 'dom', path: '#sellerProfileTriggerId' },
  deliveryLocation: { value: 'India', source: 'dom', path: '#glow-ingress-line2' },
  rating: { value: '4.7', source: 'dom', path: '#acrPopover' },
  reviewCount: { value: '2345', source: 'dom', path: '#acrCustomerReviewText' },
  images: [{ value: 'https://images.example/subject.jpg', source: 'dom', path: '#landingImage' }],
  variants: [],
  specifications: { Model: { value: 'SC-10', source: 'dom', path: '#productDetails' } },
}

const result: FetchResult = {
  requestedUrl: 'https://www.amazon.com/dp/B012345678', status: 'success', failureReason: null, blockReason: null, budgetExceeded: null,
  lane: 'http', escalations: [], markdown: '# Subject headphones\n\nA lightweight product made from aluminium.', links: [], truncated: false, truncatedAt: null,
  compliance: null, evidence: { finalUrl: 'https://www.amazon.com/dp/B012345678', httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'x', artifacts: [] },
  usage: { wallMs: 10, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 10, browserMs: 0, externalCostUsd: null }, trace: [],
  document: {
    title: 'Subject headphones', pageType: 'product', strategy: 'product', confidence: 0.75, product,
    adapter: { id: 'amazon-product', version: '1.0.0', status: 'verified adapter' },
    entities: [{
      type: 'product', id: 'B012345678', relationships: {},
      fields: { asin: { raw: 'B012345678', normalized: 'B012345678', source: 'dom', path: 'url:/dp/{asin}', status: 'confirmed' } },
    }],
  },
}

const format = (extra: Record<string, unknown> = {}): JsonFormatRequest => ({
  type: 'json',
  schema: {
    type: 'object',
    properties: {
      asin: { type: 'string' }, title: { type: 'string' }, price: { type: 'number' }, currency: { type: 'string' }, seller: { type: 'string' },
      material: { type: 'string', description: 'Product material' },
    },
    required: ['asin', 'title', 'price', 'currency', 'seller', ...(extra.requireMaterial ? ['material'] : [])],
    additionalProperties: false,
  },
  ...(extra.modelFallback ? { modelFallback: true } : {}),
})

describe('structured JSON extraction', () => {
  it('returns the canonical adapter entity envelope for string json', async () => {
    const out = await extractStructured(result)
    expect(out.status).toBe('complete')
    expect(out.data).toMatchObject({
      adapter: { id: 'amazon-product' },
      entities: [{ type: 'product', id: 'B012345678' }],
    })
    expect(out.evidence).toContainEqual({ path: '/entities/0/fields/asin', source: 'dom', evidencePath: 'url:/dp/{asin}' })
  })

  it('maps deterministic HTML product facts and preserves evidence', async () => {
    const out = await extractStructured(result, format(), {}, null)
    expect(out.status).toBe('complete')
    expect(out.data).toMatchObject({ asin: 'B012345678', title: 'Subject headphones', price: 1299, currency: 'INR', seller: 'SoundCo Direct' })
    expect(out.evidence).toContainEqual({ path: '/price', source: 'dom', evidencePath: '#corePrice_feature_div' })
    expect(out.modelUsage).toBeNull()
  })

  it('reports an explicit incomplete result when model fallback is unavailable', async () => {
    const out = await extractStructured(result, format({ requireMaterial: true, modelFallback: true }), {}, null)
    expect(out.status).toBe('incomplete')
    expect(out.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['model_unavailable', 'missing_required']))
  })

  it('uses an OpenAI-compatible strict-schema response only for unresolved fields', async () => {
    let calls = 0
    const out = await extractStructured(result, format({ requireMaterial: true, modelFallback: true }), {}, {
      baseUrl: 'https://model.example', model: 'extractor', apiKey: 'secret',
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls++
        expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' })
        const request = JSON.parse(String(init?.body))
        expect(request.response_format.type).toBe('json_schema')
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ material: 'aluminium' }) } }], usage: { prompt_tokens: 50, completion_tokens: 5 } }), { status: 200 })
      }) as typeof fetch,
    })
    expect(calls).toBe(1)
    expect(out.status).toBe('complete')
    expect(out.data).toMatchObject({ asin: 'B012345678', material: 'aluminium' })
    expect(out.evidence).toContainEqual({ path: '/material', source: 'model' })
    expect(out.modelUsage).toMatchObject({ model: 'extractor', attempts: 1, inputTokens: 50, outputTokens: 5, externalCostUsd: null })
  })

  it('repairs invalid model output once and rejects a second invalid output', async () => {
    let calls = 0
    const out = await extractStructured(result, format({ requireMaterial: true, modelFallback: true }), {}, {
      baseUrl: 'https://model.example', model: 'extractor',
      fetch: (async () => {
        calls++
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ material: 42 }) } }] }), { status: 200 })
      }) as typeof fetch,
    })
    expect(calls).toBe(2)
    expect(out.status).toBe('invalid')
    expect(out.issues.some(issue => issue.code === 'model_output_invalid')).toBe(true)
  })

  it('accepts one repaired model output after the first response fails validation', async () => {
    let calls = 0
    const out = await extractStructured(result, format({ requireMaterial: true, modelFallback: true }), {}, {
      baseUrl: 'https://model.example', model: 'extractor',
      fetch: (async () => {
        calls++
        const content = calls === 1 ? { material: 42 } : { material: 'aluminium' }
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 })
      }) as typeof fetch,
    })
    expect(calls).toBe(2)
    expect(out.status).toBe('complete')
    expect(out.data).toMatchObject({ material: 'aluminium' })
    expect(out.modelUsage?.attempts).toBe(2)
  })

  it('propagates cancellation into model fallback and reports timeout without failing the page', async () => {
    const controller = new AbortController()
    const pending = extractStructured(result, format({ requireMaterial: true, modelFallback: true }), { signal: controller.signal }, {
      baseUrl: 'https://model.example', model: 'extractor',
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })) as typeof fetch,
    })
    controller.abort(new DOMException('deadline exceeded', 'TimeoutError'))
    const out = await pending
    expect(out.status).toBe('incomplete')
    expect(out.issues.map(issue => issue.code)).toContain('model_timeout')
    expect(out.data).toMatchObject({ asin: 'B012345678', title: 'Subject headphones' })
  })
})
