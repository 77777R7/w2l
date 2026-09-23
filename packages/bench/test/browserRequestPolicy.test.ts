import { expect, it } from 'vitest'
import { hostedBrowserRequestAllowed } from '../src/subjects/browserRequestPolicy.js'

it('confines hosted browser subresources to reviewed HTTPS hosts', () => {
  const hosts=new Set(['www.amazon.sg','m.media-amazon.com'])
  expect(hostedBrowserRequestAllowed('https://www.amazon.sg/dp/B000VW9PIK','document',hosts)).toBe(true)
  expect(hostedBrowserRequestAllowed('https://m.media-amazon.com/script.js','script',hosts)).toBe(true)
  expect(hostedBrowserRequestAllowed('https://m.media-amazon.com/photo.jpg','image',hosts)).toBe(false)
  for (const url of ['http://www.amazon.sg/dp/B000VW9PIK','https://127.0.0.1/admin','https://amazon.sg.evil.example/x','https://user:pass@www.amazon.sg/x','file:///etc/passwd']) {
    expect(hostedBrowserRequestAllowed(url,'document',hosts)).toBe(false)
  }
})
