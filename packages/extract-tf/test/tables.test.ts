import { describe, expect, it } from 'vitest'
import { collectLinks, htmlToMarkdown, htmlToTables, withoutLayoutMarkers } from '../src/index.js'
import { MAX_PAGE_TABLE_CHARS, MAX_TABLE_CHARS } from '../src/markdown.js'
import { parse } from '../src/dom.js'

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

  it('closes a cell at a row, cell or row group written in it, as the browser\'s parser does', () => {
    const table = (html: string) => {
      const [t] = htmlToTables(html)
      return { caption: t!.caption, headerRows: t!.headerRows, rows: t!.rows }
    }
    // Each expected grid is the one Chromium builds from the same HTML.
    expect(table('<table><tr><td>a<thead><tr><td>x</td><td>y</td></tr></thead></td><td>q</td></tr><tr><td>b</td><td>c</td></tr></table>'))
      .toEqual({ caption: null, headerRows: 1, rows: [['x', 'y'], ['a', ''], ['q', ''], ['b', 'c']] })
    expect(table('<table><tr><td><div>a<tr><td>b</td><td>c</td></tr></div></td><td>d</td></tr></table>').rows).toEqual([['a', ''], ['b', 'c'], ['d', '']])
    expect(table('<table><tr><td>a<th>b</th>c</td></tr><tr><td>d</td><td>e</td></tr></table>').rows).toEqual([['a', 'b'], ['d', 'e']])
    expect(table('<table><tr><td>a<span>s<tfoot><tr><td>f</td><td>g</td></tr></tfoot>t</span>u</td><td>v</td></tr><tr><td>b</td><td>c</td></tr></table>').rows)
      .toEqual([['as', ''], ['v', ''], ['b', 'c'], ['f', 'g']])
    expect(table('<table><tr><td>a<caption>cap</caption></td><td>z</td></tr><tr><td>b</td><td>c</td></tr></table>'))
      .toEqual({ caption: 'cap', headerRows: 0, rows: [['a', ''], ['z', ''], ['b', 'c']] })
    expect(table('<table><tr><td>a<tbody><tr><td>b</td><td>c</td></tr></tbody></td><td>z</td></tr></table>').rows).toEqual([['a', ''], ['b', 'c'], ['z', '']])
    // A cell 4,000 elements deep is rebuilt without running out of call stack.
    expect(table(`<table><tr><td>${'<span>'.repeat(4000)}a<thead><tr><td>h</td><td>i</td></tr></thead>${'</span>'.repeat(4000)}</td></tr><tr><td>b</td><td>c</td></tr></table>`).rows)
      .toEqual([['h', 'i'], ['a', ''], ['b', 'c']])
    // A <template>'s rows are not the table's, wherever it is.
    const template = '<template x-for="r in more"><tr><td>NAME</td><td>QTY</td></tr></template><template x-if="loading"><div class="spinner"></div></template>'
    expect(table(`<table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>apple</td><td>3</td></tr>${template}</tbody></table>`).rows)
      .toEqual([['Name', 'Qty'], ['apple', '3']])
    expect(table(`<table><tr><td>a<thead><tr><td>x</td><td>y</td></tr></thead></td></tr>${template}<tr><td>b</td><td>c</td></tr></table>`).rows)
      .toEqual([['x', 'y'], ['a', ''], ['b', 'c']])
    // A table nested in a cell is still that cell's text.
    expect(table('<table><tr><td>a<table><tr><td>n</td></tr><tr><td>m</td></tr></table></td><td>z</td></tr><tr><td>b</td><td>c</td></tr></table>').rows)
      .toEqual([['a n m', 'z'], ['b', 'c']])
  })

  it('reads a table\'s tags as a browser does: an end tag it ignores closes nothing, a cell it closes is closed', () => {
    const rows = (html: string) => htmlToTables(html).map((t) => [t.headerRows, t.rows])
    // Each expected grid is Chromium's. htmlparser2 applied each of these end tags to an element further out.
    // The cell's own </td> after a <td> written in it, once a <thead> in the outer cell has closed that cell.
    expect(rows('<table><tbody><tr><th>A</th><td><thead><tr><td><div>B</div><td>C</td></td></tr><tr><td>D</td><td>E</td></tr></thead></td></tr><tr><td>F</td><td>G</td></tr></tbody></table>'))
      .toEqual([[2, [['B', 'C'], ['D', 'E'], ['A', ''], ['F', 'G']]]])
    // The same in a table nested in a cell: it closed the outer cell and the nested table.
    expect(rows('<table><tr><td>out<table><tr><td>a<td>b</td></td></tr><tr><td>c</td><td>d</td></tr></table>tail</td><td>z</td></tr><tr><td>y</td><td>w</td></tr></table>'))
      .toEqual([[0, [['out a b c d tail', 'z'], ['y', 'w']]]])
    // An end tag for an element outside the table closed the table.
    const div = '<div><table><tr><td>a</div>b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table></div><p>after</p>'
    expect(rows(div)).toEqual([[0, [['ab', 'c'], ['d', 'e']]]])
    expect(htmlToMarkdown(div)).toBe('| ab | c |\n| --- | --- |\n| d | e |\n\nafter')
    const body = '<table><tr><td>a</td><td>b</td></tr></body><tr><td>c</td><td>d</td></tr></table><p>after</p>'
    expect(rows(body)).toEqual([[0, [['a', 'b'], ['c', 'd']]]])
    expect(htmlToMarkdown(body)).toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
    // A cell directly in a <thead> is in a row of it; htmlparser2 closed the <thead> there.
    expect(rows('<table><thead><td>H</td><td>I</td></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')).toEqual([[1, [['H', 'I'], ['a', 'b']]]])
    // The rows before and after a caption are two row groups: a rowspan of 0 ends with the first.
    expect(rows('<table><tr><td rowspan="0">a</td><td>b</td></tr><caption>cap</caption><tr><td>c</td><td>d</td></tr></table>')).toEqual([[0, [['a', 'b'], ['c', 'd']]]])
    // Text in a column group closes it and comes before the table.
    expect(htmlToMarkdown('<table><colgroup><col>note<col></colgroup><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')).toBe('note\n\n| a | b |\n| --- | --- |\n| c | d |')
  })

  it('edits a table\'s tags only where htmlparser2 and a browser differ: odd end tags, svg and math, implied closes', () => {
    const tail = '<td>b</td></tr><tr><td>c</td><td>d</td></tr></table><p>after</p>'
    // An end tag with space after </ is a comment to a browser.
    expect(htmlToMarkdown(`<table><tr><td>a</ div>b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table><p>after</p>`)).toBe('| ab | c |\n| --- | --- |\n| d | e |\n\nafter')
    // A self-closing or unclosed <svg> in a cell ends with the cell.
    expect(htmlToMarkdown(`<table><tr><td><svg width="0"/>a</td>${tail}`)).toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
    expect(htmlToMarkdown(`<table><tr><td><svg><path d="M0"></td>${tail}`)).toBe('|  | b |\n| --- | --- |\n| c | d |\n\nafter')
    // An svg icon's <title>, MathML's <mi>, an svg's <foreignObject>: their end tags close them, as their content is HTML.
    expect(htmlToMarkdown(`<table><tr><td><svg><title>Icon</title><path d="M0"/></svg> a</td>${tail}`)).toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
    expect(htmlToMarkdown(`<table><tr><td><math><mi>x</mi><mo>+</mo><mn>1</mn></math></td>${tail}`)).toBe('| x+1 | b |\n| --- | --- |\n| c | d |\n\nafter')
    expect(htmlToTables(`<table><tr><td><svg><foreignObject><div>z</div></foreignObject><text>t</text></svg>y</td>${tail}`)[0]!.rows).toEqual([['y', 'b'], ['c', 'd']])
    // An svg in an svg's <foreignObject> closes with its own end tag, not the outer one's.
    expect(htmlToMarkdown(`<table><tr><td><svg><foreignObject><svg><title>t</title><path/></svg><div>in</div></foreignObject><text>q</text></svg>a</td>${tail}`))
      .toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
    // </foreignObject> closes it, and the unclosed svg in it, as a browser looks past that svg.
    expect(htmlToMarkdown(`<table><tr><td><svg><foreignObject><svg><path></foreignObject></svg>a</td>${tail}`)).toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
    // An HTML element such as <div> ends the svg it is written in.
    expect(htmlToTables(`<table><tr><td><svg><rect/><div>x</div></svg>y</td>${tail}`)[0]!.rows).toEqual([['x y', 'b'], ['c', 'd']])
    // A <p> closes the <p> before it in htmlparser2 as in a browser: no </p> is written out for it.
    expect(htmlToMarkdown('<p><span><table><tr><td>a</td><td>b</td></tr><p>N1<p>N2<tr><td>c</td><td>d</td></tr></table></span></p><p>after</p>'))
      .toBe('N1\n\nN2\n\n| a | b |\n| --- | --- |\n| c | d |\n\nafter')
  })

  it('reads a <select> by the standard\'s rules since 2025, as Chromium does: it holds what is written in it', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    // Chromium's trees: a select and its options hold elements, where the old "in select" mode dropped their tags.
    expect(body('<select><div>a</div><option>b</select>')).toBe('<select><div>a</div><option>b</option></select>')
    expect(body('<select><option><div>x</div></option>y')).toBe('<select><option><div>x</div></option>y</select>')
    expect(body('<select><b>a</select>b')).toBe('<select><b>a</b></select><b>b</b>')
    // A <select> bounds every scope, so a <p> or <li> before it is not closed in it, and </select> closes what is open in it.
    expect(body('<p><select><p>x')).toBe('<p><select><p>x</p></select></p>')
    expect(body('<select><div></select>x')).toBe('<select><div></div></select>x')
    // An <input> or a second <select> still ends it; a <textarea> or <keygen> no longer does.
    expect(body('<select><option>a<input>x')).toBe('<select><option>a</option></select><input>x')
    expect(body('<select><textarea>t</textarea>x')).toBe('<select><textarea>t</textarea>x</select>')
    expect(body('<table><select><input type=hidden>x')).toBe('<select><input type="hidden">x</select><table></table>')
    // What follows a closed select reopens its formatting elements, and links and images in options are the page's.
    expect(htmlToMarkdown('<!doctype html><html><body><p>a <select><b>x</select>b</p></body></html>')).toBe('a **b**')
    expect(collectLinks('<!doctype html><html><body><select><option><a href="/x">x</a></option></select></body></html>', 'https://e.test/')).toEqual(['https://e.test/x'])
  })

  it('copies the selected option into a select\'s <selectedcontent>, as Chromium does', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    const shown = '<button><selectedcontent></selectedcontent></button>'
    // The option with the selected attribute (the last one), or else the first that is not disabled; its content replaces what was there.
    expect(body(`<select>${shown}<option>A</option><option selected>B</option></select>`)).toBe(`<select><button><selectedcontent>B</selectedcontent></button><option>A</option><option selected>B</option></select>`)
    expect(body(`<select>${shown}<option disabled>A<option>B</select>`)).toBe(`<select><button><selectedcontent>B</selectedcontent></button><option disabled>A</option><option>B</option></select>`)
    expect(body('<select><button><selectedcontent>old</selectedcontent></button><option><b>x</b> y</option></select>'))
      .toBe('<select><button><selectedcontent><b>x</b> y</selectedcontent></button><option><b>x</b> y</option></select>')
    // A list box selects none by default, a multiple select copies none, and one inside an option or outside any select is left alone.
    expect(body(`<select size=2>${shown}<option>A</select>`)).toBe(`<select size="2">${shown}<option>A</option></select>`)
    expect(body(`<select multiple>${shown}<option selected>A</select>`)).toBe(`<select multiple>${shown}<option selected>A</option></select>`)
    expect(body(`<select><option>A${shown}z</option></select>`)).toBe(`<select><option>A${shown}z</option></select>`)
    // In a page a <selectedcontent> written after the selected option takes it when inserted; in a fragment (a template's content) it does not.
    expect(body('<select><option>A</option><button><selectedcontent>old</selectedcontent></button></select>')).toBe('<select><option>A</option><button><selectedcontent>Aold</selectedcontent></button></select>')
    expect(fragment('<select><option>A</option><button><selectedcontent>old</selectedcontent></button></select>')).toBe('<select><option>A</option><button><selectedcontent>old</selectedcontent></button></select>')
    // Copies count against the parser's budget: an option of 5,000 comments into 1,000 <selectedcontent> is parsed by linkedom, which copies none.
    const copies = parse(`<!doctype html><html><body><select><option>${'<!---->'.repeat(5000)}</option>${'<selectedcontent></selectedcontent>'.repeat(1000)}</select></body></html>`).document
    expect([copies.querySelectorAll('selectedcontent').length, copies.querySelector('selectedcontent')?.childNodes.length]).toEqual([1000, 0])
  })

  it('reads an option written in a <selectedcontent> as Chromium does: its copy takes it out of the select', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    // In a page the option is copied as soon as it is selected, while still empty, which takes it out: the select then has none.
    expect(body('<select><selectedcontent><option>A</option>z</selectedcontent></select>')).toBe('<select><selectedcontent>z</selectedcontent></select>')
    expect(body('<select><selectedcontent></selectedcontent><selectedcontent><option>A</option></selectedcontent></select>')).toBe('<select><selectedcontent></selectedcontent><selectedcontent></selectedcontent></select>')
    // The first enabled option left is selected, without a copy; a <selectedcontent> written later takes it.
    expect(body('<select><option>X</option><selectedcontent><option selected>A</option></selectedcontent><selectedcontent></selectedcontent></select>'))
      .toBe('<select><option>X</option><selectedcontent></selectedcontent><selectedcontent>X</selectedcontent></select>')
    expect(body('<select><selectedcontent>q<option>A</option>r</selectedcontent><option>B</option></select>')).toBe('<select><selectedcontent>B</selectedcontent><option>B</option></select>')
    // In a template's content the option is copied only when it closes, and the next one is then selected.
    expect(fragment('<select><selectedcontent><option>A</option>z</selectedcontent></select>')).toBe('<select><selectedcontent>Az</selectedcontent></select>')
    expect(fragment('<select><selectedcontent><option>A</option><option>B</option></selectedcontent></select>')).toBe('<select><selectedcontent>B</selectedcontent></select>')
    // A select in another select (here through a table) copies nothing; a <selectedcontent> in a <datalist> is still the select's.
    expect(body('<select><table><select><button><selectedcontent>q</selectedcontent></button><option>A</option></select></table></select>'))
      .toBe('<select><select><button><selectedcontent>q</selectedcontent></button><option>A</option></select><table></table></select>')
    expect(body('<select><option selected>A</option><datalist><button><selectedcontent></selectedcontent></button></datalist></select>'))
      .toBe('<select><option selected>A</option><datalist><button><selectedcontent>A</selectedcontent></button></datalist></select>')
  })

  it('copies an option that holds a select or options as Chromium does: the options of the copy are the select\'s', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    const shown = '<button><selectedcontent></selectedcontent></button>'
    // The copy holds all the option holds, a select or a <selectedcontent> with options included.
    expect(body(`<select>${shown}<option>A<table><tr><td><select><option selected>x</select></td></tr></table></option></select>`))
      .toBe(`<select><button><selectedcontent>A<table><tbody><tr><td><select><option selected>x</option></select></td></tr></tbody></table></selectedcontent></button><option>A<table><tbody><tr><td><select><option selected>x</option></select></td></tr></tbody></table></option></select>`)
    expect(body(`<select>${shown}<option>A<selectedcontent><option>B</option></selectedcontent></option></select>`))
      .toBe(`<select><button><selectedcontent>A<selectedcontent><option>B</option></selectedcontent></selectedcontent></button><option>A<selectedcontent><option>B</option></selectedcontent></option></select>`)
    // In the document a copied option with a selected attribute is selected and copied in turn, which takes it out; a list box then selects none.
    const cascade = `<select size=3>${shown}<option selected>A<selectedcontent><option selected></option></selectedcontent></option></select>`
    expect(body(cascade)).toBe(`<select size="3">${shown}<option selected>A<selectedcontent><option selected></option></selectedcontent></option></select>`)
    // Every copied option is read in turn, also one the copy of an earlier one already took out, as Chromium handles each node of an insertion.
    expect(body(`<select size=3>${shown}<option selected>A<span><option selected>B${shown}</option><option selected>Q</option></span></option></select>`))
      .toBe(`<select size="3"><button><selectedcontent>Q</selectedcontent></button><option selected>A<span><option selected>B${shown}</option><option selected>Q</option></span></option></select>`)
    expect(body('<select size=3><selectedcontent></selectedcontent><option selected><span><option selected><selectedcontent></selectedcontent><option selected>'))
      .toBe('<select size="3"><selectedcontent></selectedcontent><option selected><span><option selected><selectedcontent></selectedcontent></option><option selected></option></span></option></select>')
    // But such an option is then not the select's: one without a selected attribute is never selected by default, and a later <selectedcontent> takes none.
    expect(body(`<select>${shown}<option selected disabled>A<span><option selected>B</option><option>Q</option></span></option></select>`))
      .toBe(`<select><button><selectedcontent>B</selectedcontent></button><option selected disabled>A<span><option selected>B</option><option>Q</option></span></option></select>`)
    // While it is copied the select has no selection of its own: an option its copy holds is selected by default if it is the first enabled one left.
    expect(body(`<select>${shown}<option selected disabled>A<span><option selected>R</option><option selected>Q<span><option>R</option></span></option></span></option>${shown}</select>`))
      .toBe(`<select><button><selectedcontent>R</selectedcontent></button><option selected disabled>A<span><option selected>R</option><option selected>Q<span><option>R</option></span></option></span></option>${shown}</select>`)
    expect(body(`<select>${shown}<option>Z</option><option selected>A<span><option selected>B</option><option selected>Q<span><option>R</option></span></option></span></option>${shown}</select>`))
      .toBe(`<select><button><selectedcontent>Q<span><option>R</option></span></selectedcontent></button><option>Z</option><option selected>A<span><option selected>B</option><option selected>Q<span><option>R</option></span></option></span></option><button><selectedcontent>Z</selectedcontent></button></select>`)
    expect(body(`<select size=3>${shown}<option selected>A<span><option selected>B${shown}</option><option selected>Q</option></span></option>${shown}</select>`))
      .toBe(`<select size="3"><button><selectedcontent>Q</selectedcontent></button><option selected>A<span><option selected>B${shown}</option><option selected>Q</option></span></option>${shown}</select>`)
    // In a template's content it is only copied.
    expect(fragment(cascade)).toBe(`<select size="3"><button><selectedcontent>A<selectedcontent><option selected></option></selectedcontent></selectedcontent></button><option selected>A<selectedcontent><option selected></option></selectedcontent></option></select>`)
  })

  it('finds an option\'s select up its ancestors: one fostered out of a table in a <selectedcontent> is the select\'s', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    // Each option is fostered into the <selectedcontent>, even once the copy of the first took the table out, and each copy takes it out again.
    expect(body('<select><selectedcontent>w<table><option><option><option>')).toBe('<select><selectedcontent></selectedcontent></select>')
    expect(fragment('<select><selectedcontent>w<table><option><option><option>')).toBe('<select><selectedcontent></selectedcontent></select>')
    // An option fostered out of a table is the select's too.
    expect(body('<select><button><selectedcontent></selectedcontent></button><div><table><option>A</option></table></div></select>'))
      .toBe('<select><button><selectedcontent>A</selectedcontent></button><div><option>A</option><table></table></div></select>')
  })

  it('writes a table\'s text pending at the end of a template\'s content after the open elements close, as Chromium does', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    const shown = '<button><selectedcontent></selectedcontent></button>'
    // In a template the option the </template> (or the end) closes is copied first, so its copy lacks the fostered text (or the spaces the table holds).
    expect(body(`<template><select>${shown}<option selected>w8<table>w10</template>`))
      .toBe(`<template><select><button><selectedcontent>w8<table></table></selectedcontent></button><option selected>w8w10<table></table></option></select></template>`)
    expect(fragment(`<template><select>${shown}<option selected>w8<table>w10`))
      .toBe(`<template><select><button><selectedcontent>w8<table></table></selectedcontent></button><option selected>w8w10<table></table></option></select></template>`)
    // A token that writes the text without closing the option leaves it in the copy.
    expect(body(`<template><select>${shown}<option selected>w8<table>w10<!--c--></template>`))
      .toBe(`<template><select><button><selectedcontent>w8w10<table><!--c--></table></selectedcontent></button><option selected>w8w10<table><!--c--></table></option></select></template>`)
    expect(fragment(`<template><select>${shown}<option selected>w8<table>   `))
      .toBe(`<template><select><button><selectedcontent>w8<table></table></selectedcontent></button><option selected>w8<table>   </table></option></select></template>`)
    // It is written once no template is left open: an option around the template, at a page's or a fragment's own level, has it.
    expect(fragment(`<select>${shown}<option selected>a<template><table>x`))
      .toBe(`<select><button><selectedcontent>a<template>x<table></table></template></selectedcontent></button><option selected>a<template>x<table></table></template></option></select>`)
    expect(fragment(`<select>${shown}<option selected>a<template><select>${shown}<option selected>b<table>x`))
      .toBe(`<select><button><selectedcontent>a<template><select><button><selectedcontent>b<table></table></selectedcontent></button><option selected>bx<table></table></option></select></template></selectedcontent></button><option selected>a<template><select><button><selectedcontent>b<table></table></selectedcontent></button><option selected>bx<table></table></option></select></template></option></select>`)
    // At a page's or a fragment's own level the copy has it.
    expect(body(`<select>${shown}<option selected>w8<table>w10`))
      .toBe(`<select><button><selectedcontent>w8w10<table></table></selectedcontent></button><option selected>w8w10<table></table></option></select>`)
    expect(fragment(`<select>${shown}<option selected>w8<table>w10`))
      .toBe(`<select><button><selectedcontent>w8w10<table></table></selectedcontent></button><option selected>w8w10<table></table></option></select>`)
    // The text still goes where the table's rules put it, in the template.
    expect(body('<template><div><table>w10')).toBe('<template><div>w10<table></table></div></template>')
  })

  it('matches an end tag in svg or math to an element by its exact name, as Chromium does', () => {
    const page = (body: string) => parse(`<!doctype html><html><body>${body}</body></html>`).document
    // In svg the end tag takes svg's spelling (</foreignObject>, </clipPath>), which no HTML element has, so it closes nothing there.
    expect(page('<div><foreignObject><svg></foreignObject>x</div>').querySelector('svg')?.textContent).toBe('x')
    expect(page('<clippath><svg></clippath>x').querySelector('svg')?.textContent).toBe('x')
    expect(page('<math><clipPath><mi><svg></clippath>x').querySelector('svg')?.textContent).toBe('x')
    // In math it keeps its own spelling, which svg's <foreignObject> does not have.
    expect(page('<svg><foreignObject><math></foreignObject>x').querySelector('math')?.textContent).toBe('x')
    // An svg element of that name still closes.
    const closed = page('<svg><foreignObject></foreignObject>x').querySelector('svg')
    expect([closed?.firstElementChild?.textContent, closed?.lastChild?.textContent]).toEqual(['', 'x'])
    // Chromium shows no text in the svg.
    expect(htmlToMarkdown('<!doctype html><html><body><p>a<lineargradient><svg></lineargradient>b</p><p>c</p></body></html>')).toBe('a\n\nc')
    // After </body> it still returns to the body's rules, so a comment after it stays in the body.
    expect(page('<svg><g></body></foreignObject></g></svg><!--c-->').body.lastChild?.nodeType).toBe(8)
    // An end tag written in HTML inside svg or math closes HTML elements only: an svg <desc> or a math <mi> of its name stays open.
    expect(page('<svg><desc><a>x</desc><span>y').querySelector('a')?.textContent).toBe('xy')
    expect(page('<math><mi><span>x</mi>y').querySelector('span')?.textContent).toBe('xy')
    // So does what decides how the rest is read: an svg <tfoot> is not a row group, so a second <table> still ends the first.
    expect(page('<svg><tfoot><math><foreignobject><table><table>').querySelectorAll('table').length).toBe(2)
  })

  it('reads svg and math as a browser does: their namespaces, their elements\' end tags, and htmlparser2\'s view of a self-closing slash', () => {
    const rows = (html: string) => htmlToTables(html).map((t) => t.rows)
    const tail = '<tr><td>c</td><td>d</td></tr></table><p>after</p>'
    // Chromium's grids. math's <foreignObject> is no integration point: a <tr> in it is math's, and stays out of the table.
    expect(rows(`<table><tr><td>a</td><td>b</td></tr><tr><math><math><foreignObject><tr><div>t <svg/><th>h</th></tr>${tail}`)).toEqual([[['a', 'b'], ['h', ''], ['c', 'd']]])
    // svg's <mi> is no integration point either: a <td> in it is svg's.
    expect(rows(`<table><tr><td>a</td><td>b</td></tr><svg><mi>m<td>x</td></svg>${tail}`)).toEqual([[['a', 'b'], ['c', 'd']]])
    // A <div> ends an svg in a math in a math: all three end tags are written out, not only the outer one's.
    expect(rows(`<table><tr><td>a</td><td>b</td></tr><tbody><math><svg><math></td><div>z</div><tr><td>e</td><td>f</td></tr>${tail}`)).toEqual([[['a', 'b'], ['e', 'f'], ['c', 'd']]])
    // An svg's own <td> does not stand in for the cell: a <td> in the cell's HTML content closes the cell.
    expect(rows(`<table><tr><td>a<svg><td>s<foreignObject><mo>m<td>x</td></tr>${tail}`)).toEqual([[['a', 'x'], ['c', 'd']]])
    // In a cell, </span> does not pass the <div> in it, as a browser's end tag stops at a special element; </div> passes a <p>.
    const cell = (html: string) => htmlToMarkdown(`<table><tr><td>${html}</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`).split('\n')[0]
    expect(cell('<span><div>x</span>y</div>z')).toBe('| xy z | b |')
    expect(cell('<div><p>x</div>y')).toBe('| x y | b |')
    // </noscript>, </iframe> and </select> close theirs: a browser opens nothing in the first two, and </select> has its own rule.
    expect(cell('<noscript><p>Please enable JavaScript</noscript>Total')).toBe('| Total | b |')
    expect(cell('<iframe><p>x</iframe>Total')).toBe('| Total | b |')
    expect(cell('<select name="q"><option value="1"><p>One</select> per unit')).toBe('| per unit | b |')
    // htmlparser2 takes svg's <mi> for an integration point and ignores <rect/>'s slash there: its end tag is written out.
    expect(rows(`<table><tr><td><svg><mi><rect/>q</mi></svg>r</td><td>b</td></tr>${tail}`)).toEqual([[['r', 'b'], ['c', 'd']]])
  })

  it('ignores table tags outside any table in a whole page, as a browser does, and keeps them in a fragment', () => {
    const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`
    // Chromium: the stray row after the table is its text alone.
    expect(htmlToMarkdown(page('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table><tr><td>x</td><td>y</td></tr><p>after</p>')))
      .toBe('| a | b |\n| --- | --- |\n| c | d |\n\nxy\n\nafter')
    expect(htmlToMarkdown(page('<p>a<td>b</td>c</p><caption>cap</caption><thead><th>h</th></thead><p>z</p>'))).toBe('abc\n\ncaph\n\nz')
    // A fragment, such as the main content of a layout table, keeps its rows and cells.
    expect(htmlToMarkdown('<tr><td>x</td><td>y</td></tr><tr><td>z</td><td>w</td></tr>')).toBe('x\n\ny\n\nz\n\nw')
    expect(withoutLayoutMarkers('<tr data-w2l-display="block"><td>a</td><td>b</td></tr>')).toBe('<tr><td>a</td><td>b</td></tr>')
    // A selection of table rows, given as <body>…</body>, keeps its rows and cells.
    const rowsSelection = '<body><tr class="athing"><td data-w2l-display="block">1.</td><td><a href="/s1">Story one</a></td></tr><tr class="athing"><td>2.</td><td><a href="/s2">Story two</a></td></tr></body>'
    expect(htmlToMarkdown(rowsSelection)).toBe('1.\n\n[Story one](/s1)\n\n2.\n\n[Story two](/s2)')
    expect(withoutLayoutMarkers(rowsSelection)).toBe(rowsSelection.replace(' data-w2l-display="block"', ''))
    // A selection given whole keeps its <body>.
    expect(withoutLayoutMarkers('<body class="k"><nav><a href="/a" data-w2l-display="block">Nav</a></nav></body>')).toBe('<body class="k"><nav><a href="/a">Nav</a></nav></body>')
    // A </template> closes the template a table in it left open.
    expect(htmlToMarkdown(page('<template><table><tr><td>x</template><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table><p>after</p>')))
      .toBe('| a | b |\n| --- | --- |\n| c | d |\n\nafter')
  })

  it('keeps a table\'s end tags written in a <template> in the table inside the template, as a browser does', () => {
    const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`
    // Chromium: the template's </table> closes nothing outside it, so its text stays in it and the table stays whole.
    const rows = page('<table><tr><td>a</td><template><td>hidden</td></table>x</template><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')
    expect(htmlToTables(rows).map((t) => t.rows)).toEqual([[['a', 'b'], ['c', 'd']]])
    expect(htmlToMarkdown(rows)).toBe('| a | b |\n| --- | --- |\n| c | d |')
    expect(htmlToMarkdown(page('<table><tr><td><template><td></table>hidden</template>visible</td></tr></table><p>after</p>'))).toBe('visible\n\nafter')
    // A row group end tag in it does not close the group outside it either.
    expect(parse(page('<table><tbody><template><tr></tbody>hidden</template><tr><td>a</td></tr></table>')).document.body.innerHTML)
      .toBe('<table><tbody><template><tr></tr>hidden</template><tr><td>a</td></tr></tbody></table>')
  })

  it('keeps a <form> written in a table in a <template>, as Chromium does', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    // Chromium puts it where it is written and closes it, also when a form is open outside the template; the standard drops it.
    expect(body('<template><table><tr><form id=a><td>y</template>')).toBe('<template><table><tbody><tr><form id="a"></form><td>y</td></tr></tbody></table></template>')
    expect(body('<form id=o><table><template><table><form id=a></template></table></form>'))
      .toBe('<form id="o"><table><template><table><form id="a"></form></table></template></table></form>')
    expect(body('<template><table><colgroup><col>t<form id=a><form id=b></table></template>'))
      .toBe('<template>t<table><colgroup><col></colgroup><form id="a"></form><form id="b"></form></table></template>')
    // It is not the page's form: a form after the template is still read, and outside a template one in a table is dropped while another is open.
    expect(body('<table><template><tr><form id=a></template></table><form id=b>z</form>'))
      .toBe('<table><template><tr><form id="a"></form></tr></template></table><form id="b">z</form>')
    expect(body('<form id=o><table><form id=a></table></form>')).toBe('<form id="o"><table></table></form>')
  })

  it('closes a form in a <template> at its </form> as Chromium does: not past a special element open in it', () => {
    const body = (html: string) => parse(`<!doctype html><html><body>${html}</body></html>`).document.body.innerHTML
    // Chromium reads it as any other end tag; the standard closes the <p>, <div> or <li> first.
    expect(body('<template><form><p></form>x</template>')).toBe('<template><form><p>x</p></form></template>')
    expect(body('<template><form><div></form>x</template>')).toBe('<template><form><div>x</div></form></template>')
    expect(body('<template><form><table><tr><td></form>x</template>')).toBe('<template><form><table><tbody><tr><td>x</td></tr></tbody></table></form></template>')
    expect(body('<template><form><span></form>x</template>')).toBe('<template><form><span></span></form>x</template>')
    expect(body('<template><form><option></form>x</template>')).toBe('<template><form><option></option></form>x</template>')
    // Outside a template it is the standard's: the page's form closes.
    expect(body('<form><p></form>x')).toBe('<form><p></p></form>x')
  })

  it('ends a fragment that starts with a <col> as Chromium does: a table\'s pending text in a template at its end is dropped', () => {
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    // Chromium's template.innerHTML. The text is in a template either way, so no output reads it.
    expect(fragment('<col><template><table>abc')).toBe('<col><template><table></table></template>')
    expect(fragment('<col><template><template><div><table>  ')).toBe('<col><template><template><div><table></table></div></template></template>')
    expect(fragment('<col><template><tfoot>abc')).toBe('<col><template><tfoot></tfoot></template>')
    // The formatting elements it re-opens before the table are still re-opened; all-whitespace text re-opens none.
    expect(fragment('<col><template><table><tr><b><i></tr>abc')).toBe('<col><template><b><i></i></b><b><i></i></b><table><tbody><tr></tr></tbody></table></template>')
    expect(fragment('<col><template><table><tr><b></tr>  ')).toBe('<col><template><b></b><table><tbody><tr></tr></tbody></table></template>')
    // Written before another tag, before the template's end, or without the <col>, it is kept, as the standard keeps it.
    expect(fragment('<col><template><table>abc<b>')).toBe('<col><template>abc<b></b><table></table></template>')
    expect(fragment('<col><template><table>abc</template>')).toBe('<col><template>abc<table></table></template>')
    expect(fragment('<template><table>abc')).toBe('<template>abc<table></table></template>')
    expect(fragment('<col><template>abc')).toBe('<col><template>abc</template>')
  })

  it('reads a <title>, <base> or <noframes> in a template as Chromium does: what follows is read by the body\'s rules', () => {
    const fragment = (html: string) => parse(html, true).document.body.innerHTML
    // Chromium's template.innerHTML: the rows, cells and columns after them are dropped and their text kept.
    expect(fragment('<title>t</title><tr><td>x</td></tr>')).toBe('<title>t</title>x')
    expect(fragment('<base><col>')).toBe('<base>')
    expect(fragment('<noframes></noframes><caption>x')).toBe('<noframes></noframes>x')
    expect(parse('<!doctype html><html><body><template><title>t</title><tr><td>x</template></body></html>').document.body.innerHTML)
      .toBe('<template><title>t</title>x</template>')
    // After a <style>, <script>, <meta> or <link>, as the standard says, and after a row, they stay.
    expect(fragment('<style>x</style><tr><td>y</td></tr>')).toBe('<style>x</style><tr><td>y</td></tr>')
    expect(fragment('<tr><title>t</title><td>x</td></tr>')).toBe('<tr><td>x</td></tr><title>t</title>')
    expect(htmlToMarkdown('<title>Rows</title><tr><td>a</td><td>b</td></tr>')).toBe('ab')
  })

  it('ends a table at a table written where its rows belong, as the browser\'s parser does', () => {
    const r = (t: string) => `<tr><td>${t}</td><td>${t}.</td></tr>`
    // Chromium: the outer table ends there, the inner one follows it, and the rows after it are text.
    const html = `<p>pre</p><table>${r('a')}${r('a2')}<table>${r('n1')}${r('n2')}</table>${r('b')}</table><p>post</p>`
    expect(htmlToTables(html).map((t) => t.rows)).toEqual([[['a', 'a.'], ['a2', 'a2.']], [['n1', 'n1.'], ['n2', 'n2.']]])
    expect(htmlToMarkdown(html)).toBe('pre\n\n| a | a. |\n| --- | --- |\n| a2 | a2. |\n\n| n1 | n1. |\n| --- | --- |\n| n2 | n2. |\n\nbb.\n\npost')
    const row = `<table><tr><th>Name</th><th>Price</th></tr><tr><td>A</td><td>1</td></tr><tr><table>${r('n1')}${r('n2')}</table></tr><tr><td>B</td><td>2</td></tr></table>`
    expect(htmlToTables(row).map((t) => t.rows)).toEqual([[['Name', 'Price'], ['A', '1'], ['', '']], [['n1', 'n1.'], ['n2', 'n2.']]])
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

  it('finds the table of a whole document that has no <html> or <body>', () => {
    const html = '<!doctype html><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>'
    expect(htmlToTables(html).map((table) => table.rows)).toEqual([[['a', 'b'], ['c', 'd']]])
  })
})
