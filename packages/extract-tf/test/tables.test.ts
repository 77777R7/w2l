import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, htmlToTables } from '../src/index.js'
import { MAX_PAGE_TABLE_CHARS, MAX_TABLE_CHARS } from '../src/markdown.js'

const gfmTables = (markdown: string): number => markdown.split('\n').filter((line) => /^\| (---( \| ---)*) \|$/.test(line)).length

describe('htmlToTables', () => {
  it('gives each data table the Markdown writes as a GFM table, in its order, as plain cells', () => {
    const html = '<main>' +
      '<table><tr><td><a href="/">Home</a></td><td><a href="/b">B</a></td></tr></table>' + // one row: a bar of links, not data
      '<table><caption>Table 1: <b>Sales</b>, 2025</caption>' +
      '<thead><tr><th>Region</th><th colspan="2">Quarter</th></tr><tr><th></th><th>Q1</th><th>Q2</th></tr></thead>' +
      '<tbody><tr><td rowspan="2">North</td><td><a href="https://x.example/q1">1,200</a></td><td>a|b "c"</td></tr>' +
      '<tr><td>1 300</td><td><img src="/i.png" alt="up"> rising</td></tr></tbody></table>' +
      '<table><tr><td>Station</td><td>Height</td></tr><tr><td>Pier<table><tr><td>inner</td></tr><tr><td>cell</td></tr></table></td><td>4.2</td></tr></table>' +
      '</main>'
    const tables = htmlToTables(html, { baseUrl: 'https://x.example/' })
    expect(tables).toHaveLength(gfmTables(htmlToMarkdown(html, { baseUrl: 'https://x.example/' })))
    expect(tables).toEqual([
      {
        tableIndex: 0, caption: 'Table 1: Sales, 2025', headerRows: 2,
        rows: [['Region', 'Quarter', 'Quarter'], ['', 'Q1', 'Q2'], ['North', '1,200', 'a|b "c"'], ['North', '1 300', 'up rising']],
      },
      { tableIndex: 1, caption: null, headerRows: 0, rows: [['Station', 'Height'], ['Pier inner cell', '4.2']] },
    ])
  })

  it('finds the data tables inside a layout table, as the Markdown does', () => {
    const story = (n: number) => `<tr><td>${n}.</td><td>Story ${n}</td></tr>`
    const html = `<table><tr><td>Header</td></tr><tr><td><table>${story(1)}${story(2)}${story(3)}</table></td></tr><tr><td>Footer</td></tr></table>`
    const tables = htmlToTables(html)
    expect(gfmTables(htmlToMarkdown(html))).toBe(1)
    expect(tables.map((table) => table.rows)).toEqual([[['1.', 'Story 1'], ['2.', 'Story 2'], ['3.', 'Story 3']]])
  })

  it('caps spans as browsers do and omits a table too large to give, keeping the index of the next', () => {
    // 4 KB of HTML whose span, repeated, would be 4 * 10^9 characters (3 * 10^6 once capped at 1000 columns): omitted.
    const hostile = `<table><tr><td colspan="1000000">${'x'.repeat(3000)}</td></tr><tr><td>y</td></tr></table>`
    const capped = '<table><tr><td colspan="5000">wide</td></tr><tr><td>a</td></tr></table>'
    const next = '<table><tr><td>k</td><td>v</td></tr><tr><td>1</td><td>2</td></tr></table>'
    const started = Date.now()
    const tables = htmlToTables(hostile + capped + next)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(3001 * 1000).toBeGreaterThan(MAX_TABLE_CHARS)
    expect(tables[0]).toEqual({ tableIndex: 0, caption: null, headerRows: 0, rows: [], omitted: 'too_large' })
    expect(tables[1]!.rows[0]).toHaveLength(1000)
    expect(tables[1]!.rows[0]!.every((cell) => cell === 'wide')).toBe(true)
    expect(tables[2]).toMatchObject({ tableIndex: 2, rows: [['k', 'v'], ['1', '2']] })
  })

  it('reads a span as browsers do: its leading digits, 1 when it has none, is negative or is a colspan of 0', () => {
    const [cols, rows] = htmlToTables(
      '<table><tr><td colspan="2.9">a</td><td colspan=" +2abc">b</td><td colspan="0">c</td><td colspan="-3">d</td><td colspan="x">e</td></tr><tr><td>1</td></tr></table>' +
        '<table><tr><td rowspan="1.5">a</td><td rowspan="2.5">b</td><td rowspan="-2">c</td></tr><tr><td>d</td></tr><tr><td>e</td><td>f</td><td>g</td></tr></table>',
    )
    expect(cols!.rows).toEqual([['a', 'a', 'b', 'b', 'c', 'd', 'e'], ['1', '', '', '', '', '', '']])
    expect(rows!.rows).toEqual([['a', 'b', 'c'], ['d', 'b', ''], ['e', 'f', 'g']])
    // 2,547 bytes of HTML: a fractional rowspan never ended and filled its column in every later row (166 million characters of JSON).
    const [wide] = htmlToTables(`<table><tr><td colspan="1000" rowspan="1.5">${'x'.repeat(1000)}</td></tr>${'<tr></tr>'.repeat(165)}</table>`)
    expect(wide!.rows).toHaveLength(166)
    expect(wide!.rows[0]!.every((cell) => cell === 'x'.repeat(1000))).toBe(true)
    expect(wide!.rows.slice(1).every((row) => row.length === 1000 && row.every((cell) => cell === ''))).toBe(true)
    expect(JSON.stringify(wide).length).toBeLessThan(MAX_TABLE_CHARS)
  })

  it('spans a rowspan of 0 to the end of its row group, as browsers do', () => {
    const html = '<table><thead><tr><th rowspan="0">h</th><th>a</th></tr><tr><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    expect(htmlToTables(html)[0]!.rows).toEqual([['h', 'a'], ['h', 'b'], ['1', '2']])
    expect(htmlToTables('<table><tr><td rowspan="0">a</td><td>b</td></tr><tr><td>c</td></tr></table>')[0]!.rows).toEqual([['a', 'b'], ['a', 'c']])
  })

  it('covers every row a rowspan spans, as browsers do: rows too short to reach its column, and not past its row group', () => {
    const [short, empty, past, overlap] = htmlToTables(
      // Chromium places i under b: the short row c counts toward b's rowspan.
      '<table><tr><td>a</td><td>a2</td><td rowspan="3">b</td></tr><tr><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr><tr><td>g</td><td>h</td><td>i</td></tr></table>' +
        '<table><tbody><tr><td>a</td><td rowspan="2">b</td></tr><tr></tr></tbody><tbody><tr><td>x</td><td>y</td></tr></tbody></table>' +
        '<table><tbody><tr><td>a</td><td rowspan="5">b</td></tr><tr><td>c</td></tr></tbody><tbody><tr><td>x</td><td>y</td></tr></tbody></table>' +
        // Two spans over one slot (a table model error) both count every row; the later cell's value is in the slot.
        '<table><tr><td>a</td><td rowspan="3">b</td></tr><tr><td colspan="2" rowspan="2">c</td></tr><tr></tr><tr><td>x</td><td>y</td></tr></table>',
    )
    expect(short!.rows).toEqual([['a', 'a2', 'b', ''], ['c', '', 'b', ''], ['d', 'e', 'b', 'f'], ['g', 'h', 'i', '']])
    expect(empty!.rows).toEqual([['a', 'b'], ['', 'b'], ['x', 'y']])
    expect(past!.rows).toEqual([['a', 'b'], ['c', 'b'], ['x', 'y']])
    expect(overlap!.rows).toEqual([['a', 'b'], ['c', 'c'], ['c', 'c'], ['x', 'y']])
  })

  it('puts the first <thead> first and the first <tfoot> last, wherever they are written, as browsers lay them out', () => {
    const r = (t: string) => `<tr><td>${t}</td><td>${t}.</td></tr>`
    const rows = (html: string) => htmlToTables(html).map((table) => [table.headerRows, table.rows.map((row) => row[0])])
    // The order Chromium lays each out in; a second <thead> or <tfoot> stays where it is written.
    expect(rows(`<table><tbody>${r('b1')}</tbody><thead>${r('h1')}</thead><tbody>${r('b2')}</tbody></table>`)).toEqual([[1, ['h1', 'b1', 'b2']]])
    expect(rows(`<table><tbody>${r('b1')}</tbody><thead>${r('h1')}</thead><thead>${r('h2')}</thead></table>`)).toEqual([[1, ['h1', 'b1', 'h2']]])
    expect(rows(`<table><tfoot>${r('f1')}</tfoot><tbody>${r('b1')}</tbody><tfoot>${r('f2')}</tfoot><tbody>${r('b2')}</tbody></table>`)).toEqual([[0, ['b1', 'f2', 'b2', 'f1']]])
    expect(rows(`<table><tfoot>${r('f1')}</tfoot><thead>${r('h1')}</thead>${r('r1')}</table>`)).toEqual([[1, ['h1', 'r1', 'f1']]])
    // An empty first <thead> or <tfoot> is still the header or footer: a later one stays where it is.
    expect(rows(`<table><thead></thead><tbody>${r('b1')}</tbody><thead>${r('h1')}</thead></table>`)).toEqual([[0, ['b1', 'h1']]])
    expect(rows(`<table><tfoot></tfoot>${r('b0')}<tbody>${r('b1')}</tbody><tfoot>${r('f1')}</tfoot><tbody>${r('b2')}</tbody></table>`)).toEqual([[0, ['b0', 'b1', 'f1', 'b2']]])
    // A browser's parser closes the cell at a <thead> written in it, so that empty <thead> is the first.
    expect(rows(`<table><tbody>${r('b1')}<tr><td><thead></thead></td></tr></tbody><thead>${r('h1')}</thead></table>`)).toEqual([[0, ['b1', '', 'h1']]])
    // A browser moves the <div> out of the <thead>; its row is still the header's.
    expect(rows(`<table><tbody>${r('b1')}</tbody><thead><div>${r('h1')}</div></thead></table>`)).toEqual([[1, ['h1', 'b1']]])
    // Each group moves whole: a rowspan of 0 still ends with its <tbody>.
    expect(htmlToTables(`<table><tbody><tr><td rowspan="0">s</td><td>b1</td></tr><tr><td>b2</td></tr></tbody><thead><tr><th>H</th><th>I</th></tr></thead>${r('r1')}</table>`)[0]!.rows)
      .toEqual([['H', 'I'], ['s', 'b1'], ['s', 'b2'], ['r1', 'r1.']])
    // The rows directly in the table before and after the <thead> are two groups, as a browser wraps each run in a <tbody>.
    expect(htmlToTables(`<table><tr><td>a</td><td rowspan="4">s</td></tr><thead>${r('h1')}</thead>${r('r1')}${r('r2')}</table>`)[0]!.rows)
      .toEqual([['h1', 'h1.'], ['a', 's'], ['r1', 'r1.'], ['r2', 'r2.']])
  })

  it('gives no budget back to the page for a negative span', () => {
    // Three tables of about 1,893,000 characters: the page's budget gives two of them.
    const near = `<table><tr><td colspan="1000">${'x'.repeat(1890)}</td></tr><tr><td>y</td></tr></table>`
    expect(htmlToTables(near.repeat(3)).map((table) => table.omitted)).toEqual([undefined, undefined, 'too_large'])
    for (const [span, length] of [['colspan="-1000"', 2000], ['colspan="1000" rowspan="-1000"', 10]] as const) {
      const negative = `<table><tr><td ${span}>${'x'.repeat(length)}</td></tr><tr><td>y</td></tr></table>`
      const tables = htmlToTables(negative + near.repeat(3))
      expect(tables.map((table) => table.omitted)).toEqual([undefined, undefined, undefined, 'too_large'])
    }
  })

  it('finds each row\'s group without walking past its table, however deep the table is', () => {
    // ~900 KB: 30,000 rows in a <div> in a table 4,000 elements deep.
    const html = `${'<div>'.repeat(4000)}<table><div>${'<tr><td>a</td><td>b</td></tr>'.repeat(30_000)}</div></table>${'</div>'.repeat(4000)}`
    const started = Date.now()
    expect(htmlToTables(html, { onlyMainContent: false })[0]!.rows).toHaveLength(30_000)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('shares one budget among a page\'s tables, so many tables just under the cap cannot add up to a huge response', () => {
    const near = `<table><tr><td colspan="1000">${'x'.repeat(1990)}</td></tr><tr><td>y</td></tr></table>`
    const tables = htmlToTables(near.repeat(150))
    expect(tables).toHaveLength(150)
    const given = tables.filter((table) => table.omitted === undefined)
    expect(given.length).toBeGreaterThan(0)
    expect(given.length).toBeLessThanOrEqual(Math.floor(MAX_PAGE_TABLE_CHARS / (1990 * 1000)))
    expect(tables.map((table) => table.tableIndex)).toEqual(tables.map((_, i) => i))
    expect(JSON.stringify(tables).length).toBeLessThan(4 * MAX_PAGE_TABLE_CHARS)
    // Quotes count with their escaping: a cell of quotes reaches the cap sooner than its length says.
    expect(htmlToTables(`<table><tr><td colspan="1000">${'"'.repeat(1000)}</td></tr><tr><td>y</td></tr></table>`)[0]!.omitted).toBe('too_large')
    expect(htmlToTables(`<table><tr><td colspan="1000">${'\u0001'.repeat(1000)}</td></tr><tr><td>y</td></tr></table>`)[0]!.omitted).toBe('too_large')
  })

  it('counts the empty cells that pad every row to the widest in a table\'s size', () => {
    // 380 KB of HTML: one wide empty row over 20,000 one-cell rows pads to 20,001 rows of 1,000 cells (60 MB of JSON).
    const padded = `<table><tr><td colspan="1000"></td></tr>${'<tr><td>y</td></tr>'.repeat(20_000)}</table>`
    const next = '<table><tr><td>k</td><td>v</td></tr><tr><td>1</td><td>2</td></tr></table>'
    const html = padded + next
    const tables = htmlToTables(html)
    expect(tables[0]).toEqual({ tableIndex: 0, caption: null, headerRows: 0, rows: [], omitted: 'too_large' })
    expect(tables[1]).toMatchObject({ tableIndex: 1, rows: [['k', 'v'], ['1', '2']] })
    expect(tables).toHaveLength(gfmTables(htmlToMarkdown(html)))
    // The padding counts against the page's budget too: ten tables each just under the cap cannot all be given.
    const near = `<table><tr><td colspan="1000"></td></tr>${'<tr><td>y</td></tr>'.repeat(600)}</table>`
    const many = htmlToTables(near.repeat(10))
    expect(many.filter((table) => table.omitted === undefined).length).toBeLessThanOrEqual(Math.floor(MAX_PAGE_TABLE_CHARS / (3 * 1000 * 600)))
    expect(JSON.stringify(many).length).toBeLessThan(4 * MAX_PAGE_TABLE_CHARS)
  })

  it('keeps its indexes when the Markdown writes a table too large to pad unpadded', () => {
    // One wide empty row over 2,000 one-cell rows: the GFM grid would add 2 million empty cells.
    const html = `<table><tr><td colspan="1000"></td></tr>${'<tr><td>y</td></tr>'.repeat(2_000)}</table>` +
      '<table><tr><td>k</td><td>v</td></tr><tr><td>1</td><td>2</td></tr></table>'
    const markdown = htmlToMarkdown(html)
    expect(markdown.length).toBeLessThan(html.length)
    const tables = htmlToTables(html)
    expect(tables).toHaveLength(gfmTables(markdown))
    expect(tables[1]).toMatchObject({ tableIndex: 1, rows: [['k', 'v'], ['1', '2']] })
  })

  it('leaves out what the Markdown leaves out: excluded elements and empty tables', () => {
    const html = '<table class="ads"><tr><td>a</td></tr><tr><td>b</td></tr></table><table><tr></tr><tr></tr></table><table><tr><td>x</td></tr><tr><td>y</td></tr></table>'
    expect(htmlToTables(html, { exclude: ['.ads'] }).map((table) => [table.tableIndex, table.rows])).toEqual([[0, [['x'], ['y']]]])
    expect(htmlToTables('')).toEqual([])
  })
})
