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

  it('lays out a table that holds a table as blocks, and only the inner table as a grid (Hacker News)', () => {
    const md = htmlToMarkdown(
      '<table id="hnmain"><tr><td><table><tr><td><b><a href="news">Hacker News</a></b> <a href="newest">new</a></td><td><a href="login">login</a></td></tr></table></td></tr>' +
        '<tr><td><table><tr><td>1.</td><td>Story one</td></tr><tr><td></td><td>10 points</td></tr></table></td></tr>' +
        '<tr><td><center><a href="newsguidelines.html">Guidelines</a> | <a href="newsfaq.html">FAQ</a></center></td></tr></table>',
      { baseUrl: 'https://news.fixture.test/' },
    )
    expect(md).toBe(
      '**[Hacker News](https://news.fixture.test/news)** [new](https://news.fixture.test/newest)\n\n[login](https://news.fixture.test/login)\n\n' +
        '| 1. | Story one |\n| --- | --- |\n|  | 10 points |\n\n' +
        '[Guidelines](https://news.fixture.test/newsguidelines.html) | [FAQ](https://news.fixture.test/newsfaq.html)',
    )
  })

  it('keeps a data table that holds a small table in one cell as one grid, the small table as its cell text', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>Kiln</th><th>Firings</th><th>Glazes</th></tr>' +
        '<tr><td>North</td><td>41</td><td><table><caption>By glaze</caption><tr><td>Cobalt</td><td>12</td></tr><tr><td>Ash</td><td>29</td></tr></table></td></tr>' +
        '<tr><td>South</td><td>37</td><td>Celadon</td></tr></table>',
    )
    expect(md).toBe('| Kiln | Firings | Glazes |\n| --- | --- | --- |\n| North | 41 | By glaze Cobalt 12 Ash 29 |\n| South | 37 | Celadon |')
  })

  it('keeps link and image targets in table cells, absolute and on one line, with | escaped', () => {
    const md = htmlToMarkdown(
      '<table><caption>Front page, <a href="/front">archive</a></caption>' +
        '<tr><th>Story</th><th><a href="/sort?by=site">Site</a></th><th>Logo</th></tr>' +
        '<tr><td><a href="https://example.org/story">A story</a></td><td><a href="/from?site=a|b">a|b<br>site</a></td><td><img src="/logo.png" alt="Logo | mark"></td></tr>' +
        '<tr><td><a href="item?id=1"><b>Bold</b> <code>link</code></a> and <em>text</em></td><td><a href="vote?id=1"><div class="votearrow"></div></a></td><td><img src="//cdn.fixture.test/a.png" alt=""></td></tr></table>',
      { baseUrl: 'https://news.fixture.test/' },
    )
    expect(md).toBe([
      'Front page, [archive](https://news.fixture.test/front)',
      '| Story | [Site](https://news.fixture.test/sort?by=site) | Logo |',
      '| --- | --- | --- |',
      '| [A story](https://example.org/story) | [a\\|b site](https://news.fixture.test/from?site=a\\|b) | ![Logo \\| mark](https://news.fixture.test/logo.png) |',
      // Emphasis and code stay plain text in a cell; a link with no text keeps its target as its text, as in a paragraph.
      '| [Bold link](https://news.fixture.test/item?id=1) and text | [https://news.fixture.test/vote?id=1](https://news.fixture.test/vote?id=1) | ![](https://cdn.fixture.test/a.png) |',
    ].join('\n'))
  })

  it('keeps superscripts and subscripts in their script form so they never join the next number', () => {
    // Digital Realty's metro pages lay the unit spans side by side; the
    // exponent must not read as the first digit of the next figure.
    const md = htmlToMarkdown('<p><span>12,000 ft <sup>2</sup></span><span>1,100 m <sup>2</sup></span><span>N+1 Cooling</span> H<sub>2</sub>O at 10<sup>-3</sup> bar<sup>[a]</sup></p>')
    expect(md).toContain('12,000 ft ²')
    expect(md).toMatch(/²\s?1,100 m ²/)
    expect(md).toContain('H₂O at 10⁻³ bar[a]')
    expect(md).not.toContain('21,100')
  })

  it('keeps an empty corner header cell empty instead of inventing its text', () => {
    const md = htmlToMarkdown(
      '<table><tr><th></th><th>2023</th><th>2024</th></tr><tr><th>Exports</th><td>12</td><td>14</td></tr></table>',
    )
    expect(md).toBe('|  | 2023 | 2024 |\n| --- | --- | --- |\n| Exports | 12 | 14 |')
  })

  it('expands colspan and rowspan into the grid, the spanned slots empty', () => {
    const md = htmlToMarkdown(
      '<table><tr><th rowspan="2">Region</th><th colspan="2">Quarter</th></tr><tr><th>Q1</th><th>Q2</th></tr>' +
        '<tr><td rowspan="2">North</td><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>',
    )
    expect(md).toBe('| Region | Quarter |  |\n| --- | --- | --- |\n|  | Q1 | Q2 |\n| North | 1 | 2 |\n|  | 3 |  |')
  })

  const delimiterRows = (md: string) => md.split('\n').filter((line) => /^\| (---( \| ---)*) \|$/.test(line))

  it('caps colspan at 1000 as browsers do, and a rowspan past the last row adds no rows', () => {
    // A ~1 KB page whose spans, uncapped, would pad its grid to 12 million characters.
    const html = `<table><tr>${'<td colspan="1000000"></td>'.repeat(4)}</tr>${'<tr><td>y</td></tr>'.repeat(40)}</table>`
    const md = htmlToMarkdown(html)
    expect(delimiterRows(md)).toEqual([`| ${Array(4000).fill('---').join(' | ')} |`])
    expect(md.length).toBeLessThan(600_000)
    const tall = htmlToMarkdown('<table><tr><td rowspan="1000000">a</td><td>b</td></tr><tr><td>c</td></tr><tr><td>d</td></tr></table>')
    expect(tall).toBe('| a | b |\n| --- | --- |\n|  | c |\n|  | d |')
  })

  it('reads colspan and rowspan as browsers do: leading digits, 1 when there are none, a rowspan of 0 to the end of its row group', () => {
    const cols = htmlToMarkdown('<table><tr><td colspan="2.9">a</td><td colspan=" +2abc">b</td><td colspan="0">c</td><td colspan="-3">d</td></tr><tr><td>1</td></tr></table>')
    expect(cols).toBe('| a |  | b |  | c | d |\n| --- | --- | --- | --- | --- | --- |\n| 1 |  |  |  |  |  |')
    // A fractional rowspan ended after its whole rows instead of covering its column in every later row.
    const rows = htmlToMarkdown('<table><tr><td rowspan="1.5">a</td><td rowspan="2.5">b</td><td rowspan="-2">c</td></tr><tr><td>d</td></tr><tr><td>e</td><td>f</td><td>g</td></tr></table>')
    expect(rows).toBe('| a | b | c |\n| --- | --- | --- |\n| d |  |  |\n| e | f | g |')
    const zero = htmlToMarkdown('<table><thead><tr><th rowspan="0">h</th><th>a</th></tr><tr><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(zero).toBe('| h | a |\n| --- | --- |\n|  | b |\n| 1 | 2 |')
  })

  it('covers every row a rowspan spans: rows too short to reach its column, and not past its row group', () => {
    const short = htmlToMarkdown('<table><tr><td>a</td><td>a2</td><td rowspan="3">b</td></tr><tr><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr><tr><td>g</td><td>h</td><td>i</td></tr></table>')
    expect(short).toBe('| a | a2 | b |  |\n| --- | --- | --- | --- |\n| c |  |  |  |\n| d | e |  | f |\n| g | h | i |  |')
    const empty = htmlToMarkdown('<table><tbody><tr><td>a</td><td rowspan="2">b</td></tr><tr></tr></tbody><tbody><tr><td>x</td><td>y</td></tr></tbody></table>')
    expect(empty).toBe('| a | b |\n| --- | --- |\n|  |  |\n| x | y |')
    const past = htmlToMarkdown('<table><tbody><tr><td>a</td><td rowspan="5">b</td></tr><tr><td>c</td></tr></tbody><tbody><tr><td>x</td><td>y</td></tr></tbody></table>')
    expect(past).toBe('| a | b |\n| --- | --- |\n| c |  |\n| x | y |')
  })

  it('writes the first <thead> as the header and the first <tfoot> last, wherever they are written', () => {
    const md = htmlToMarkdown('<table><tfoot><tr><td>Total</td><td>9</td></tr></tfoot><tbody><tr><td>a</td><td>4</td></tr></tbody>' +
      '<thead><tr><th>Item</th><th>Count</th></tr></thead><tbody><tr><td>b</td><td>5</td></tr></tbody></table>')
    expect(md).toBe('| Item | Count |\n| --- | --- |\n| a | 4 |\n| b | 5 |\n| Total | 9 |')
  })

  it('closes a cell at a row group written in it, the text after it before the table, as the browser\'s parser does', () => {
    expect(htmlToMarkdown('<table><tr><td>a<thead><tr><td>x</td><td>y</td></tr></thead>tail</td></tr><tr><td>b</td><td>c</td></tr></table>'))
      .toBe('tail\n\n| x | y |\n| --- | --- |\n| a |  |\n| b | c |')
    expect(htmlToMarkdown('<table><tr><td>a<th>b</th>c</td></tr><tr><td>d</td><td>e</td></tr></table>')).toBe('c\n\n| a | b |\n| --- | --- |\n| d | e |')
  })

  it('counts rowspans stacked over the same columns without visiting every one in every row', () => {
    // ~2 MB: 300 rowspans a thousand columns wide stacked over 100 empty rows, 90 times.
    let stacked = '<table>'
    for (let i = 0; i < 300; i++) stacked += `<tr>${i < 299 ? `<td colspan="${299 - i}"></td>` : ''}<td colspan="1000" rowspan="60000"></td></tr>`
    stacked += `${'<tr></tr>'.repeat(100)}</table>`
    const started = Date.now()
    expect(htmlToMarkdown(stacked.repeat(90)).length).toBeLessThan(2 * stacked.length * 90)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('writes a table whose padded grid would be too large as its rows of cells, still one GFM table', () => {
    // ~380 KB of HTML: one wide empty row over 20,000 one-cell rows pads to 60 million characters.
    const html = `<table><tr><td colspan="1000"></td></tr>${'<tr><td>y</td></tr>'.repeat(20_000)}</table><table><tr><td>k</td><td>v</td></tr><tr><td>1</td><td>2</td></tr></table>`
    const started = Date.now()
    const md = htmlToMarkdown(html)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(md.length).toBeLessThan(2 * html.length)
    expect(delimiterRows(md)).toHaveLength(2)
    expect(md.startsWith('|  |\n| --- |\n| y |\n| y |\n')).toBe(true)
    expect(md.split('\n').filter((line) => line === '| y |')).toHaveLength(20_000)
    expect(md.endsWith('\n\n| k | v |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
    // Rowspans over many rows, each spanning cell a thousand columns wide.
    const tall = `<table><tr>${'<td rowspan="65534" colspan="1000">a</td>'.repeat(20)}</tr>${'<tr><td>y</td></tr>'.repeat(2_000)}</table>`
    const tallStarted = Date.now()
    expect(htmlToMarkdown(tall).length).toBeLessThan(2 * tall.length)
    expect(Date.now() - tallStarted).toBeLessThan(5_000)
  })

  it('writes a table of 200,000 rows', () => {
    const md = htmlToMarkdown(`<table>${'<tr><td>y</td></tr>'.repeat(200_000)}</table>`)
    expect(md.split('\n')).toHaveLength(200_001)
  })

  it('shares one padding budget among a page\'s tables', () => {
    // Each table pads to just under the per-table limit; together they pass the page's.
    const near = `<table><tr><td colspan="1000">w</td></tr>${'<tr><td>y</td></tr>'.repeat(499)}</table>`
    const md = htmlToMarkdown(near.repeat(6))
    const delimiters = delimiterRows(md)
    expect(delimiters).toHaveLength(6)
    expect(delimiters.filter((line) => line.length > 1000)).toHaveLength(4)
    expect(md.length).toBeLessThan(4 * 1000 * 500 * 3 + 6 * near.length)
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

  it('keeps the content after an early </body> or </html> in the body, as a browser does', () => {
    // Chromium's document.body.innerText of each page.
    expect(htmlToMarkdown('<!doctype html><html><body><p>a</p></body><p>b</p></html>')).toBe('a\n\nb')
    expect(htmlToMarkdown('<!doctype html><html><body><p>a</p></body></html><p>c</p>')).toBe('a\n\nc')
    expect(htmlToMarkdown('<!doctype html><html><body><div><p>a</p></BODY ><p>b</p></div></HTML><p>c</p>')).toBe('a\n\nb\n\nc')
    expect(htmlToMarkdown('<!doctype html><html><body><p>a</p></body></html><!-- x --><script>1</script><p>c</p>')).toBe('a\n\nc')
    expect(htmlToMarkdown('<!doctype html><html><body><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></body><p>after</p></html>'))
      .toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
    // Main-content selection reads the same body.
    const text = (words: string) => `${words} `.repeat(8)
    const article = extractTf.extract(`<!doctype html><html><body><nav><a href="/">Home</a></nav><main><article><h1>Title</h1><p>${text('First paragraph.')}</p></body></html><p>${text('After the end tags.')}</p></article></main></html>`)
    expect(htmlToMarkdown(article.mainHtml)).toContain('After the end tags.')
    // A page that ends with its </body></html> is unchanged.
    expect(htmlToMarkdown('<!doctype html><html><body><p>a</p></body></html>\n')).toBe('a')
    // So is one with millions of characters after them.
    expect(htmlToMarkdown(`<!doctype html><html><body><p>a</p></body></html>\n<!--${'x'.repeat(12_000_000)}-->${' '.repeat(12_000_000)}`)).toBe('a')
  })

  it('keeps today\'s Markdown and html with the default blockAds, and shows a cookie banner with blockAds: false', () => {
    const html = `<!doctype html><html><head><title>Kiln temperatures and glaze vitrification</title></head>
<body><main>
<div id="cookie-consent" role="dialog"><p>We use cookies to personalise content.</p></div>
<h1>Kiln temperatures and glaze vitrification</h1>
<p>The kiln reached 1240 degrees before the glaze vitrified. Every reading was logged in the ledger kept by the harbour office.</p>
<p>Sediment cores from the estuary date to 1873. Researchers compared them against the almanac kept at the plinth house.</p>
</main></body></html>`
    const pruned = extractTf.extract(html)
    const md = htmlToMarkdown(pruned.mainHtml)
    expect(md).toContain('# Kiln temperatures and glaze vitrification')
    expect(md).toContain('The kiln reached 1240 degrees before the glaze vitrified.')
    expect(md).not.toContain('We use cookies')
    expect(pruned.mainHtml).not.toContain('cookie-consent')
    const kept = extractTf.extract(html, { blockAds: false })
    const loose = htmlToMarkdown(kept.mainHtml)
    expect(loose).toContain('We use cookies to personalise content.')
    expect(loose).toContain('The kiln reached 1240 degrees before the glaze vitrified.')
    // The html format is this same mainHtml: it follows the switch too.
    expect(kept.mainHtml).toContain('<div id="cookie-consent" role="dialog">')
  })
})

const BASE = 'https://fixture.test/docs/page'

describe('htmlToMarkdown blocks and inline whitespace', () => {
  it('separates adjacent blocks and keeps inline spacing and markup', () => {
    expect(htmlToMarkdown('<div>Alpha</div><div>Beta</div>')).toBe('Alpha\n\nBeta')
    expect(htmlToMarkdown('<div>Hello <b>world</b> <a href="/x">link</a></div>', { baseUrl: BASE }))
      .toBe('Hello **world** [link](https://fixture.test/x)')
    expect(htmlToMarkdown('<div><a href="/a"><h3>A</h3><p>One</p></a><a href="/b"><h3>B</h3><p>Two</p></a></div>', { baseUrl: BASE }))
      .toBe('[A One](https://fixture.test/a)\n\n[B Two](https://fixture.test/b)')
  })

  it('drops empty emphasis and keeps whitespace outside the markers', () => {
    expect(htmlToMarkdown('<h3><i class="flag-icon"></i> Andorra </h3><p><i class="icon-ok"></i> In stock</p>'))
      .toBe('### Andorra\n\nIn stock')
    expect(htmlToMarkdown('<p>a<b> bold </b>b<em></em><strong> </strong>c</p>')).toBe('a **bold** b c')
  })

  it('turns br into a hard line break', () => {
    expect(htmlToMarkdown('<div><strong>Capital:</strong> Andorra la Vella<br>\n  <strong>Population:</strong> 84000<br></div>'))
      .toBe('**Capital:** Andorra la Vella  \n**Population:** 84000')
  })
})

describe('htmlToMarkdown lists and code', () => {
  it('numbers ordered lists from their start and indents nested lists', () => {
    expect(htmlToMarkdown('<ol start="3"><li>c</li><li>d<ul><li>d1</li><li>d2</li></ul></li></ol>'))
      .toBe('3. c\n4. d\n   - d1\n   - d2')
  })

  it('separates a paragraph after a list with a blank line', () => {
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul><p>after</p>')).toBe('- a\n- b\n\nafter')
  })

  it('keeps paragraphs, code blocks and tables inside list items', () => {
    const md = htmlToMarkdown(
      '<ul><li><p>Intro</p><pre>x = 1</pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></li></ul>',
    )
    expect(md).toBe('- Intro\n\n  ```\n  x = 1\n  ```\n\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |')
  })

  it('fences pre text exactly, with the language of its class', () => {
    expect(htmlToMarkdown('<pre><code class="hljs language-js">if (a) {\n\n  b(`x`)  \n}\n</code></pre>'))
      .toBe('```js\nif (a) {\n\n  b(`x`)  \n}\n```')
    expect(htmlToMarkdown('<pre class="lang-md">```\nfenced\n```</pre>')).toBe('````md\n```\nfenced\n```\n````')
  })
})

describe('htmlToMarkdown link and image targets', () => {
  it('resolves relative targets against the base URL and keeps fragments and mailto', () => {
    const md = htmlToMarkdown(
      '<p><a href="../guide/">Guide</a> <img src="//cdn.fixture.test/a.png" alt="A"> <a href="#top">Top</a> ' +
        '<a href="mailto:x@fixture.test">Mail</a> <a href="javascript:void(0)">Menu</a></p>',
      { baseUrl: BASE },
    )
    expect(md).toBe(
      '[Guide](https://fixture.test/guide/) ![A](https://cdn.fixture.test/a.png) [Top](#top) ' +
        '[Mail](mailto:x@fixture.test) Menu',
    )
    // A heading's empty permalink anchor says nothing and is dropped.
    expect(htmlToMarkdown('<h2><a class="anchor" href="#install"></a>Install</h2>')).toBe('## Install')
  })

  it('drops data: image URIs and keeps their alt text, as Firecrawl removeBase64Images does', () => {
    const md = htmlToMarkdown(
      '<p>Chart <img src="data:image/png;base64,iVBORw0KGgo=" alt="Monthly [output]"> and ' +
        '<a href="/logo"><img src=" DATA:image/svg+xml;utf8,<svg></svg>" alt="Logo"></a> and ' +
        '<img src="data:image/gif;base64,R0lGOD">.</p>',
      { baseUrl: BASE },
    )
    expect(md).toBe('Chart Monthly [output] and [Logo](https://fixture.test/logo) and .')
    expect(htmlToMarkdown('<img src="data:image/gif;base64,R0lGOD" alt="Dot">')).toBe('Dot')
  })

  it('keeps a data: image as a target only when asked (dataUriImages keep), and still drops a data: link target', () => {
    const html = '<p>Chart <img src="data:image/png;base64,AAAA" alt="inline pic"> and <a href="data:text/plain,x">Open</a>.</p>'
    expect(htmlToMarkdown(html, { dataUriImages: 'keep' })).toBe('Chart ![inline pic](data:image/png;base64,AAAA) and Open.')
    expect(htmlToMarkdown(html, { dataUriImages: 'drop' })).toBe('Chart inline pic and Open.')
    expect(htmlToMarkdown(html)).toBe('Chart inline pic and Open.')
  })

  it('drops data: link targets and keeps the link text, as for images', () => {
    const md = htmlToMarkdown(
      '<p><a href="data:text/html;base64,PGgxPg==">Open</a> and <a href=" DATA:text/plain,x"><img src="/i.png" alt="Icon"></a></p>' +
        '<table><tr><th>File</th><th>Size</th></tr><tr><td><a href="data:text/csv,a,b">Download</a></td><td>1 kB</td></tr></table>',
      { baseUrl: BASE },
    )
    expect(md).toBe('Open and ![Icon](https://fixture.test/i.png)\n\n| File | Size |\n| --- | --- |\n| Download | 1 kB |')
  })

  it('prefers the document <base href>, and keeps targets as written without a base', () => {
    const doc = '<!doctype html><html><head><base href="https://cdn.fixture.test/v2/"></head><body><a href="intro.html">Intro</a></body></html>'
    expect(htmlToMarkdown(doc, { baseUrl: BASE })).toBe('[Intro](https://cdn.fixture.test/v2/intro.html)')
    expect(htmlToMarkdown('<a href="intro.html">Intro</a>')).toBe('[Intro](intro.html)')
  })

  it('leaves out the elements the caller excludes, with everything inside, and keeps the document base', () => {
    const doc = '<!doctype html><html><head><base href="https://cdn.fixture.test/v2/"></head><body><nav><a href="/">Home</a></nav>' +
      '<main><p>Tides <a href="table.html">table</a><sup class="ref">[1]</sup></p></main><footer><p>Imprint</p></footer></body></html>'
    expect(htmlToMarkdown(doc, { baseUrl: BASE, exclude: ['nav', 'main .ref', 'head'] })).toBe('Tides [table](https://cdn.fixture.test/v2/table.html)\n\nImprint')
    expect(htmlToMarkdown(doc, { baseUrl: BASE, exclude: [] })).toBe(htmlToMarkdown(doc, { baseUrl: BASE }))
    expect(htmlToMarkdown(doc, { baseUrl: BASE, exclude: ['body'] })).toBe('')
  })
})

// Markers a browser capture adds to its copy of the rendered page where the
// page's CSS, not its tags, decides the layout. Unmarked HTML converts by tag.
describe('htmlToMarkdown layout markers', () => {
  it('starts a block at an inline element the page lays out as a block (S05)', () => {
    const html = '<div class="quote"><span class="text" data-w2l-display="block">“The world as we have created it is a process of our thinking.”</span>' +
      '<span>by <small class="author">Albert Einstein</small></span><div class="tags">Tags: <a class="tag">change</a> <a class="tag">thinking</a></div></div>'
    expect(htmlToMarkdown(html)).toBe('“The world as we have created it is a process of our thinking.”\n\nby Albert Einstein\n\nTags: change thinking')
    expect(htmlToMarkdown(html.replace(' data-w2l-display="block"', '')))
      .toBe('“The world as we have created it is a process of our thinking.”by Albert Einstein\n\nTags: change thinking')
  })

  it('skips what the page hides, with everything inside (S09)', () => {
    const html = '<ol><li><p>Open <span class="platform-mac">Terminal</span><span class="platform-linux" data-w2l-hidden="">Terminal</span>' +
      '<span class="platform-windows" data-w2l-hidden="">Git <b>Bash</b></span>.</p></li><li><p>Set a Git username:</p></li></ol>'
    expect(htmlToMarkdown(html)).toBe('1. Open Terminal.\n2. Set a Git username:')
  })

  it('keeps link and emphasis markup on a marked block, and spaces marked blocks inside a line', () => {
    expect(htmlToMarkdown('<div><a href="/more" data-w2l-display="block">Read more</a><strong data-w2l-display="block">Note</strong>text</div>', { baseUrl: BASE }))
      .toBe('[Read more](https://fixture.test/more)\n\n**Note**\n\ntext')
    expect(htmlToMarkdown('<p><a href="/a"><span data-w2l-display="block">Title</span><span data-w2l-display="block">Subtitle</span></a></p>', { baseUrl: BASE }))
      .toBe('[Title Subtitle](https://fixture.test/a)')
  })

  it('applies the markers inside tables, code blocks and code spans', () => {
    const html = '<table><tr><th>Country</th><th>Share</th></tr><tr><td>India</td><td><span class="sortkey" data-w2l-hidden="">7001172774265385000♠</span>' +
      '<span data-w2l-display="block">17.3%</span><span>of world</span></td></tr></table>' +
      '<pre>ls<span data-w2l-hidden=""> # hidden note</span>\npwd</pre><p>Run <code>make<span data-w2l-hidden="">-dev</span></code>.</p>'
    expect(htmlToMarkdown(html)).toBe('| Country | Share |\n| --- | --- |\n| India | 17.3% of world |\n\n```\nls\npwd\n```\n\nRun `make`.')
  })
})

// Golden files: trimmed copies of the real pages in research/parity/sites.v1.json.
describe('htmlToMarkdown golden pages', () => {
  it('quotes.toscrape.com quote blocks (S04)', () => {
    const html = `<div class="col-md-8">
    <div class="quote" itemscope itemtype="http://schema.org/CreativeWork">
        <span class="text" itemprop="text">“The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.”</span>
        <span>by <small class="author" itemprop="author">Albert Einstein</small>
        <a href="/author/Albert-Einstein">(about)</a>
        </span>
        <div class="tags">
            Tags:
            <meta class="keywords" itemprop="keywords" content="change,deep-thoughts,thinking,world" >

            <a class="tag" href="/tag/change/page/1/">change</a>

            <a class="tag" href="/tag/deep-thoughts/page/1/">deep-thoughts</a>

        </div>
    </div>

    <div class="quote" itemscope itemtype="http://schema.org/CreativeWork">
        <span class="text" itemprop="text">“It is our choices, Harry, that show what we truly are, far more than our abilities.”</span>
        <span>by <small class="author" itemprop="author">J.K. Rowling</small>
        <a href="/author/J-K-Rowling">(about)</a>
        </span>
        <div class="tags">
            Tags:
            <a class="tag" href="/tag/abilities/page/1/">abilities</a>
        </div>
    </div>
</div>`
    expect(htmlToMarkdown(html, { baseUrl: 'https://quotes.toscrape.com/' })).toBe(
      [
        '“The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.” by Albert Einstein [(about)](https://quotes.toscrape.com/author/Albert-Einstein)',
        'Tags: [change](https://quotes.toscrape.com/tag/change/page/1/) [deep-thoughts](https://quotes.toscrape.com/tag/deep-thoughts/page/1/)',
        '“It is our choices, Harry, that show what we truly are, far more than our abilities.” by J.K. Rowling [(about)](https://quotes.toscrape.com/author/J-K-Rowling)',
        'Tags: [abilities](https://quotes.toscrape.com/tag/abilities/page/1/)',
      ].join('\n\n'),
    )
  })

  it('docs.github.com numbered steps with code blocks (S09)', () => {
    const html = `<div class="markdown-body"><h2 id="setting-your-git-username" tabindex="-1"><a class="heading-link" href="#setting-your-git-username">Setting your Git username for every repository on your computer<span class="heading-link-symbol" aria-hidden="true"></span></a></h2>
<ol>
<li>
<p>Open <span class="platform-mac">Terminal</span>.</p>
</li>
<li>
<p>Set a Git username:</p>
<pre><code class="hljs language-shell">git config --global user.name "Mona Lisa"
</code></pre>
</li>
<li>
<p>Confirm that you have set the Git username correctly:</p>
<pre><code class="hljs language-shell"><span class="hljs-meta prompt_">$ </span><span class="bash">git config --global user.name</span>
<span class="hljs-meta prompt_">&gt; </span><span class="bash">Mona Lisa</span>
</code></pre>
</li>
</ol>
<h2 id="further-reading" tabindex="-1"><a class="heading-link" href="#further-reading">Further reading<span class="heading-link-symbol" aria-hidden="true"></span></a></h2>
<ul>
<li><a href="/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address">Setting your commit email address</a></li>
<li><a href="https://git-scm.com/book/en/v2/Customizing-Git-Git-Configuration">"Git Configuration" from the <em>Pro Git</em> book</a></li>
</ul></div>`
    expect(htmlToMarkdown(html, { baseUrl: 'https://docs.github.com/en/get-started/git-basics/setting-your-username-in-git' })).toBe(
      [
        '## [Setting your Git username for every repository on your computer](#setting-your-git-username)',
        [
          '1. Open Terminal.',
          '2. Set a Git username:',
          '',
          '   ```shell',
          '   git config --global user.name "Mona Lisa"',
          '   ```',
          '3. Confirm that you have set the Git username correctly:',
          '',
          '   ```shell',
          '   $ git config --global user.name',
          '   > Mona Lisa',
          '   ```',
        ].join('\n'),
        '## [Further reading](#further-reading)',
        '- [Setting your commit email address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)\n' +
          '- ["Git Configuration" from the *Pro Git* book](https://git-scm.com/book/en/v2/Customizing-Git-Git-Configuration)',
      ].join('\n\n'),
    )
  })

  it('books.toscrape.com product listing (S01)', () => {
    const html = `<div class="page_inner">
    <ul class="breadcrumb">
        <li>
            <a href="index.html">Home</a>
        </li>
        <li class="active">All products</li>
    </ul>
        <section>
            <div class="alert alert-warning" role="alert"><strong>Warning!</strong> This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.</div>
            <div>
                <ol class="row">
                        <li class="col-xs-6 col-sm-4 col-md-3 col-lg-3">
    <article class="product_pod">
            <div class="image_container">
                    <a href="catalogue/a-light-in-the-attic_1000/index.html"><img src="media/cache/2c/da/2cdad67c44b002e7ead0cc35693c0e8b.jpg" alt="A Light in the Attic" class="thumbnail"></a>
            </div>
                <p class="star-rating Three">
                    <i class="icon-star"></i>
                    <i class="icon-star"></i>
                </p>
            <h3><a href="catalogue/a-light-in-the-attic_1000/index.html" title="A Light in the Attic">A Light in the ...</a></h3>
            <div class="product_price">
        <p class="price_color">£51.77</p>
<p class="instock availability">
    <i class="icon-ok"></i>
        In stock
</p>
            </div>
    </article>
</li>
                </ol>
            </div>
        </section>
</div>`
    expect(htmlToMarkdown(html, { baseUrl: 'https://books.toscrape.com/' })).toBe(
      [
        '- [Home](https://books.toscrape.com/index.html)\n- All products',
        '**Warning!** This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.',
        [
          '1. [![A Light in the Attic](https://books.toscrape.com/media/cache/2c/da/2cdad67c44b002e7ead0cc35693c0e8b.jpg)](https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html)',
          '',
          '   ### [A Light in the ...](https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html)',
          '',
          '   £51.77',
          '',
          '   In stock',
        ].join('\n'),
      ].join('\n\n'),
    )
  })

  it('scrapethissite.com country cards (S07)', () => {
    const html = `<div class="container">
                <div class="row">
                    <div class="col-md-12">
                        <h1>
                            Countries of the World: A Simple Example
                            <small>250 items</small>
                        </h1>
                        <hr>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <p>
                            <i class="glyphicon glyphicon-education"></i> There are <a href="/lessons/">4 video lessons</a> that show you how to scrape this page.
                        </p>
                        <hr>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-4 country">
                        <h3 class="country-name">
                            <i class="flag-icon flag-icon-ad"></i>
                            Andorra
                        </h3>
                        <div class="country-info">
                            <strong>Capital:</strong> <span class="country-capital">Andorra la Vella</span><br>
                            <strong>Population:</strong> <span class="country-population">84000</span><br>
                            <strong>Area (km<sup>2</sup>):</strong> <span class="country-area">468.0</span><br>
                        </div>
                    </div><!--.col-->
                </div>
</div>`
    expect(htmlToMarkdown(html, { baseUrl: 'https://www.scrapethissite.com/pages/simple/' })).toBe(
      [
        '# Countries of the World: A Simple Example 250 items',
        '---',
        'There are [4 video lessons](https://www.scrapethissite.com/lessons/) that show you how to scrape this page.',
        '---',
        '### Andorra',
        '**Capital:** Andorra la Vella  \n**Population:** 84000  \n**Area (km²):** 468.0',
      ].join('\n\n'),
    )
  })

  it('en.wikipedia.org population table with line breaks in cells (S10)', () => {
    const html = `<table class="wikitable sortable mw-datatable">
<caption>List of countries and territories by total population</caption>
<tbody><tr><th>Location</th>
<th>Population</th>
<th style="width:2em">% of<br>world</th>
<th>Date</th>
<th><span class="nowrap">Source (official or from</span><br>the <a href="https://en.wikipedia.org/wiki/United_Nations" title="United Nations">United Nations</a>)</th>
<th class="unsortable">Notes</th></tr>
<tr>
<td><span class="flagicon"><span class="mw-image-border"><span><img src="//thumb.wikimedia.org/wikipedia/en/thumb/4/41/Flag_of_India.svg/40px-Flag_of_India.svg.png" alt="" height="15" width="23" class="mw-file-element"/></span></span></span> <a href="https://en.wikipedia.org/wiki/Demographics_of_India" title="Demographics of India">India</a></td>
<td style="text-align:right">1,429,404,000</td><td style="text-align:right;font-size:inherit"><span data-sort-value="7,001,172,774,265,385,000♠" style="display:none"></span>17.3%</td><td><span data-sort-value="000000002026-07-01-0000" style="white-space:nowrap">1 Jul 2026</span></td>
<td>Official projection<sup class="mw-ref reference"><a href="#cite_note-5"><span class="mw-reflink-text"><span class="cite-bracket">[</span>4<span class="cite-bracket">]</span></span></a></sup></td><td><sup class="mw-ref reference"><a href="#cite_note-6"><span class="mw-reflink-text"><span class="cite-bracket">[</span>b<span class="cite-bracket">]</span></span></a></sup></td></tr>
</tbody></table>`
    // Cells keep their links and images as a paragraph does: the flag, the
    // country's article, and the citations as same-page fragments.
    expect(htmlToMarkdown(html, { baseUrl: 'https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population' })).toBe(
      [
        'List of countries and territories by total population',
        '| Location | Population | % of world | Date | Source (official or from the [United Nations](https://en.wikipedia.org/wiki/United_Nations)) | Notes |',
        '| --- | --- | --- | --- | --- | --- |',
        '| ![](https://thumb.wikimedia.org/wikipedia/en/thumb/4/41/Flag_of_India.svg/40px-Flag_of_India.svg.png) [India](https://en.wikipedia.org/wiki/Demographics_of_India) | 1,429,404,000 | 17.3% | 1 Jul 2026 | Official projection[[4]](#cite_note-5) | [[b]](#cite_note-6) |',
      ].join('\n'),
    )
  })
})
