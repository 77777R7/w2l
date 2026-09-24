import { describe, expect, it } from 'vitest'
import { extractTf } from '../../src/index.js'

const requested = 'https://www.amazon.sg/dp/B012345678'
const page = (selected: string | null, extra = '') => `<!doctype html><html><body><main id="dp-container">
  ${selected === null ? '' : `<input name="ASIN" value="${selected}">`}
  <input name="parentASIN" value="B012345678">
  <h1 id="productTitle">Selected product</h1>
  <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">S$12.50</span></span></div>
  ${extra}
</main></body></html>`

describe('R1 Amazon identity and quote evidence', () => {
  it('rejects a selected child even when the requested ASIN is its parent', () => {
    const out = extractTf.extract(page('B999999999'), { url: requested })
    expect(out.product?.identity).toMatchObject({ requestedId: 'B012345678', observedSelectedId: 'B999999999', status: 'mismatched', identityMatch: false })
    expect(out.product?.price).toBeNull()
    expect(out.product?.subjectId).toBeNull()
    expect(out.entities[0]?.fields.price).toBeUndefined()
  })

  it('does not accept a URL or parent ASIN as a page-selected witness', () => {
    const out = extractTf.extract(page(null), { url: requested })
    expect(out.product?.identity?.status).toBe('unverified')
    expect(out.product?.price).toBeNull()
    expect(out.product?.priceCurrency).toBeNull()
  })

  it('fails closed when selected-product controls disagree', () => {
    const out = extractTf.extract(page('B012345678', '<div id="buybox" data-asin="B999999999"></div>'), { url: requested })
    expect(out.product?.identity?.status).toBe('conflicting')
    expect(out.product?.price).toBeNull()
  })

  it('accepts a ten-digit ASIN as an observed identity', () => {
    const out = extractTf.extract(page('1234567890'), { url: 'https://www.amazon.sg/dp/1234567890' })
    expect(out.product?.identity?.status).toBe('matched')
    expect(out.product?.subjectId?.value).toBe('1234567890')
  })

  it('keeps marketplace currency inference separate from an explicit symbol', () => {
    const explicit = extractTf.extract(page('B012345678'), { url: requested })
    expect(explicit.product?.priceCurrency).toMatchObject({ value: 'SGD', source: 'text' })
    const inferred = extractTf.extract(page('B012345678').replace('S$12.50', '$12.50'), { url: requested })
    expect(inferred.product?.priceCurrency).toMatchObject({ value: 'SGD', source: 'inferred' })
    expect(inferred.entities[0]?.fields.currency?.source).toBe('inferred')
  })

  it('does not promote a buying-option or unavailable page to a selected quote', () => {
    const noQuote = page('B012345678').replace('<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">S$12.50</span></span></div>', '')
    const options = extractTf.extract(noQuote.replace('</main>', '<div id="buybox">See All Buying Options</div></main>'), { url: requested })
    const unavailable = extractTf.extract(noQuote.replace('</main>', '<div id="availability">Currently unavailable.</div></main>'), { url: requested })
    expect(options.product?.quoteState).toBe('unobserved')
    expect(unavailable.product?.quoteState).toBe('absent_observed')
    expect(options.product?.price).toBeNull()
    expect(unavailable.product?.price).toBeNull()
  })

  it('never treats a unit or alternate-seller price as the selected product quote', () => {
    const unitFirst = page('B012345678').replace('S$12.50', 'S$0.20</span></span><span class="a-price"><span class="a-offscreen">S$12.50')
      .replace('<span class="a-price"><span class="a-offscreen">S$0.20', '<span class="a-price apex-priceperunit-value"><span class="a-offscreen">S$0.20')
    const unitResult = extractTf.extract(unitFirst, { url: requested })
    expect(unitResult.product?.price?.value).toBe('12.50')
    expect(unitResult.product?.quoteState).toBe('present')

    const alternateOnly = page('B012345678').replace('<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">S$12.50</span></span></div>', '')
      .replace('</main>', '<div id="aod-offer-list"><div class="aod-information-block"><span class="a-price"><span class="a-offscreen">S$18.00</span></span></div></div></main>')
    const alternateResult = extractTf.extract(alternateOnly, { url: requested })
    expect(alternateResult.product?.quoteState).toBe('unobserved')
    expect(alternateResult.product?.price).toBeNull()
  })

  it('withholds the primary price when selected-price evidence conflicts on currency', () => {
    const html = page('B012345678', '<div class="priceToPay"><span class="a-offscreen">US$12.50</span></div>')
    const out = extractTf.extract(html, { url: requested })
    expect(out.product?.quoteState).toBe('conflicting')
    expect(out.product?.price).toBeNull()
  })
})
