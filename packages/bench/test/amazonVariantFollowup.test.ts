import { describe, expect, it } from 'vitest'
import { amazonVariantFollowupUrl } from '../src/subjects/amazonVariantFollowup.js'

describe('Amazon requested-variant follow-up', () => {
  const request = 'https://www.amazon.sg/dp/B000VW9PIK'
  const observed = 'https://www.amazon.sg/dp/B000VW9PIK?th=1'

  it('selects a witnessed available child instead of publishing its parent', () => {
    expect(amazonVariantFollowupUrl(request, observed, 'B0CFV1W66Y', true))
      .toBe('https://www.amazon.sg/dp/B000VW9PIK?th=1&psc=1')
  })

  it('does not guess a child from the request URL alone', () => {
    expect(amazonVariantFollowupUrl(request, observed, 'B0CFV1W66Y', false)).toBeNull()
    expect(amazonVariantFollowupUrl(request, observed, null, true)).toBeNull()
    expect(amazonVariantFollowupUrl(request, observed, 'B000VW9PIK', true)).toBeNull()
  })

  it('does not leave the original product or overwrite an explicit selection', () => {
    expect(amazonVariantFollowupUrl(request, 'https://www.amazon.sg/dp/B0CFV1W66Y', 'B0CFV1W66Y', true)).toBeNull()
    expect(amazonVariantFollowupUrl(request, `${observed}&psc=0`, 'B0CFV1W66Y', true)).toBeNull()
    expect(amazonVariantFollowupUrl(request, 'https://other.example/dp/B000VW9PIK', 'B0CFV1W66Y', true)).toBeNull()
    expect(amazonVariantFollowupUrl('https://other.example/dp/B000VW9PIK', observed, 'B0CFV1W66Y', true)).toBeNull()
  })
})
