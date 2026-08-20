import { describe, expect, it } from 'vitest'
import { extractTf, routePage, selectList, selectTable } from '../src/index.js'
import { parse } from '../src/dom.js'

const wrap = (bodyHtml: string) =>
  `<!doctype html><html><head><title>Page</title></head><body>${bodyHtml}</body></html>`

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

  it('routes a single-table page to table', () => {
    const doc = parse(
      wrap('<main><h1>Readings</h1><table><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41</td></tr></table></main>'),
    )
    const d = routePage(doc.document)
    expect(d.type).toBe('collection')
    expect(d.strategy).toBe('table')
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
  it('extracts a listing page as listing with the list strategy', () => {
    const html = wrap(
      '<main><h1>Bespoke teapot catalog</h1><ul>' +
        Array.from({ length: 10 }, (_, i) =>
          `<li><a href="/pt/item/${i + 1}">Bespoke teapot catalog ${String(i + 1).padStart(2, '0')}</a> — hand-thrown stoneware</li>`).join('') +
        '</ul></main>',
    )
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('listing')
    expect(out.mainHtml).toContain('Bespoke teapot catalog 01')
    expect(out.mainHtml).toContain('Bespoke teapot catalog 10')
    expect(out.escalate).toBe(false)
  })

  it('extracts a product page with the table strategy and keeps the description', () => {
    const html = wrap(
      '<main><h1>Four-spout infusion teapot</h1>' +
        '<table><tr><th>Capacity</th><th>Glaze</th><th>Firing</th></tr><tr><td>600ml</td><td>Cobalt ash</td><td>1260C</td></tr></table>' +
        '<p>Hand-thrown stoneware with four spouts for even infusion.</p></main>',
    )
    const out = extractTf.extract(html)
    expect(out.pageType).toBe('collection')
    expect(out.mainHtml).toContain('Cobalt ash')
    expect(out.escalate).toBe(false)
  })

  it('still extracts a forum thread via the article cascade', () => {
    const html = wrap(
      '<main><h1>Thread: best kiln temperature</h1>' +
        '<article class="post"><h2>Re: best kiln temperature</h2><p>We fire stoneware at 1260C and the glaze never crazes over the long winter months.</p></article>' +
        '<article class="post"><h2>Re: best kiln temperature</h2><p>Our kiln holds 1240C steady, and the harbour air keeps the clay from drying too fast between firings.</p></article>' +
        '</main>',
    )
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('glaze never crazes')
    expect(out.escalate).toBe(false)
  })
})
