import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EXTRACTOR_VERSION, extractTf, htmlToMarkdown } from '../src/index.js'

// Main-content selection and conversion on the pages a Monitor reads. A Monitor
// attributes a field change on an unchanged raw body to W2L by this version, so
// the same HTML under the same version must give the same Markdown.
const PAGES: [url: string, html: string][] = [
  ['https://docs.fixture.test/guide/intro', `<!doctype html><html><head><title>Fixture guide</title></head><body>
<nav><a href="/">Home</a> <a href="/pricing">Pricing</a></nav>
<main><article><h1>Fixture guide</h1>
<p>The web data API for agents. See the <a href="../features/search">Search feature docs</a> for all options, or <strong>scrape</strong> one page.</p>
<div>Crawl every page of a site.</div><div>Map its <em>links</em> <i class="icon"></i>first.</div>
<h2><a href="#install">Install</a></h2>
<ol start="3"><li><p>Open a terminal.</p></li><li><p>Run:</p><pre><code class="language-shell">npm ci
npm test</code></pre></li></ol>
<ul><li>Outputs<ul><li>Markdown</li><li>Links</li></ul></li></ul>
<table><caption>Limits</caption><tr><th>Plan</th><th>Pages<br>per month</th></tr><tr><td>Free</td><td>500</td></tr></table>
<p>First line<br>second line, with an image <img src="/img/a.png" alt="Diagram"> and an inline one <img src="data:image/png;base64,iVBORw0KGgo=" alt="Sparkline">.</p>
</article></main>
<footer><p>Copyright 2026 Fixture Docs. All rights reserved.</p></footer></body></html>`],
  ['https://stats.fixture.test/energy/q2', `<html><head><base href="https://stats.fixture.test/releases/"><title>Quarterly energy release</title></head><body>
<div id="header"><a href="/">Statistics office</a> | <a href="/contact">Contact</a></div>
<div class="layout"><div class="sidebar"><ul><li><a href="q1.html">Q1</a></li><li><a href="q2.html">Q2</a></li></ul></div>
<div class="content"><h1>Quarterly energy release</h1>
<p class="lead">Electricity demand from data centres rose in the second quarter, according to the figures published today.</p>
<p>Consumption is reported in gigawatt hours. Figures for the previous quarter were revised; see <a href="notes.html#revisions">the revision notes</a> for details.</p>
<table><thead><tr><th>Region</th><th>Q1 (GWh)</th><th>Q2 (GWh)</th></tr></thead><tbody><tr><td>North</td><td>1,204</td><td>1,318</td></tr><tr><td>South</td><td>987</td><td>1,021</td></tr></tbody></table>
<p><sup>1</sup> Provisional figures for the second quarter.</p>
</div></div>
<div id="footer">© Statistics office</div></body></html>`],
  // An SEC inline XBRL filing: sibling <div>s of the body, no <p>, a hidden XBRL header.
  ['https://www.sec.gov/Archives/edgar/data/9990001/000999000126000001/hkl-20251231.htm', `<html><head><title>hkl-20251231</title></head><body>
<div style="display:none"><ix:header><ix:hidden><ix:nonNumeric name="dei:EntityCentralIndexKey" contextRef="c-1">0009990001</ix:nonNumeric></ix:hidden></ix:header></div>
<div style="text-align:center"><span><ix:nonNumeric name="dei:EntityRegistrantName" contextRef="c-1">Harbour Kiln Limited</ix:nonNumeric></span></div>
${Array.from({ length: 6 }, (_, i) => `<div><span>Paragraph ${i + 1}: revenue rose in the quarter because the second kiln line reached full output, and the harbour office recorded every firing.</span></div>`).join('\n')}
<div><table><tr><td></td><td></td><td></td></tr><tr><td>Revenue</td><td>1,204</td><td>987</td></tr><tr><td>Net income</td><td>402</td><td>301</td></tr></table></div>
</body></html>`],
  // A table page: its h1 in a banner, two captioned tables with links and images in their cells, a data: link between them.
  ['https://survey.fixture.test/kilns/2026', `<html><head><title>Kiln survey 2026</title></head><body>
<div id="masthead"><a href="/">Survey office</a> | <a href="/releases">Releases</a></div>
<div class="banner"><h1>Kiln survey 2026</h1></div>
<div id="tables"><p>Firings by kiln; see the <a href="data:text/html;base64,PGgxPg==">inline notes</a>.</p>
<h2>North site</h2><table><caption>Table 1: North site, <a href="/method">method</a></caption><tr><th>Kiln</th><th>Firings</th><th>Report</th></tr>
${Array.from({ length: 6 }, (_, i) => `<tr><td><a href="kilns/${i + 1}">Kiln ${i + 1}</a></td><td>${40 - i}</td><td><a href="/r/${i + 1}.pdf"><img src="/i/pdf.png" alt="PDF | ${i + 1} MB"></a> <a href="/r/${i + 1}.csv">Data<br>CSV</a></td></tr>`).join('\n')}
</table>
<h2>South site</h2><table><caption>Table 2: South site</caption><tr><th>Kiln</th><th>Firings</th><th>Glaze</th></tr>
${Array.from({ length: 6 }, (_, i) => `<tr><td>Kiln ${i + 7}</td><td>${30 - i}</td><td><b>Cobalt</b> and <em>ash</em> glaze, batch ${i + 1}</td></tr>`).join('\n')}
</table></div>
<div id="colophon">Survey office, 2026</div></body></html>`],
]

function monitorMarkdown([url, html]: [string, string]): string {
  const extracted = extractTf.extract(html, { url })
  return htmlToMarkdown(extracted.mainHtml, { baseUrl: extracted.baseUrl })
}

describe('EXTRACTOR_VERSION', () => {
  it('is pinned to the Markdown the extractor gives for fixed pages', () => {
    const markdown = PAGES.map(monitorMarkdown)
    expect(markdown.every((page) => page.length > 100)).toBe(true)
    const digest = createHash('sha256').update(markdown.join('\n\u0000\n')).digest('hex')
    // If only the digest differs, the extraction or Markdown output changed:
    // bump EXTRACTOR_VERSION (src/version.ts) and pin the new pair together.
    expect({ version: EXTRACTOR_VERSION, digest }).toEqual({ version: 'extract-tf/12', digest: '5eb81e8b610d65444070f71452ceaac60c95314cf618940e8dde96ebf0890221' })
  })
})
