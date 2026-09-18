import { describe, expect, it } from 'vitest'
import { extractTf, htmlToMarkdown } from '../src/index.js'

describe('htmlToMarkdown', () => {
  it('turns headings, paragraphs, and emphasis into GFM', () => {
    const md = htmlToMarkdown(
      '<article><h1>Kiln</h1><p>The kiln reached <strong>1240</strong> degrees.</p></article>',
    )
    expect(md).toContain('# Kiln')
    expect(md).toContain('The kiln reached **1240** degrees.')
    expect(md).not.toContain('<p>')
    expect(md).not.toContain('<h1>')
  })

  it('emits GFM tables the fixture checker can score', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    )
    expect(md).toContain('| A | B |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('keeps required facts after extract-tf on the article fixture', () => {
    const html = `<!doctype html><html><head><title>Kiln temperatures and glaze vitrification</title></head>
<body>
<div id="cookie-consent" role="dialog"><p>We use cookies to personalise content.</p></div>
<nav class="site-nav"><a href="/pricing">Pricing</a></nav>
<article>
<h1>Kiln temperatures and glaze vitrification</h1>
<p>The kiln reached 1240 degrees before the glaze vitrified. Every reading was logged in the ledger kept by the harbour office.</p>
<p>Sediment cores from the estuary date to 1873. Researchers compared them against the almanac kept at the plinth house.</p>
</article>
<footer><p>Copyright 2026 Synthetic Fixture Co. All rights reserved.</p></footer>
</body></html>`
    const out = extractTf.extract(html)
    const md = htmlToMarkdown(out.mainHtml)
    expect(md).toContain('The kiln reached 1240 degrees before the glaze vitrified.')
    expect(md).toContain('Sediment cores from the estuary date to 1873.')
    expect(md).not.toContain('We use cookies')
    expect(md).not.toContain('Pricing')
    expect(md).not.toContain('<article')
  })

  it('is empty on empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
  })
})
