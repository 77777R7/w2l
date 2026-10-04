import { describe, expect, it } from 'vitest'
import { extractTf, htmlToMarkdown } from '../src/index.js'
import { parse } from '../src/dom.js'

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
    // 300 rowspans a thousand columns wide stacked over 100 empty rows, 30 and 60 times (~0.7 and ~1.4 MB). Twice the
    // tables take about twice the time where each rowspan is counted once, four times where every row visits them all:
    // the ratio holds on a slow or busy machine, where a fixed limit in seconds does not. The faster of two runs counts.
    let stacked = '<table>'
    for (let i = 0; i < 300; i++) stacked += `<tr>${i < 299 ? `<td colspan="${299 - i}"></td>` : ''}<td colspan="1000" rowspan="60000"></td></tr>`
    stacked += `${'<tr></tr>'.repeat(100)}</table>`
    const time = (copies: number): number => {
      let best = Infinity
      for (let run = 0; run < 2; run++) {
        const started = performance.now()
        expect(htmlToMarkdown(stacked.repeat(copies)).length).toBeLessThan(2 * stacked.length * copies)
        best = Math.min(best, performance.now() - started)
      }
      return best
    }
    const once = time(30)
    expect(time(60) / once).toBeLessThan(3)
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

  it('writes a table of 200,000 rows, in time proportional to its rows', () => {
    const table = (rows: number) => `<table>${'<tr><td>y</td></tr>'.repeat(rows)}</table>`
    // A table this tall once overflowed the call stack.
    expect(htmlToMarkdown(table(200_000)).split('\n')).toHaveLength(200_001)
    // Twice the rows take about twice the time: the ratio holds on a slow or busy machine, where a fixed limit in
    // seconds (the test runner's own included) does not. The faster of two runs counts.
    const time = (rows: number): number => {
      let best = Infinity
      for (let run = 0; run < 2; run++) {
        const started = performance.now()
        expect(htmlToMarkdown(table(rows)).split('\n')).toHaveLength(rows + 1)
        best = Math.min(best, performance.now() - started)
      }
      return best
    }
    const once = time(50_000)
    expect(time(100_000) / once).toBeLessThan(3)
  }, 60_000)

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

  it('ends an svg at an HTML element written in it, as a browser does, and keeps what follows', () => {
    // Chromium's document.body.innerText of each page with its svg elements removed (the converter skips svg).
    const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`
    expect(htmlToMarkdown(page('<svg><text>t</text><p>b</p></svg><p>c</p>'))).toBe('b\n\nc')
    expect(htmlToMarkdown(page('<div>a<svg><circle/><div>d</div>e</div>f'))).toBe('a\n\nd\n\ne\n\nf')
    expect(htmlToMarkdown(page('<svg><text>t</p>u</text></svg><p>v</p>'))).toBe('u\n\nv')
    expect(htmlToMarkdown(page('<svg><g><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></g></svg><p>e</p>')))
      .toBe('| a | b |\n| --- | --- |\n| c | d |\n\ne')
    // In a foreignObject the HTML is the svg's own; an svg in it ends there, and the outer svg at its own end tag.
    expect(htmlToMarkdown(page('<svg><foreignObject><p>f</p></foreignObject></svg><p>g</p>'))).toBe('g')
    expect(htmlToMarkdown(page('<svg><foreignObject><svg><text>i</text><b>j</b></svg>k</foreignObject>l</svg><p>m</p>'))).toBe('kl\n\nm')
    // An end tag there for an element outside the svg closes nothing.
    expect(htmlToMarkdown(page('<div>a<svg><foreignObject><p>x</div>y</p></foreignObject></svg>z</div><p>after</p>'))).toBe('az\n\nafter')
    // A </template> there closes its template all the same.
    expect(htmlToMarkdown(page('<template><svg><foreignObject><p>x</template><p>after</p>'))).toBe('after')
    // A fragment too.
    expect(htmlToMarkdown('<svg><svg><g><span>s</span></g></svg></svg>w')).toBe('sw')
  })

  it('ignores an end tag such as </span> that would close a block written in its element, as a browser does', () => {
    // Chromium's document.body.innerText of each page.
    const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`
    expect(htmlToMarkdown(page('<span><div>w1</span></span>w2'))).toBe('w1w2')
    expect(htmlToMarkdown(page('<label><div>a</label>b</div><p>c</p>'))).toBe('ab\n\nc')
    expect(htmlToMarkdown(page('<my-card><div>a</my-card>b<p>c</p>'))).toBe('ab\n\nc')
    expect(htmlToMarkdown(page('<sup><p>1</sup>2</p>'))).toBe('12')
    // In a table cell too.
    expect(htmlToMarkdown(page('<table><tr><td><span><div>a</span>b</div></td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table>')))
      .toBe('| ab | c |\n| --- | --- |\n| d | e |')
    // A <noscript> holds text to a browser: its end tag ends it, whatever htmlparser2 reads in it.
    expect(htmlToMarkdown(page('<noscript><p>Please enable JavaScript.</noscript><h1>Title</h1><p>Article <span>text</span>.</p>'))).toBe('# Title\n\nArticle text.')
    // A heading's end tag closes the heading open, of any level.
    expect(htmlToMarkdown(page('<h3>a</h2>b<p>c</p>'))).toBe('### a\n\nb\n\nc')
    // An element a browser has closed is not in between: the <p>, closed at the <div>.
    expect(htmlToMarkdown(page('<span><p>x<b>y<div>z</div></span>w'))).toBe('x**y**\n\n**z**\n\n**w**')
  })

  it('closes a list item, a heading or a paragraph where a browser does, so the next is not nested in it', () => {
    // Chromium's document.body.innerHTML of each page.
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    expect(body('<ul><li><span>a<li>b</span>c</ul><p>d</p>')).toBe('<ul><li><span>a</span></li><li>bc</li></ul><p>d</p>')
    expect(body('<ol><li><div>a<li>b</ol>')).toBe('<ol><li><div>a</div></li><li>b</li></ol>')
    expect(body('<dl><dt><span>a<dd>b</span></dl>')).toBe('<dl><dt><span>a</span></dt><dd>b</dd></dl>')
    expect(body('<h1>a<h2>b</h2>c</h1>d')).toBe('<h1>a</h1><h2>b</h2>cd')
    expect(body('<p>a<span>b<ul><li>c</ul>d')).toBe('<p>a<span>b</span></p><ul><li>c</li></ul>d')
    expect(body('<button>a<span><button>b')).toBe('<button>a<span></span></button><button>b</button>')
    // An end tag closes its element only in scope: not a <li> past a <ul>, nor a <p> past a <button>.
    expect(body('<ul><li>a<ol><li>b</li></li>c</ol></ul>')).toBe('<ul><li>a<ol><li>b</li>c</ol></li></ul>')
    expect(body('<p>a<button>b</p>c</button>d')).toBe('<p>a<button>b<p></p>c</button>d</p>')
    expect(htmlToMarkdown('<!doctype html><html><body><ul><li>One<span> item<li>Two</span></ul></body></html>')).toBe('- One item\n- Two')
    // Nothing in a <noscript> (text to a browser) or a <select> closes past it.
    expect(body('<p>a<noscript><p>enable JS</p></noscript>b')).toBe('<p>a<noscript><p>enable JS</p></noscript>b</p>')
    expect(body('<p>a<select><option>x<div>y</div></select>b')).toBe('<p>a<select><option>x<div>y</div></option></select>b</p>')
  })

  it('reopens a formatting element a browser has closed, and moves a block out of one, as a browser does', () => {
    // Chromium's document.body.innerHTML of each page.
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    expect(body('<p><b>x</p>y')).toBe('<p><b>x</b></p><b>y</b>')
    expect(body('<p><b>x</p><p>y</p>')).toBe('<p><b>x</b></p><p><b>y</b></p>')
    expect(body('<p><a href="/1">a<p>b</a>c')).toBe('<p><a href="/1">a</a></p><p><a href="/1">b</a>c</p>')
    expect(body('<b><div>x</b>y</div>')).toBe('<b></b><div><b>x</b>y</div>')
    expect(body('<b><i><div>x</b>y</div>z')).toBe('<b><i></i></b><i><div><b>x</b>y</div>z</i>')
    expect(body('<b><span><div>x</b>y</div>')).toBe('<b><span></span></b><div><b>x</b>y</div>')
    expect(body('<em>a<ul><li>b</em>c</ul>d')).toBe('<em>a</em><ul><em></em><li><em>b</em>c</li></ul>d')
    expect(body('<a href="/1">a<a href="/2">b</a>')).toBe('<a href="/1">a</a><a href="/2">b</a>')
    // Two adoptions at one block: the later copy holds the earlier.
    expect(body('<i><b><div>x</i>y</b>z</div>q')).toBe('<i><b></b></i><b></b><div><b><i>x</i>y</b>z</div>q')
    // An end tag in an svg closes its link, which is not reopened after it.
    expect(body('<p><a href="/x"><svg><path d="M0"></a> Home</p><p>Next</p>')).toBe('<p><a href="/x"><svg><path d="M0" /></svg></a> Home</p><p>Next</p>')
    // The Markdown: a link around a block is a link in it (and an empty one before it, written as its target), and the text
    // after a closed <b> is bold, as a browser shows it.
    const page = (html: string) => htmlToMarkdown(`<!doctype html><html><body>${html}</body></html>`, { baseUrl: 'https://example.test/' })
    expect(page('<a href="/l"><div>x</a>y</div>')).toBe('[https://example.test/l](https://example.test/l)\n\n[x](https://example.test/l)y')
    expect(page('<p><b>Note:</p><p>read this</p>')).toBe('**Note:**\n\n**read this**')
  })

  it('follows a browser\'s form element pointer: a nested <form> is ignored, and </form> leaves what is open in the form open', () => {
    // Chromium's document.body.innerHTML of each page, its implied <tbody> left out.
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML.replace(/<\/?tbody>/g, '')
    expect(body('<form><form>x</form>y</form>z')).toBe('<form>x</form>yz')
    expect(body('<form><div>a</form>b</div>c')).toBe('<form><div>ab</div></form>c')
    expect(body('<form><div><div>a</form>b</div>c</div>d')).toBe('<form><div><div>ab</div>c</div></form>d')
    expect(body('<div><form></div><form>x</form>y')).toBe('<div><form></form></div>xy')
    expect(body('<table><form><tr><td>a</td></tr></table><form>b</form>')).toBe('<table><form></form><tr><td>a</td></tr></table>b')
    // A form in a <noscript> (text to a browser) neither sets nor clears it.
    expect(body('<noscript><form>a</form></noscript><form>b</form>')).toBe('<noscript><form>a</form></noscript><form>b</form>')
    expect(body('<form>a<noscript><form>b</form></noscript>c</form>d')).toBe('<form>a<noscript><form>b</form></noscript>c</form>d')
    // In a <template> the pointer is not used.
    expect(body('<template><form><form>x</form></form></template>y')).toBe('<template><form><form>x</form></form></template>y')
    // Directly in a template, an end tag but its own is ignored.
    expect(body('<template></p><div>x</div></template>')).toBe('<template><div>x</div></template>')
    expect(body('<template><div></div></p></template>')).toBe('<template><div></div><p></p></template>')
  })

  it('reads a table cell by the same body rules, the cell ending what is open in it', () => {
    // Chromium's document.body.innerHTML of each page, its implied <tbody> left out.
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    expect(body('<table><tr><td><p><b>x</p>y</td><td>z</td></tr></table>')).toBe('<table><tr><td><p><b>x</b></p><b>y</b></td><td>z</td></tr></table>')
    expect(body('<table><tr><td><b><div>x</b>y</div></td></tr></table>')).toBe('<table><tr><td><b></b><div><b>x</b>y</div></td></tr></table>')
    expect(body('<table><tr><td><ul><li><span>a<li>b</span></ul></td></tr></table>')).toBe('<table><tr><td><ul><li><span>a</span></li><li>b</li></ul></td></tr></table>')
    // An end tag in a cell closes nothing outside it; a <b> opened before the table is not reopened in a cell.
    expect(body('<div><table><tr><td>a</div>b</td></tr></table>')).toBe('<div><table><tr><td>ab</td></tr></table></div>')
    expect(body('<p><b>x</p><table><tr><td>y</td></tr></table>')).toBe('<p><b>x</b></p><table><tr><td>y</td></tr></table>')
    // An svg left open in a cell ends with it: a self-closing <p/> after the table is an HTML <p> again.
    expect(body('<table><tr><td><svg><g></td></tr></table><p/>z')).toBe('<table><tr><td><svg><g /></svg></td></tr></table><p>z</p>')
    // A cell's table tags still go by the table rules: a </td> in an svg is the svg's, a <col> ends the cell.
    expect(body('<table><tr><td><svg><td>a</td>b</svg>c</td><td>d</td></tr></table>')).toBe('<table><tr><td><svg><td>a</td>b</svg>c</td><td>d</td></tr></table>')
    expect(body('<table><tr><td>a<col>b</td><td>c</td></tr></table>')).toBe('<table><tr><td>a</td></tr><col>b<tbody><tr><td>c</td></tr></tbody></table>')
  })

  it('reopens after a table a formatting element written between its rows, as a browser does', () => {
    // Chromium shows y bold (and the z it moves before the table): the <b> it moved out of the table stays on its list.
    const page = (html: string) => htmlToMarkdown(`<!doctype html><html><body>${html}</body></html>`, { baseUrl: 'https://example.test/' })
    const rows = '<tr><td>x</td><td>w</td></tr><tr><td>v</td><td>u</td></tr>'
    const grid = '| x | w |\n| --- | --- |\n| v | u |'
    expect(page(`<table><b>z${rows}</table>y`)).toBe(`**z**\n\n${grid}\n\n**y**`)
    expect(page(`<table><a href="/l">${rows}</table>y`)).toBe(`[https://example.test/l](https://example.test/l)\n\n${grid}\n\n[y](https://example.test/l)`)
    // Its end tag between the rows ends it; in a cell the cell's marker keeps it closed.
    expect(page(`<table><b>${rows}</b></table>y`)).toBe(`${grid}\n\ny`)
    // A hidden <input> and white space between the rows stay in the table, and reopen nothing.
    expect(page(`<p><a href="/o">Home</p><form><table><input type="hidden" name="t">&#32;${rows}</table></form>`)).toBe(`[Home](https://example.test/o)\n\n${grid}`)
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
  it('joins adjacent runs of one emphasis or code without rewriting the run each time', () => {
    const md = (html: string) => htmlToMarkdown(`<!doctype html><html><body><p>${html}</p></body></html>`)
    expect(md('<code>a`</code><code>`b</code><code>c</code>')).toBe('```a``bc```')
    expect(md('<code>`a</code><code>b</code>')).toBe('`` `ab ``')
    expect(md('<b>a</b><b>b.</b>c')).toBe('**ab**.c')
    const started = Date.now()
    expect(md('<code>a`</code>'.repeat(80_000)).length).toBeLessThan(200_000)
    expect(md('<b>a.</b>'.repeat(80_000)).length).toBeLessThan(200_000)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('keeps emphasis next to punctuation readable as emphasis: the punctuation at an edge goes outside the markers where it must', () => {
    const md = (html: string) => htmlToMarkdown(`<!doctype html><html><body><p>${html}</p></body></html>`)
    // A marker between a letter and punctuation is plain text to CommonMark.
    expect(md('a<b>"x"</b>b')).toBe('a"**x**"b')
    expect(md('<b>Note:</b>text')).toBe('**Note**:text')
    expect(md('x<b>(1)</b>')).toBe('x(**1)**')
    // Two runs of different emphasis side by side: the second with underscores, as their stars would join.
    expect(md('<b>x</b><i>.y</i>')).toBe('**x**_.y_')
    expect(md('<i>x</i><b>y</b>')).toBe('*x*__y__')
    // White space next to the moved punctuation moves with it.
    expect(md('w<b>, x:</b>y')).toBe('w, **x**:y')
    // Only punctuation written from text moves: a link, code span or image at the edge stays whole inside the markers.
    expect(md('<b><a href="https://e.test/x">链接</a></b>文字')).toBe('**[链接](https://e.test/x)**文字')
    expect(md('<i><code>npm</code></i>s')).toBe('*`npm`*s')
    expect(md('<b>x<img src="https://e.test/i.png" alt="i"></b>y')).toBe('**x![i](https://e.test/i.png)**y')
    // A backslash moved before the opening marker is escaped, as it would escape the marker.
    expect(md('x<b>\\a</b>')).toBe('x\\\\**a**')
    expect(md('<i>“quoted”</i>word')).toBe('*“quoted*”word')
    // Where the markers read as they are, nothing moves; a run of punctuation alone between letters stays plain text.
    expect(md('<b>Note:</b> text')).toBe('**Note:** text')
    expect(md('a <b>"x"</b> b')).toBe('a **"x"** b')
    expect(md('a<b>!</b>b')).toBe('a!b')
  })

  it('escapes text only where CommonMark would read it as Markdown, so it renders as written', () => {
    const md = (html: string) => htmlToMarkdown(`<!doctype html><html><body>${html}</body></html>`)
    // Ordinary text stays as written: an underscore inside a word, a star between spaces, balanced brackets.
    expect(md('<p>snake_case and 2 * 3 [note] a.b</p>')).toBe('snake_case and 2 * 3 [note] a.b')
    // Text that would become emphasis, code, a link, HTML or an entity.
    expect(md('<p>*not bold* and _not em_ and `not code`</p>')).toBe('\\*not bold\\* and \\_not em\\_ and \\`not code\\`')
    expect(md('<p>[x](y) &lt;div&gt; &amp;amp; C:\\*</p>')).toBe('[x\\](y) \\<div> \\&amp; C:\\\\\\*')
    // At the start of a line: a heading, list item, quote or rule.
    expect(md('<p># tag</p><p>- dash</p><p>1. one</p><p>&gt; quote</p><p>---</p>')).toBe('\\# tag\n\n\\- dash\n\n1\\. one\n\n\\> quote\n\n\\---')
    expect(md('<p>a<br>= b<br>+ c<br>===</p>')).toBe('a  \n= b  \n\\+ c  \n\\===')
    // The parser splits text at entities; it is escaped as a whole.
    expect(md('<p>x &lt;div&gt; &amp;amp; snake&#95;case</p>')).toBe('x \\<div> \\&amp; snake_case')
    // Code stays as written; the tables format stays plain text.
    expect(md('<p><code>*a*_b_</code></p>')).toBe('`*a*_b_`')
    // Adjacent runs of one emphasis are one run.
    expect(md('<p><b>a</b><b>b</b></p>')).toBe('**ab**')
    // Adjacent code spans are one span, and a `!` before a link stays text.
    expect(md('<p><code>a</code><code>b</code> x</p>')).toBe('`ab` x')
    expect(md('<p>wow!<a href="https://e.test/x">link</a></p>')).toBe('wow\\![link](https://e.test/x)')
    expect(md('<p>a\\!<a href="https://e.test/x">t</a></p>')).toBe('a\\\\\\![t](https://e.test/x)')
  })

  it('writes emphasis CommonMark reads as emphasis: white space at its edges outside the markers, a last backslash escaped', () => {
    const md = (html: string) => htmlToMarkdown(`<!doctype html><html><body>${html}</body></html>`)
    // A full-width space (a CJK paragraph indent) next to a marker makes it plain text to CommonMark.
    expect(md('<b><p>\u3000indent</p></b>')).toBe('\u3000**indent**')
    expect(md('<p><strong>\u3000lead</strong> rest</p>')).toBe('\u3000**lead** rest')
    expect(md('<b>x\u3000</b>y')).toBe('**x**\u3000y')
    expect(md('<i>\u3000</i>z')).toBe('\u3000z')
    // A backslash before the closing marker would escape it.
    expect(md('<em>path C:\\</em> end')).toBe('*path C:\\\\* end')
    expect(md('<b><div>C:\\</div></b>')).toBe('**C:\\\\**')
  })

  it('keeps the emphasis of a <b> or <em> around blocks on each paragraph in it, as a browser shows it', () => {
    const md = (html: string) => htmlToMarkdown(`<!doctype html><html><body>${html}</body></html>`, { baseUrl: 'https://e.test/' })
    expect(md('<b>w1<p>w2</p>w3</b>')).toBe('**w1**\n\n**w2**\n\n**w3**')
    expect(md('a <strong>b<div>c</div></strong> d')).toBe('a **b**\n\n**c**\n\nd')
    expect(md('<em><div>x</div></em>')).toBe('*x*')
    expect(md('<b><div><a href="/x">w1</a></div></b>')).toBe('**[w1](https://e.test/x)**')
    // List items and quotes take it too; a <b> in it adds no second marker; headings, code and tables keep their own form.
    expect(md('<b><ul><li>a</li><li><p>b</p></li></ul></b>')).toBe('- **a**\n- **b**')
    expect(md('<b><blockquote><p>q</p></blockquote></b>')).toBe('> **q**')
    expect(md('<b><div><b>x</b> y</div></b>')).toBe('**x y**')
    expect(md('<b><h2>x</h2>y<pre>z</pre></b>')).toBe('## x\n\n**y**\n\n```\nz\n```')
    expect(md('<b><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></b>')).toBe('| a | b |\n| --- | --- |\n| c | d |')
  })

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
  it('escapes a backslash that would escape the bracket or parenthesis closing a link or image', () => {
    const md = (html: string, baseUrl?: string) => htmlToMarkdown(`<!doctype html><html><body>${html}</body></html>`, baseUrl ? { baseUrl } : {})
    expect(md('<a href="/x">C:\\</a> next', 'https://e.test/')).toBe('[C:\\\\](https://e.test/x) next')
    expect(md('<img src="/i.png" alt="dir\\"> next', 'https://e.test/')).toBe('![dir\\\\](https://e.test/i.png) next')
    expect(md('<a href="http://e.test/a\\">t</a>')).toBe('[t](http://e.test/a\\\\)')
    expect(md('<a href="http://e.test/a b\\">t</a>')).toBe('[t](<http://e.test/a b\\\\>)')
    // In a target every backslash is doubled, as one before another backslash or punctuation escapes it.
    expect(md('<a href="mailto:a\\\\b\\.c">t</a>')).toBe('[t](mailto:a\\\\\\\\b\\\\.c)')
    expect(md('<a href="/x">plain</a>', 'https://e.test/')).toBe('[plain](https://e.test/x)')
  })

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
