import { describe, expect, it } from 'vitest'
import { detectLists, extractListRecords, resolveListSpec } from '../src/index.js'
import { MAX_SELECTOR_PARTS, selectorParts } from '../src/selectors.js'
import { parse } from '../src/dom.js'

/**
 * Detection on a hostile page costs a bounded multiple of reading the page:
 * measured against parsing the same HTML on the same machine, not against a
 * wall clock that a loaded CI runner stretches, each the faster of two runs
 * so a pause elsewhere in the run does not count. Measured on these pages,
 * the detector costs 1 to 4 parses alone and up to 10 while the whole suite
 * runs; before each bound it cost 13 (text-free subtrees) to over 100 (a
 * list deep in a page).
 */
const MAX_PARSES = 12
function expectBounded(html: string, maxParses = MAX_PARSES): ReturnType<typeof detectLists> {
  // Warm: the first run of the detector's code is not what is measured.
  detectLists('<ul class="w"><li>one item</li><li>two items</li><li>three items</li></ul>')
  const time = (run: () => void): number => {
    let best = Infinity
    for (let i = 0; i < 2; i++) {
      const started = Date.now()
      run()
      best = Math.min(best, Date.now() - started)
    }
    return best
  }
  // A parse of a string not parsed before: dom.ts keeps the last pages' trees, so parsing the same string again only copies one.
  let fresh = 0
  const parsed = Math.max(time(() => parse(`${html}<!--${fresh++}-->`).close()), 20)
  let found: ReturnType<typeof detectLists> = []
  const detected = time(() => { found = detectLists(html) })
  expect(detected / parsed).toBeLessThan(maxParses)
  return found
}

const product = (n: number) => `<div class="product"><a href="/p/${n}"><img src="/img/${n}.png" alt=""></a><h3 class="name"><a href="/p/${n}">Product ${n}</a></h3><p class="price">£${n}.99</p><button class="buy">Add to cart</button></div>`
// A shop page: a menu of links in the header, products in rows of three, links in the footer.
const SHOP = `<html><body>
<header><nav><ul class="menu">${['Home', 'Shop', 'About', 'Contact', 'Blog', 'Help'].map((label) => `<li><a href="/${label}">${label}</a></li>`).join('')}</ul></nav></header>
<main><h1>Kettles</h1><div class="grid">${[0, 1, 2, 3].map((row) => `<div class="row">${[1, 2, 3].map((i) => product(row * 3 + i)).join('')}</div>`).join('')}</div></main>
<footer><ul class="links">${['Terms', 'Privacy', 'Jobs', 'Press'].map((label) => `<li><a href="/${label}">${label}</a></li>`).join('')}</ul></footer>
</body></html>`

describe('detectLists', () => {
  it('finds the products across their rows, not the menus, and the fields they hold', () => {
    const [best, ...rest] = detectLists(SHOP)
    expect(best).toMatchObject({ itemSelector: 'div.row > div.product', count: 12 })
    expect(best!.fields).toEqual([
      { name: 'link', selector: 'a', attribute: 'href' },
      { name: 'image', selector: 'img', attribute: 'src' },
      { name: 'name', selector: 'h3.name > a' },
      { name: 'name_link', selector: 'h3.name > a', attribute: 'href' },
      { name: 'price', selector: 'p.price' },
    ])
    // The button reads the same on every product: a label, not a field.
    expect(best!.fields.map((field) => field.name)).not.toContain('buy')
    expect(rest.map((list) => list.itemSelector)).not.toContain('div.row > div.product')
    expect(rest.every((list) => list.score < best!.score)).toBe(true)
  })

  it('what it finds reads as records', () => {
    const [best] = detectLists(SHOP)
    const records = extractListRecords(SHOP, 'https://shop.test/kettles', { type: 'list', ...best! })
    expect(records).toHaveLength(12)
    expect(records[4]!.values).toEqual({ link: 'https://shop.test/p/5', image: 'https://shop.test/img/5.png', name: 'Product 5', name_link: 'https://shop.test/p/5', price: '£5.99' })
  })

  it('a cell whose state class differs between rows is still one field', () => {
    const row = (n: number, state: string) => `<tr class="team"><td class="name">Team ${n}</td><td class="wins">${n * 3}</td><td class="pct ${state}">0.${n}</td></tr>`
    const html = `<table class="table"><tr><th>Name</th><th>Wins</th><th>%</th></tr>${[1, 2, 3, 4, 5].map((n) => row(n, n % 2 === 0 ? 'text-success' : 'text-danger')).join('')}</table>`
    const [best] = detectLists(html)
    // The rows are in the <tbody> a browser opens for them, as the page is parsed.
    expect(best).toMatchObject({ itemSelector: 'tbody > tr.team', count: 5 })
    expect(best!.fields).toEqual([{ name: 'name', selector: 'td.name' }, { name: 'wins', selector: 'td.wins' }, { name: 'pct', selector: 'td.pct' }])
  })

  it('leaves out a field no selector tells from an earlier one in the item', () => {
    const quote = (n: number) => `<div class="quote"><span class="text">Quote ${n}</span><span>by Author ${n}</span></div>`
    const html = `<div class="col">${[1, 2, 3].map(quote).join('')}</div>`
    // The second span: its selector `span` finds the first one first.
    expect(detectLists(html)[0]!.fields).toEqual([{ name: 'text', selector: 'span.text' }])
  })

  it('items with no inner elements are read whole', () => {
    expect(detectLists('<main><ul class="todo"><li>Buy milk</li><li>Walk the dog</li><li>Call home</li></ul></main>')[0]).toMatchObject({ itemSelector: 'ul.todo > li', fields: [{ name: 'text' }] })
  })

  it('finds nothing on a page without repeated elements, or whose repeats hold no text', () => {
    expect(detectLists('<main><h1>About</h1><p>One paragraph.</p><div>A box</div></main>')).toEqual([])
    // An article's paragraphs and headings, and a table's cells, are parts of records, not records.
    expect(detectLists(`<article>${'<h2>Part</h2><p>Some prose, long enough to read.</p>'.repeat(5)}</article>`)).toEqual([])
    expect(detectLists(`<div class="grid">${'<div class="cell"><img src="/x.png"></div>'.repeat(5)}</div>`)).toEqual([])
  })
})

describe('detectLists, on pages that would mislead it', () => {
  it('a field some items lack is missing from them, not read from another element', () => {
    const sold = (n: number) => `<div class="p"><h3>Name ${n}</h3><em><span>Sold out ${n}</span></em></div>`
    const html = `<div class="list">${[1, 2, 3].map((n) => `<div class="p"><h3>Name ${n}</h3><span>£${n}.00</span></div>`).join('')}${sold(4)}${sold(5)}</div>`
    const [best] = detectLists(html)
    const records = extractListRecords(html, 'https://x.test/', { type: 'list', ...best! })
    expect(records.map((record) => record.values.price ?? null)).toEqual(['£1.00', '£2.00', '£3.00', null, null])
  })

  it('never names a field after a column the list adds', () => {
    const html = `<ul class="books">${[1, 2, 3, 4].map((n) => `<li class="book"><span class="title">Book ${n}</span><span class="page">p. ${n}0</span><span class="index">#${n}</span><span class="source_url">u${n}</span></li>`).join('')}</ul>`
    const names = detectLists(html)[0]!.fields.map((field) => field.name)
    expect(names).toEqual(['title', 'page_2', 'index_2', 'source_url_2'])
  })

  it('leaves out an element whose tag a selector cannot name (Word\'s o:p)', () => {
    const html = `<div class="l">${[1, 2, 3].map((n) => `<div class="it"><o:p>V${n}</o:p><b>N${n}</b></div>`).join('')}</div>`
    const [best] = detectLists(html)
    expect(best!.fields).toEqual([{ name: 'text', selector: 'b' }])
    expect(extractListRecords(html, 'https://x.test/', { type: 'list', ...best! })[0]!.values.text).toBe('N1')
  })

  it('does not take a site\'s navigation for the page\'s list', () => {
    const shell = `<header><nav><ul>${['Home', 'Shop', 'About', 'Blog', 'Help'].map((label) => `<li><a href="/${label}">${label}</a></li>`).join('')}</ul></nav></header><div id="app"></div>`
    expect(detectLists(shell)).toEqual([])
  })

  it('items in the footer are not read with the posts that share their layout', () => {
    const block = (items: string) => `<div class="container"><div class="row"><div class="col-md-12"><ul class="list-unstyled">${items}</ul></div></div></div>`
    const posts = [1, 2, 3, 4, 5, 6].map((n) => `<li><a href="/post/${n}">Post number ${n}</a><span class="date">2026-10-0${n}</span></li>`).join('')
    const links = ['Terms', 'Privacy', 'Jobs'].map((label) => `<li><a href="/${label}">${label}</a></li>`).join('')
    const html = `<body><main>${block(posts)}</main><footer>${block(links)}</footer></body>`
    const [best] = detectLists(html)
    expect(best!.count).toBe(6)
    expect(extractListRecords(html, 'https://x.test/', { type: 'list', ...best! }).map((record) => record.values.title)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Post number ${n}`))
  })

  it('a list only in an aside is not the page\'s list', () => {
    expect(detectLists(`<main><h1>Home</h1></main><aside><ul>${[1, 2, 3, 4].map((n) => `<li><a href="/${n}">Headline ${n}</a><p>Summary ${n}</p></li>`).join('')}</ul></aside>`)).toEqual([])
  })

  it('selectors stay within what a request may send back', () => {
    const classes = Array.from({ length: 21 }, (_, i) => `u-utility-class-${i}`).join(' ')
    const html = `<div class="grid">${[1, 2, 3, 4].map((n) => `<div class="${classes}"><b class="${classes}">Item ${n}</b><i class="${classes}">Note ${n}</i></div>`).join('')}</div>`
    const [best] = detectLists(html)
    for (const selector of [best!.itemSelector, ...best!.fields.flatMap((field) => field.selector ?? [])]) expect(selector.length).toBeLessThanOrEqual(200)
    expect(selectorParts(best!.itemSelector) + best!.fields.reduce((sum, field) => sum + (field.selector === undefined ? 0 : selectorParts(field.selector)), 0)).toBeLessThanOrEqual(MAX_SELECTOR_PARTS)
  })

  it('a lazy image\'s source is the one that differs, not the placeholder every item has', () => {
    const html = `<ul class="g">${[1, 2, 3].map((n) => `<li class="c"><img src="data:image/gif;base64,R0lGOD" data-src="/img/${n}.jpg"><b>Item ${n}</b></li>`).join('')}</ul>`
    expect(detectLists(html)[0]!.fields).toContainEqual({ name: 'image', selector: 'img', attribute: 'data-src' })
  })

  it('a parent with a class attribute of thousands is read in bounded time', () => {
    const k = 10_000
    const html = `<main><div class="${Array.from({ length: k }, (_, i) => `c${i}`).join(' ')}">${'<i>ab</i>'.repeat(k)}</div></main>`
    // 11.8 s before classes were read once per element, and at most eight of them.
    expectBounded(html)
  }, 30_000)

  it('a page of many groups of one shape is named in bounded time', () => {
    const group = (k: number) => `<div class="p k${k}">${'<div class="a">xx</div>'.repeat(1000)}</div>`
    const html = `<div class="w"><div class="h"><div class="g">${Array.from({ length: 64 }, (_, k) => group(k)).join('')}</div></div></div>`
    // 15.4 s before the work was bounded.
    expectBounded(html)
  }, 30_000)

  it('a field the items past the first two hundred lack is missing from them too', () => {
    const item = (i: number) => i < 200 ? `<li class="it"><h3>Item ${i}</h3><div class="m"><span>by author ${i}</span></div></li>` : `<li class="it"><h3>Item ${i}</h3><p class="ad"><span>Sponsored ${i}</span></p></li>`
    const html = `<ul class="l">${Array.from({ length: 210 }, (_, i) => item(i)).join('')}</ul>`
    const [best] = detectLists(html)
    const records = extractListRecords(html, 'https://x.test/', { type: 'list', ...best! })
    const author = best!.fields.find((field) => field.selector?.endsWith('span'))!.name
    expect(records[0]!.values[author]).toBe('by author 0')
    expect(records.slice(200).map((record) => record.values[author])).toEqual(Array(10).fill(null))
  })

  it('a lazy list some of whose images have loaded is read from data-src', () => {
    const html = `<div class="grid">${Array.from({ length: 12 }, (_, i) => `<div class="card"><img class="lazyload" src="${i < 3 ? `/img/${i}.jpg` : 'data:image/gif;base64,R0lGOD'}" data-src="/img/${i}.jpg"><h3>Product ${i}</h3></div>`).join('')}</div>`
    expect(detectLists(html)[0]!.fields).toContainEqual({ name: 'image', selector: 'img.lazyload', attribute: 'data-src' })
  })

  it('a lazy list whose placeholder is a URL is read from data-src', () => {
    const html = `<div class="grid">${Array.from({ length: 10 }, (_, i) => `<div class="card"><img src="${i < 3 ? `/img/${i}.jpg` : '/img/placeholder.png'}" data-src="/img/${i}.jpg"><h3>Product ${i}</h3></div>`).join('')}</div>`
    expect(detectLists(html)[0]!.fields).toContainEqual({ name: 'image', selector: 'img', attribute: 'data-src' })
  })

  it('a list whose loader has moved most data-src into src is read from src', () => {
    const html = `<div class="grid">${Array.from({ length: 10 }, (_, i) => `<div class="card">${i < 8 ? `<img src="/i/${i}.jpg">` : `<img data-src="/i/${i}.jpg">`}<h3>Product ${i}</h3></div>`).join('')}</div>`
    expect(detectLists(html)[0]!.fields).toContainEqual({ name: 'image', selector: 'img', attribute: 'src' })
  })

  it('a parent tag name of millions of characters is read in bounded time', () => {
    const tag = `x-${'a'.repeat(1_000_000)}`
    // 14 s when every read of the tag copied it.
    expectBounded(`<body><${tag}>${'<i>x</i>'.repeat(80_000)}</${tag}></body>`)
  }, 60_000)

  it('a parent class name of millions of characters is read in bounded time', () => {
    const html = `<body><div class="${'a'.repeat(2_000_000)}">${'<i>x</i>'.repeat(80_000)}</div></body>`
    // 12 to 17 s when every child's group key held its parent's whole class.
    expectBounded(html)
  }, 60_000)

  it('a text node of megabytes is scored in bounded time', () => {
    let html = `<i>${'a '.repeat(4_000_000)}</i>`
    for (let k = 59; k >= 0; k--) html = `<div class="p${k}"><div class="g${k}">xx ${html}</div><div class="g${k}">yy</div><div class="g${k}">zz</div></div>`
    // 11.9 s when every group read the whole text.
    expectBounded(`<body>${html}</body>`)
  }, 60_000)

  it('items hidden by their own attribute (skeletons, a template) are kept out by the selector, not a reason to find no list', () => {
    const cards = Array.from({ length: 10 }, (_, i) => `<div class="card"><h3>Product ${i}</h3><span class="price">$${i}.99</span></div>`).join('')
    for (const html of [
      `<main><div class="grid">${cards}${'<div class="card card--skeleton" aria-hidden="true"></div>'.repeat(2)}</div></main>`,
      `<main><div class="grid"><div class="card" hidden><h3>Template</h3></div>${cards}</div></main>`,
    ]) {
      const [best] = detectLists(html)
      expect(best).toMatchObject({ itemSelector: 'div.grid > div.card:not([hidden]):not([aria-hidden="true"])', count: 10 })
      expect(extractListRecords(html, 'https://x.test/', { type: 'list', ...best! })).toHaveLength(10)
    }
  })

  it('a list deep in a page is named in bounded time', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => `<li class="it">item number ${i} text</li>`).join('')
    const html = `<body>${'<div class="w">'.repeat(4000)}<div class="a b"><ul class="l">${items(10_000)}</ul></div><div class="a c"><ul class="l">${items(10_000)}</ul></div>${'</div>'.repeat(4000)}</body>`
    // 17 s, 119 parses, when every climb walked every item's ancestors; 3 to 12 parses since (a deep page parses fast).
    expectBounded(html, 40)
  }, 60_000)

  it('items with large text-free subtrees are scored in bounded time', () => {
    const tree = (depth: number): string => depth === 0 ? '<b></b>' : `<a>${tree(depth - 1)}${tree(depth - 1)}</a>`
    let html = tree(18)
    for (let k = 59; k >= 0; k--) html = `<div class="p${k}"><div class="g${k}">xx ${html}</div><div class="g${k}">yy</div><div class="g${k}">zz</div></div>`
    // 3.7 MB: 9.6 s when every group read its items' whole text, 2 s with the text read bounded.
    expectBounded(`<body>${html}</body>`, 8)
  }, 60_000)

  it('items with thousands of distinct parts are read in bounded time', () => {
    const item = (i: number) => `<div class="it">${Array.from({ length: 8000 }, (_, k) => `<span class="c${k}">v${i}_${k}</span>`).join('')}</div>`
    const html = `<main><div class="list">${[1, 2, 3, 4, 5].map(item).join('')}</div></main>`
    // 22 s before the bound on paths per item.
    const best = expectBounded(html)[0]
    expect(best!.fields.length).toBeLessThanOrEqual(12)
  }, 30_000)
})

describe('resolveListSpec', () => {
  it('keeps a list the request names in full, and says nothing was detected', () => {
    const request = { type: 'list' as const, itemSelector: 'div.product', fields: [{ name: 'n', selector: 'h3' }] }
    expect(resolveListSpec(SHOP, request)).toEqual({ spec: request })
  })

  it('finds the fields of the items named, and the list and its fields when none are named', () => {
    const named = resolveListSpec(SHOP, { type: 'list', itemSelector: 'div.product' })
    expect(named.spec?.itemSelector).toBe('div.product')
    expect(named.detected).toEqual({ fields: named.spec!.fields, alternatives: [] })
    expect(named.spec!.fields.map((field) => field.name)).toEqual(['link', 'image', 'name', 'name_link', 'price'])
    const found = resolveListSpec(SHOP, { type: 'list' })
    expect(found.spec?.itemSelector).toBe('div.row > div.product')
    expect(found.detected?.alternatives.length).toBeGreaterThan(0)
  })

  it('no list on the page: no spec', () => {
    expect(resolveListSpec('<p>Nothing here</p>', { type: 'list' })).toEqual({ spec: null, detected: { fields: [], alternatives: [] } })
  })
})
