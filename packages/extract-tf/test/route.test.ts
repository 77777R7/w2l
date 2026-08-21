import { describe, expect, it } from 'vitest'
import { extractTf, routePage, selectList, selectTable } from '../src/index.js'
import { parse } from '../src/dom.js'

const wrap = (bodyHtml: string, headExtra = '') =>
  `<!doctype html><html><head><title>Page</title>${headExtra}</head><body>${bodyHtml}</body></html>`

const PRODUCT_LD = (over = '') =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Four-spout infusion teapot","offers":{"@type":"Offer","price":"84.00","priceCurrency":"USD"}${over}}</script>`

const TABLE_SNIPPET =
  '<table><tr><th>Capacity</th><th>Glaze</th><th>Firing</th></tr><tr><td>600ml</td><td>Cobalt ash</td><td>1260C</td></tr></table>'

const POST_SNIPPET = (n: number) =>
  `<article class="post" data-post-id="${n}"><h2>Re: best kiln temperature</h2><p>Post body ${n} with enough prose to classify as a text block in the cascade.</p></article>`

describe('routePage', () => {
  it('routes a link-farm list to listing', () => {
    const doc = parse(
      wrap('<main><h1>Logs</h1><ul>' +
        Array.from({ length: 10 }, (_, i) => `<li><a href="/l/${i}">Log ${i}</a></li>`).join('') +
        '</ul></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('listing')
    expect(d.strategy).toBe('list')
    doc.close()
  })

  it('routes a JSON-LD product page to product with the product strategy', () => {
    const doc = parse(wrap(`<main><h1>Teapot</h1>${TABLE_SNIPPET}<p>Hand-thrown stoneware.</p></main>`, PRODUCT_LD()))
    const d = routePage(doc.document)
    expect(d.type).toBe('product')
    expect(d.strategy).toBe('product')
    doc.close()
  })

  it('routes a single-table page to collection with the table strategy (no product signal)', () => {
    const doc = parse(
      wrap('<main><h1>Readings</h1><table><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41</td></tr></table></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('collection')
    expect(d.strategy).toBe('table')
    doc.close()
  })

  it('does not route a single product-spec-shaped table to product', () => {
    // Product-spec headings alone are not proof of a product page.
    const doc = parse(
      wrap('<main><h1>Kiln archive</h1><table><tr><th>Capacity</th><th>Firing</th></tr><tr><td>600ml</td><td>1260C</td></tr></table></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('collection')
    doc.close()
  })

  it('routes a microdata product scope to product', () => {
    const doc = parse(
      wrap('<main><div itemscope itemtype="https://schema.org/Product"><h1>Teapot</h1><span itemprop="name">Four-spout teapot</span></div></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('product')
    doc.close()
  })

  it('routes JSON-LD @type array to product', () => {
    const doc = parse(
      wrap('<main><h1>Teapot</h1>' + TABLE_SNIPPET + '</main>',
        '<script type="application/ld+json">{"@type":["Product","Thing"]}</script>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('product')
    doc.close()
  })

  it('routes a full-IRI JSON-LD type to product', () => {
    const doc = parse(
      wrap('<main><h1>Teapot</h1>' + TABLE_SNIPPET + '</main>',
        '<script type="application/ld+json">{"@type":"https://schema.org/Product"}</script>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('product')
    doc.close()
  })

  it('finds Product inside JSON-LD @graph', () => {
    const doc = parse(
      wrap('<main><h1>Teapot</h1>' + TABLE_SNIPPET + '</main>',
        '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product"}]}</script>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('product')
    doc.close()
  })

  it('ignores malformed JSON-LD without throwing', () => {
    const doc = parse(
      wrap('<main><h1>Readings</h1><table><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41</td></tr></table></main>',
        '<script type="application/ld+json">{"@type":"Product", broken</script>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('collection')
    doc.close()
  })

  it('routes two independent weak product signals to product', () => {
    // price alone is not enough; price + sku are two independent weak signals.
    const doc = parse(
      wrap('<main><h1>Teapot</h1><span itemprop="price">84.00</span><span itemprop="sku">TP-04</span></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('product')
    doc.close()
  })

  it('does not route priceCurrency alone to product', () => {
    const doc = parse(wrap('<main><h1>Teapot</h1><span itemprop="priceCurrency">USD</span></main>'))
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    doc.close()
  })

  it('does not substring-match itemprop values', () => {
    // "brandish" contains "brand" but is not the brand itemprop token.
    const doc = parse(wrap('<main><h1>Teapot</h1><span itemprop="brandish">waved</span></main>'))
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    doc.close()
  })

  it('routes JSON-LD OfferCatalog to collection, not product', () => {
    const doc = parse(
      wrap('<main><h1>Catalog</h1><ul><li><a href="/c/1">Cobalt teapot</a></li><li><a href="/c/2">Ash jug</a></li></ul></main>',
        '<script type="application/ld+json">{"@type":"OfferCatalog"}</script>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('collection')
    doc.close()
  })

  it('does not route an article with JSON-LD comments to forum', () => {
    const doc = parse(
      wrap('<article><h1>Essay</h1>' +
        Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} with enough prose to satisfy the text length thresholds and count as real content.</p>`).join('') +
        '</article>',
        '<script type="application/ld+json">{"@type":"Article","comment":[{"@type":"Comment","text":"First comment"}]}</script>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    doc.close()
  })

  it('routes a forum thread to forum with the article strategy', () => {
    const doc = parse(wrap(`<main><h1>Thread: best kiln temperature</h1>${POST_SNIPPET(1)}${POST_SNIPPET(2)}</main>`))
    const d = routePage(doc.document)
    expect(d.type).toBe('forum')
    expect(d.strategy).toBe('article')
    doc.close()
  })

  it('routes a JSON-LD discussion to forum with the article strategy', () => {
    const doc = parse(
      wrap(
        '<main><h1>Thread: kiln notes</h1>' +
          '<div class="comment">The first kiln run held 1240C steady through the night.</div>' +
          '<div class="comment">The second run cooled too fast and the glaze micro-cracked along the rim.</div>' +
          '</main>',
        '<script type="application/ld+json">{"@type":"DiscussionForumPosting"}</script>',
      ),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('forum')
    expect(d.strategy).toBe('article')
    doc.close()
  })

  it('does not route a long prose page to forum', () => {
    const doc = parse(
      wrap('<article><h1>Essay</h1>' +
        Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i} with enough prose to satisfy the text length thresholds and count as real content.</p>`).join('') +
        '</article>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    doc.close()
  })

  it('does not route a single post to forum', () => {
    const doc = parse(wrap('<main><h1>Thread</h1>' + POST_SNIPPET(1) + '</main>'))
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    doc.close()
  })

  it('does not route a prose page with many comment-shaped divs to forum', () => {
    // Comment word in class names + "opinion" prose: still an article shape.
    const doc = parse(
      wrap('<article><h1>Kiln opinion essay</h1>' +
        '<div class="comments-wrapper">Comments on the winter firing:</div>' +
        Array.from({ length: 4 }, (_, i) => `<div class="comment-body"><p>Comment paragraph ${i} about glaze chemistry, holding schedules and the harbour air during firing week.</p></div>`).join('') +
        '</article>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    doc.close()
  })

  it('routes a long prose page to article', () => {
    const doc = parse(
      wrap('<article><h1>Essay</h1>' +
        Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i} with enough prose to satisfy the text length thresholds and count as real content.</p>`).join('') +
        '</article>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('article')
    expect(d.strategy).toBe('article')
    doc.close()
  })

  it('routes a small collection page to collection with article strategy', () => {
    const doc = parse(
      wrap('<main><h1>Seasonal collection 2026</h1><h2>Stoneware</h2>' +
        '<ul><li><a href="/c/1">Cobalt teapot</a></li><li><a href="/c/2">Ash jug</a></li></ul>' +
        '<h2>Porcelain</h2><ul><li><a href="/c/3">Ivory cup</a></li><li><a href="/c/4">Grey saucer</a></li></ul>' +
        '<p>Curated from the winter kiln batch.</p></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('collection')
    expect(d.strategy).toBe('article')
    doc.close()
  })

  it('routes a div-based listing to listing with the list strategy', () => {
    // quotes.toscrape.com shape: 55 links in <div class="quote"> cards, no
    // <ul>/<ol> at all, high link density (3.2 links/100 chars).
    const html = wrap(
      '<main><h1>Quotes</h1><div class="container">' +
        Array.from({ length: 10 }, (_, i) =>
          `<div class="quote"><span>Quote ${i} text here</span><a href="/a/${i}">Author ${i}</a><a href="/t/${i}">tag</a></div>`).join('') +
        '</div></main>',
    )
    const d = routePage(parse(html).document)
    expect(d.type).toBe('listing')
    expect(d.strategy).toBe('list')
  })

  it('extracts a div-based listing via the container fallback', () => {
    const html = wrap(
      '<main><h1>Quotes</h1><div class="container">' +
        Array.from({ length: 10 }, (_, i) =>
          `<div class="quote"><span>Quote ${i} text here</span><a href="/a/${i}">Author ${i}</a><a href="/t/${i}">tag</a></div>`).join('') +
        '</div></main>',
    )
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('listing')
    expect(out.escalate).toBe(false)
    expect(out.mainHtml).toContain('Author 0')
    expect(out.mainHtml).toContain('Author 9')
  })

  it('reaches all five PageType values', () => {
    const cases: Array<{ html: string; type: string }> = [
      { html: wrap('<article><h1>Essay</h1>' + Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i} with enough prose to satisfy the text length thresholds and count as real content.</p>`).join('') + '</article>'), type: 'article' },
      { html: wrap('<main><h1>Logs</h1><ul>' + Array.from({ length: 10 }, (_, i) => `<li><a href="/l/${i}">Log ${i}</a></li>`).join('') + '</ul></main>'), type: 'listing' },
      { html: wrap('<main><h1>Readings</h1><table><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41</td></tr></table></main>'), type: 'collection' },
      { html: wrap(`<main><h1>Teapot</h1>${TABLE_SNIPPET}<p>Hand-thrown stoneware.</p></main>`, PRODUCT_LD()), type: 'product' },
      { html: wrap(`<main><h1>Thread</h1>${POST_SNIPPET(1)}${POST_SNIPPET(2)}</main>`), type: 'forum' },
    ]
    const seen = new Set(cases.map((c) => {
      const doc = parse(c.html)
      const d = routePage(doc.document)
      doc.close()
      return d.type
    }))
    expect(seen).toEqual(new Set(['article', 'listing', 'collection', 'product', 'forum']))
  })
})

describe('strategies', () => {
  it('selectList picks the list with the most linked items', () => {
    const doc = parse(
      wrap('<main><h1>Catalog</h1><ul>' +
        Array.from({ length: 8 }, (_, i) => `<li><a href="/c/${i}">Item ${i}</a> — description</li>`).join('') +
        '</ul><ul><li>orphan item</li></ul></main>'),
    )
    const list = selectList(doc.document)
    expect(list).not.toBeNull()
    expect(list!.querySelectorAll(':scope > li').length).toBe(8)
    doc.close()
  })

  it('selectTable skips layout tables and picks the data table', () => {
    const doc = parse(
      wrap('<main><h1>Specs</h1>' +
        '<table><tr><td>layout cell</td></tr></table>' +
        '<table><tr><th>Cap</th><th>Glaze</th></tr><tr><td>600ml</td><td>Cobalt</td></tr></table>' +
        '</main>'),
    )
    const table = selectTable(doc.document)
    expect(table).not.toBeNull()
    expect(table!.textContent).toContain('Cobalt')
    doc.close()
  })
})

describe('extractTf page types', () => {
  it('handles an empty body without throwing: escalates, never succeeds', () => {
    // linkedom parses '' to a document with a null documentElement whose
    // body getter throws; parse() must normalize that away (empty 200
    // responses are an everyday crawl case, e.g. the empty-body fixture).
    const out = extractTf.extract('')
    expect(out.escalate).toBe(true)
    expect(out.mainHtml).toBe('')
  })

  it('extracts a listing page as listing with the list strategy', () => {
    const html = wrap(
      '<main><h1>Bespoke teapot catalog</h1><ul>' +
        Array.from({ length: 10 }, (_, i) =>
          `<li><a href="/pt/item/${i + 1}">Bespoke teapot catalog ${String(i + 1).padStart(2, '0')}</a> — hand-thrown stoneware</li>`).join('') +
        '</ul></main>',
    )
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('listing')
    expect(out.strategy).toBe('list')
    expect(out.mainHtml).toContain('Bespoke teapot catalog 01')
    expect(out.mainHtml).toContain('Bespoke teapot catalog 10')
    expect(out.escalate).toBe(false)
  })

  it('extracts a product page with the product strategy and keeps the description', () => {
    const html = wrap(`<main><h1>Four-spout infusion teapot</h1>${TABLE_SNIPPET}<p>Hand-thrown stoneware with four spouts for even infusion.</p></main>`, PRODUCT_LD())
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('product')
    expect(out.strategy).toBe('product')
    expect(out.mainHtml).toContain('Cobalt ash')
    expect(out.mainHtml).toContain('four spouts')
    expect(out.escalate).toBe(false)
  })

  it('keeps a product page product even when it has no table', () => {
    // Page type and strategy are independent, but a product page now gets
    // the product strategy either way — the spec table is one piece of the
    // product region, not the thing that selects a strategy.
    const html = wrap(
      '<main><h1>Hand-thrown teacup</h1><p>Thrown from harbour clay, glazed with cobalt ash.</p></main>',
      PRODUCT_LD(),
    )
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('product')
    expect(out.escalate).toBe(false)
    expect(out.mainHtml).toContain('harbour clay')
  })

  it('extracts a forum thread as forum via the article cascade, both posts intact', () => {
    const html = wrap(`<main><h1>Thread: best kiln temperature</h1>${POST_SNIPPET(1)}${POST_SNIPPET(2)}</main>`)
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('forum')
    expect(out.strategy).toBe('article')
    expect(out.mainHtml).toContain('Post body 1')
    expect(out.mainHtml).toContain('Post body 2')
    expect(out.escalate).toBe(false)
  })

  it('keeps type and strategy distinct: table strategy is not a product proof', () => {
    const readings = wrap(
      '<main><h1>Readings</h1><table><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41</td></tr></table></main>',
    )
    const out = extractTf.extract(readings)
    expect(out.pageType).toBe('collection')
    expect(out.strategy).toBe('table')
    expect(out.escalate).toBe(false)
  })
})
