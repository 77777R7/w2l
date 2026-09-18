import { describe, expect, it } from 'vitest'
import { extractTf } from '../src/index.js'
import {
  collectProductFacts,
  findPriceElement,
  looksLikePrice,
  pruneRecommendations,
  selectProduct,
} from '../src/index.js'
import { classifyBlocks } from '../src/classify.js'
import { parse } from '../src/dom.js'

/**
 * A storefront PDP shaped like the real thing: a thin buy-box carrying the
 * price, a description, and a recommendation grid that carries MORE text than
 * the product does. That last property is the whole problem — text-volume
 * scoring picks the grid, and an LLM then summarizes the wrong products.
 *
 * Class names follow Amazon's conventions (a-price, a-carousel) because that
 * is the DOM the user named, but nothing in the implementation keys on them:
 * the price token is `price`, which Shopify and WooCommerce also emit, and the
 * grid trigger is structural.
 */
const RECOMMENDED_CARD = (n: number) =>
  `<div class="card"><a href="/dp/REC${n}">Recommended teapot number ${n}</a>` +
  `<span class="a-price">$${19 + n}.99</span>` +
  `<p>A completely different teapot with its own long marketing description about ` +
  `cast iron construction and a lifetime warranty that has nothing to do with the ` +
  `product actually being viewed on this page right now, number ${n}.</p></div>`

const PDP = (headExtra = '') => `<!doctype html><html><head>
<title>Four-spout infusion teapot</title>${headExtra}</head><body>
<div id="dp-container">
  <div id="titleSection"><h1 id="productTitle">Four-spout infusion teapot</h1></div>
  <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$84.00</span></span></div>
  <div id="feature-bullets"><p>Hand-thrown stoneware with four spouts for even infusion, fired to 1260C in a reduction kiln over eighteen hours.</p></div>
</div>
<div id="similarities_feature_div">
  <h2>Customers who viewed this item also viewed</h2>
  <div class="a-carousel">${[1, 2, 3, 4].map(RECOMMENDED_CARD).join('')}</div>
</div>
</body></html>`

const PRODUCT_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
"name":"Four-spout infusion teapot","sku":"TP-4S-600","brand":{"@type":"Brand","name":"Harbour Clay"},
"offers":{"@type":"Offer","price":"84.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>`

describe('PDP extraction: recommendation contamination', () => {
  it('keeps the product and drops every recommended product', () => {
    const out = extractTf.extract(PDP(PRODUCT_LD))
    expect(out.pageType).toBe('product')
    expect(out.mainHtml).toContain('four spouts for even infusion')
    // The failure this exists to prevent: a neighbouring product's prose
    // reaching a summarizer as if it described this product.
    expect(out.mainHtml).not.toContain('cast iron construction')
    expect(out.mainHtml).not.toContain('Recommended teapot number')
    expect(out.mainHtml).not.toContain('also viewed')
  })

  it('reports THIS product price, not a recommended one', () => {
    const out = extractTf.extract(PDP(PRODUCT_LD))
    expect(out.product?.price?.value).toBe('84.00')
    expect(out.product?.priceCurrency?.value).toBe('USD')
    // Recommended cards are priced $20.99..$23.99; none may surface.
    expect(out.product?.price?.value).not.toMatch(/2[0-3]\.99/)
  })

  it('reads the visible price when the page declares nothing (and says so)', () => {
    // No JSON-LD, no microdata, no meta: only rendered markup. The price is
    // still recoverable, but it is OUR reading of their layout, not their
    // claim, and must be labelled 'text'.
    const doc = parse(PDP())
    pruneRecommendations(doc.document)
    const facts = collectProductFacts(doc.document)
    expect(facts.price?.value).toBe('$84.00')
    expect(facts.price?.source).toBe('text')
    doc.close()
  })

  it('would have picked a recommendation card without pruning', () => {
    // Guards the ordering in extract.ts: reading the visible price BEFORE
    // pruning finds a neighbour's price. If someone reorders those two steps,
    // this test is what tells them what they broke.
    const doc = parse(PDP())
    const unpruned = findPriceElement(doc.document)
    expect(unpruned).not.toBeNull()
    expect(unpruned!.textContent).toMatch(/2[0-3]\.99/)
    pruneRecommendations(doc.document)
    const pruned = findPriceElement(doc.document)
    expect(pruned!.textContent).toContain('84.00')
    doc.close()
  })
})

describe('PDP facts: evidence is labelled, never invented', () => {
  it('prefers JSON-LD over rendered text and records the source', () => {
    const out = extractTf.extract(PDP(PRODUCT_LD))
    expect(out.product?.name).toEqual({ value: 'Four-spout infusion teapot', source: 'jsonld' })
    expect(out.product?.price).toEqual({ value: '84.00', source: 'jsonld' })
    expect(out.product?.sku).toEqual({ value: 'TP-4S-600', source: 'jsonld' })
    expect(out.product?.brand).toEqual({ value: 'Harbour Clay', source: 'jsonld' })
    expect(out.product?.availability).toEqual({ value: 'InStock', source: 'jsonld' })
  })

  it('reads microdata content attributes, not their (empty) text', () => {
    const html = `<!doctype html><html><head><title>Kettle</title></head><body>
<div itemscope itemtype="https://schema.org/Product">
<h1 itemprop="name">Cast iron kettle</h1>
<meta itemprop="sku" content="CI-900">
<div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
<meta itemprop="price" content="129.50"><meta itemprop="priceCurrency" content="GBP">
<link itemprop="availability" href="https://schema.org/OutOfStock">
</div>
<p>Seasoned cast iron with an enamel interior, suited to induction hobs and open flame alike.</p>
</div></body></html>`
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('product')
    expect(out.product?.price).toEqual({ value: '129.50', source: 'microdata' })
    expect(out.product?.priceCurrency?.value).toBe('GBP')
    expect(out.product?.availability?.value).toBe('OutOfStock')
    expect(out.product?.sku?.value).toBe('CI-900')
  })

  it('falls back to OpenGraph product meta', () => {
    const html = `<!doctype html><html><head><title>Mug</title>
<meta property="og:title" content="Speckled stoneware mug">
<meta property="product:price:amount" content="18.00">
<meta property="product:price:currency" content="EUR">
<meta property="product:brand" content="Estuary Ceramics">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","offers":{"@type":"Offer","price":"18.00"}}</script>
</head><body><main><h1>Speckled stoneware mug</h1>
<p>Thrown from grogged clay and glazed in a speckled oatmeal that breaks over the rim.</p>
</main></body></html>`
    const out = extractTf.extract(html)
    // JSON-LD supplies the price; the meta tags fill what it left null.
    expect(out.product?.price).toEqual({ value: '18.00', source: 'jsonld' })
    expect(out.product?.priceCurrency).toEqual({ value: 'EUR', source: 'meta' })
    expect(out.product?.brand).toEqual({ value: 'Estuary Ceramics', source: 'meta' })
  })

  it('reports null for facts the page never stated', () => {
    const html = `<!doctype html><html><head><title>Bowl</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Nesting bowl"}</script>
</head><body><main><h1>Nesting bowl</h1>
<p>A shallow serving bowl thrown to nest inside its siblings for storage in a small kitchen.</p>
</main></body></html>`
    const out = extractTf.extract(html)
    expect(out.product?.name?.value).toBe('Nesting bowl')
    expect(out.product?.price).toBeNull()
    expect(out.product?.sku).toBeNull()
    expect(out.product?.availability).toBeNull()
  })

  it('carries no product facts on a non-product page', () => {
    const html = `<!doctype html><html><head><title>Report</title></head><body><article>
<h1>Harbour dredging report</h1>
<p>The survey covers forty villages and three hundred households in the upper valley, recorded over two winters.</p>
</article></body></html>`
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('article')
    expect(out.product ?? null).toBeNull()
  })

  it('ignores malformed JSON-LD instead of throwing', () => {
    // The broken script contributes NO signal, so the page routes to product
    // on its microdata tokens alone (sku + brand) — and the meta tags supply
    // the facts the unparseable script could not.
    const html = `<!doctype html><html><head><title>Broken</title>
<script type="application/ld+json">{"@type":"Product", "name": unquoted}</script>
<meta property="product:price:amount" content="42.00">
<meta property="product:price:currency" content="USD">
</head><body><main><h1>Salvaged item</h1>
<p>The markup on this page is broken but the meta tags still say what it costs and what it is.</p>
<span itemprop="sku">SLV-1</span><span itemprop="brand">Salvage Co</span>
</main></body></html>`
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('product')
    expect(out.product?.price).toEqual({ value: '42.00', source: 'meta' })
  })
})

describe('PDP region selection', () => {
  it('picks the buy-box region, not the largest text container', () => {
    const doc = parse(PDP(PRODUCT_LD))
    pruneRecommendations(doc.document)
    const blocks = classifyBlocks(doc.document, { minTextLength: 25, maxLinkDensity: 0.2 })
    const region = selectProduct(doc.document, blocks)
    expect(region).not.toBeNull()
    expect(region!.textContent).toContain('four spouts')
    doc.close()
  })

  it('falls back to the article cascade and reports the strategy honestly', () => {
    // A product page with no h1 and no price element: selectProduct has no
    // landmark, so the article cascade runs. The output must say 'article',
    // not claim a product strategy that never produced anything.
    const html = `<!doctype html><html><head><title>Unstructured</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Mystery item"}</script>
</head><body><div><p>This page describes an item at length but gives it no heading and shows no price anywhere in its markup at all.</p>
<p>A second paragraph continues the description with more prose so the cascade has something to select.</p></div>
</body></html>`
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('product')
    expect(out.strategy).toBe('article')
    expect(out.mainHtml).toContain('describes an item at length')
  })

  it('honours a declared microdata scope as the product boundary', () => {
    const html = `<!doctype html><html><head><title>Scoped</title></head><body>
<div id="page">
<div itemscope itemtype="https://schema.org/Product" id="the-product">
<h1 itemprop="name">Scoped teapot</h1><span class="price">$55.00</span>
<p>The publisher drew this boundary itself, so the extractor does not need to guess where it is.</p>
</div>
<div class="also-viewed"><p>Neighbouring product prose that sits outside the declared scope entirely.</p></div>
</div></body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('publisher drew this boundary')
    expect(out.mainHtml).not.toContain('Neighbouring product prose')
  })
})

describe('recommendation pruning: precision guards', () => {
  it('does not prune a listing page (its cards ARE the content)', () => {
    const html = `<!doctype html><html><head><title>Teapot catalog</title></head><body>
<main><h1>Teapot catalog</h1><div class="grid">${[1, 2, 3, 4].map(RECOMMENDED_CARD).join('')}</div></main>
</body></html>`
    const out = extractTf.extract(html)
    expect(out.pageType).not.toBe('product')
    expect(out.mainHtml).toContain('Recommended teapot number 1')
  })

  it('keeps sections about THIS product', () => {
    const html = `<!doctype html><html><head><title>Kettle</title>${PRODUCT_LD}</head><body>
<main><h1>Four-spout infusion teapot</h1><span class="price">$84.00</span>
<h2>Product description</h2><p>Hand-thrown stoneware fired to 1260C over eighteen hours in a reduction kiln.</p>
<h2>Specifications</h2><p>Capacity six hundred millilitres, cobalt ash glaze, dishwasher safe on the lower rack.</p>
<h2>Customers also bought</h2><div>${[1, 2, 3].map(RECOMMENDED_CARD).join('')}</div>
</main></body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('reduction kiln')
    expect(out.mainHtml).toContain('cobalt ash glaze')
    expect(out.mainHtml).not.toContain('Customers also bought')
    expect(out.mainHtml).not.toContain('cast iron construction')
  })

  it('does not prune a related-articles rail on an article page', () => {
    // Links without prices are not a product grid. This is why the grid
    // trigger requires a price: an article's "read next" list must survive.
    const html = `<!doctype html><html><head><title>Report</title></head><body>
<article><h1>Dredging report</h1>
<p>The survey covers forty villages and three hundred households in the upper valley over two winters.</p>
<div class="read-next"><a href="/a">Story A</a><a href="/b">Story B</a><a href="/c">Story C</a></div>
</article></body></html>`
    const doc = parse(html)
    pruneRecommendations(doc.document)
    expect(doc.document.body.innerHTML).toContain('Story A')
    doc.close()
  })

  it('does not cut the product gallery for being a carousel', () => {
    // A bare "carousel" token is the product's OWN image gallery on most
    // storefronts; only co-purchase-specific tokens may cut.
    const doc = parse(`<!doctype html><html><body>
<div class="image-carousel"><img src="/1.jpg"><p>Product photography of the item being sold on this page.</p></div>
</body></html>`)
    pruneRecommendations(doc.document)
    expect(doc.document.body.innerHTML).toContain('Product photography')
    doc.close()
  })

  it('cuts CJK recommendation headings too', () => {
    const doc = parse(`<!doctype html><html><body>
<div id="main"><h1>四嘴泡茶壶</h1><p>手工拉坯的炻器茶壶，四个壶嘴使茶汤浸出更均匀，在还原焰中烧至一千二百六十度。</p></div>
<div id="recs"><h2>购买了此商品的顾客也买了</h2><p>另一件完全不同的商品的描述文字，与本页正在浏览的商品毫无关系。</p></div>
</body></html>`)
    pruneRecommendations(doc.document)
    const html = doc.document.body.innerHTML
    expect(html).toContain('四个壶嘴')
    expect(html).not.toContain('购买了此商品的顾客')
    expect(html).not.toContain('毫无关系')
    doc.close()
  })
})

describe('price shape', () => {
  it('matches the currency conventions storefronts actually ship', () => {
    for (const s of ['$84.00', '£1,299.99', '€18,50', '¥3980', 'USD 84.00', '84.00 EUR', '₹1,49,900']) {
      expect(looksLikePrice(s)).toBe(true)
    }
  })

  it('does not match bare numbers or dates', () => {
    for (const s of ['600ml', '1260C', '2026-08-21', 'eighteen hours', '4.7 out of 5 stars']) {
      expect(looksLikePrice(s)).toBe(false)
    }
  })

  it('terminates promptly on adversarial input', () => {
    // The matcher runs over attacker-supplied page text; an unbounded
    // quantifier here is the same class of bug as a ReDoS in the robots
    // matcher. Bounded quantifiers must keep this linear.
    const hostile = '$' + '1'.repeat(50_000) + ',' + '9'.repeat(50_000) + 'x'
    const start = process.hrtime.bigint()
    looksLikePrice(hostile)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    expect(ms).toBeLessThan(200)
  })
})
