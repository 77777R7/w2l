import { describe, expect, it } from 'vitest'
import { collectLinks, extractTf, htmlToMarkdown } from '../src/index.js'

const NAV_MARKER = 'Pricing · Changelog · Careers'
const FOOTER_MARKER = 'Copyright 2026 Synthetic Fixture Co'
const COOKIE_MARKER = 'We use cookies to personalise content'
const SIDEBAR_MARKER = 'Trending: seventeen ways to boil water'
const ALL_BOILERPLATE = [NAV_MARKER, FOOTER_MARKER, COOKIE_MARKER, SIDEBAR_MARKER]

const LISTING = `<!doctype html><html lang="en"><head><title>Bespoke teapot catalog</title></head>
<body>
<div id="cookie-consent" role="dialog"><p>${COOKIE_MARKER} and analyse traffic.</p><button>Accept all</button></div>
<nav class="site-nav"><a href="/">Home</a> <a href="/pricing">${NAV_MARKER}</a></nav>
<main><h1>Bespoke teapot catalog</h1><ul>
<li><a href="/pt/item/1">Bespoke teapot catalog 01</a> — hand-thrown stoneware</li>
<li><a href="/pt/item/2">Bespoke teapot catalog 02</a> — hand-thrown stoneware</li>
<li><a href="/pt/item/3">Bespoke teapot catalog 03</a> — hand-thrown stoneware</li>
<li><a href="/pt/item/4">Bespoke teapot catalog 04</a> — hand-thrown stoneware</li>
</ul></main>
<aside class="sidebar"><h3>${SIDEBAR_MARKER}</h3><ul><li><a href="/a">Unrelated link A</a></li></ul></aside>
<footer><p>${FOOTER_MARKER}. All rights reserved. <a href="/tos">Terms</a></p></footer>
</body></html>`

describe('collectLinks', () => {
  it('harvests listing and nav hrefs from the full document, not mainHtml', () => {
    const extracted = extractTf.extract(LISTING)
    expect(extracted.mainHtml).not.toContain('href="/"')
    expect(extracted.mainHtml).not.toContain(NAV_MARKER)

    const links = collectLinks(LISTING, 'https://fixture.test/pt/listing')
    expect(links).toContain('https://fixture.test/')
    expect(links).toContain('https://fixture.test/pricing')
    expect(links).toContain('https://fixture.test/pt/item/1')
    expect(links).toContain('https://fixture.test/pt/item/4')
    expect(links).toContain('https://fixture.test/tos')
  })

  it('does not put the raw HTML on the result — only absolute http(s) URLs', () => {
    const links = collectLinks(LISTING, 'https://fixture.test/pt/listing')
    expect(links.every((href) => href.startsWith('https://'))).toBe(true)
    expect(links.join('\n')).not.toContain('<html')
    expect(links.join('\n')).not.toContain('<a href')
  })

  it('skips javascript, mailto, and empty hrefs, and drops fragments', () => {
    const html = `<html><body>
      <a href="/ok">ok</a>
      <a href="/ok#section">dup</a>
      <a href="javascript:alert(1)">js</a>
      <a href="mailto:a@b.test">mail</a>
      <a href="">empty</a>
      <a>no href</a>
    </body></html>`
    expect(collectLinks(html, 'https://fixture.test/x')).toEqual(['https://fixture.test/ok'])
  })

  it('does not put chrome boilerplate into mainHtml even when links keep nav', () => {
    const extracted = extractTf.extract(LISTING)
    expect(extracted.mainHtml).not.toContain(NAV_MARKER)
    expect(extracted.mainHtml).not.toContain(COOKIE_MARKER)
    expect(extracted.mainHtml).not.toContain(FOOTER_MARKER)
    expect(extracted.mainHtml).not.toContain(SIDEBAR_MARKER)
    const markdown = htmlToMarkdown(extracted.mainHtml)
    for (const marker of ALL_BOILERPLATE) {
      expect(markdown).not.toContain(marker)
    }
  })
})
