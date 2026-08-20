import { DEFAULT_NETWORK_POLICY, type GroundTruth } from '@w2l/contracts'
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import { ALL_BOILERPLATE, htmlPage, prose } from './chrome.js'

export interface FixtureResponse {
  status?: number
  headers?: Record<string, string>
  body?: string | Buffer
  /** Delay before responding, to exercise deadlines. */
  delayMs?: number
  /** Take over the response entirely (streaming, never-ending bodies). */
  handler?: (req: IncomingMessage, res: ServerResponse) => void
}

export interface Fixture {
  /** Ground truth for this case. `target` is the server-relative path. */
  truth: GroundTruth
  respond: (req: IncomingMessage) => FixtureResponse
}

const B = ALL_BOILERPLATE as readonly string[]

const budget = (maxTokens: number, maxWallMs = 10_000, maxAttempts = 2) => ({
  maxTokens,
  maxWallMs,
  maxAttempts,
})

function html(body: string, extra: Partial<FixtureResponse> = {}): FixtureResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Static extraction
// ---------------------------------------------------------------------------

const ARTICLE_FACT = 'The kiln reached 1240 degrees before the glaze vitrified.'
const ARTICLE_FACT_2 = 'Sediment cores from the estuary date to 1873.'

const staticArticle: Fixture = {
  truth: {
    id: 'static-article',
    target: '/static/article',
    kind: 'fixture',
    category: 'static',
    mustContain: [ARTICLE_FACT, ARTICLE_FACT_2],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 260, max: 900 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Baseline: clean semantic article surrounded by full page chrome.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Kiln temperatures and glaze vitrification',
        bodyHtml: `<article>
<h1>Kiln temperatures and glaze vitrification</h1>
<p>${ARTICLE_FACT}</p>
${prose(6, 11)}
<h2>Estuary sediment</h2>
<p>${ARTICLE_FACT_2}</p>
${prose(5, 23)}
</article>`,
      }),
    ),
}

const CJK_FACT = '窑温达到一千二百四十度后釉面开始玻化。'

const staticCjk: Fixture = {
  truth: {
    id: 'static-cjk',
    target: '/static/cjk',
    kind: 'fixture',
    category: 'static',
    mustContain: [CJK_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 60, max: 400 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Guards the CJK path of the token estimator and of content extraction.',
  },
  respond: () =>
    html(
      htmlPage({
        title: '窑温与釉面玻化',
        bodyHtml: `<article>
<h1>窑温与釉面玻化</h1>
<p>${CJK_FACT}</p>
<p>河口沉积物取样显示，最早的一层可追溯到一八七三年。研究者用罗盘和测温计记录了每一次开窑的读数，并把结果抄录在年鉴里。</p>
<p>后续的实验重复了同样的步骤，温度曲线与第一次记录基本一致，误差不超过十五度。</p>
</article>`,
      }),
    ),
}

const TABLE_FACT = 'Tributary flow peaked at 41 cubic metres per second'

const staticTable: Fixture = {
  truth: {
    id: 'static-table',
    target: '/static/table',
    kind: 'fixture',
    category: 'static',
    mustContain: [TABLE_FACT, 'Meridian', '41'],
    mustNotContain: B,
    expectedTable: {
      columns: 3,
      rows: 4,
      cells: {
        '0,0': 'Station',
        '0,1': 'Flow',
        '0,2': 'Recorded',
        '1,0': 'Meridian',
        '1,1': '41',
        '1,2': '1873-04-02',
        '2,0': 'Quarry',
        '3,0': 'Estuary',
      },
      sameColumn: ['Meridian', 'Quarry', 'Estuary'],
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 60, max: 500 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Table content must survive markdown conversion, not be dropped. ' +
      'expectedTable pins the logical grid: a converter that drops a column, ' +
      'shifts a row, or flattens the table into prose still satisfies mustContain ' +
      'but fails missing_required_content here.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Gauging station readings',
        bodyHtml: `<article>
<h1>Gauging station readings</h1>
<p>${TABLE_FACT} during the spring melt.</p>
<table>
<thead><tr><th>Station</th><th>Flow</th><th>Recorded</th></tr></thead>
<tbody>
<tr><td>Meridian</td><td>41</td><td>1873-04-02</td></tr>
<tr><td>Quarry</td><td>28</td><td>1873-04-03</td></tr>
<tr><td>Estuary</td><td>17</td><td>1873-04-05</td></tr>
</tbody>
</table>
${prose(2, 31)}
</article>`,
      }),
    ),
}

const LONG_FACT_HEAD = 'Chapter one begins at the granite plinth.'
const LONG_FACT_TAIL = 'Chapter twelve closes at the bellows house.'

const staticLong: Fixture = {
  truth: {
    id: 'static-long',
    target: '/static/long',
    kind: 'fixture',
    category: 'long_content',
    mustContain: [LONG_FACT_HEAD, LONG_FACT_TAIL],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 3000, max: 20_000 },
    budget: budget(30_000),
    expectedStatus: 'success',
    notes:
      'Tail fact guards against silent truncation: extractors that cut long pages ' +
      'without setting truncatedAt fail check 5.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'A long survey of the works',
        bodyHtml: `<article>
<h1>A long survey of the works</h1>
<p>${LONG_FACT_HEAD}</p>
${prose(60, 41)}
<p>${LONG_FACT_TAIL}</p>
</article>`,
      }),
    ),
}

const LIST_ITEM = 'Cistern maintenance log 07'

// ---------------------------------------------------------------------------
// Table shapes
// ---------------------------------------------------------------------------
// 16 fixtures probing markdown table conversion. Expected GFM markdown is
// derived from the served HTML by toGfmTable() — the annotation (expectedTable)
// is the single source of truth. Every fixture needs unique cell strings so
// cells/anchors locate unambiguously.
//
// Fixtures whose HTML sits in a <table> parseable by the strict toGfmTable
// subset (thead/tbody rows, td/th col/rowspan, caption, single-line cells)
// use structural assertions. The irregular fixtures (ragged, nested,
// list/code/block-in-cell, pipe-in-cell, empty table) cannot be pinned as
// logical grids and instead anchor requireMarkdown:false + unique cell facts
// via mustContain, plus a soft expectedTable where the geometry is stable.
//
// Conversion rules under test (see research/extraction_precision_deep_research.md §二.7):
//   - header row: thead-first-row semantics; all-<th> vs <th>/<td> mix
//   - colspan/rowspan expansion to logical grid, clamped to real bounds
//   - pipes inside cells escaped
//   - block content joined inside the cell, never breaking the row
//   - empty cells kept as empty cells (geometry preserved)
//   - irregular tables may degrade to sanitized HTML, never to garbage
//   - a 112-byte colspan input must not amplify to tens of MB of output

/** Generate a plain fixture table from a cell grid (all cells <td>). */
function tableHtml(cells: readonly (readonly string[])[], thead = false): string {
  const rowTag = (i: number) => (thead && i === 0 ? 'th' : 'td')
  const rows = cells.map(
    (row, i) => `<tr>${row.map((c) => `<${rowTag(i)}>${c}</${rowTag(i)}>`).join('')}</tr>`,
  )
  return `<table><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`
}

const t_thead: Fixture = {
  truth: {
    id: 'table-thead',
    target: '/table/thead',
    kind: 'fixture',
    category: 'table',
    mustContain: ['North Wall'],
    mustNotContain: B,
    expectedTable: {
      columns: 2,
      rows: 2,
      cells: { '0,0': 'Reading', '0,1': 'Value', '1,0': 'North Wall', '1,1': '3.7' },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Canonical thead header table: header cells must become the header row.',
  },
  respond: () => html(htmlPage({ title: 'Readings', bodyHtml: `<article><h1>Readings</h1>${tableHtml([['Reading', 'Value'], ['North Wall', '3.7']], true)}</article>` })),
}

const t_noThead: Fixture = {
  truth: {
    id: 'table-no-thead',
    target: '/table/no-thead',
    kind: 'fixture',
    category: 'table',
    mustContain: ['South Gate', '2.1'],
    mustNotContain: B,
    expectedTable: {
      columns: 2,
      rows: 2,
      cells: { '0,0': 'Reading', '0,1': 'Value', '1,0': 'South Gate', '1,1': '2.1' },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'No thead element: a converter that requires <thead> must still emit a table (the official turndown-plugin-gfm emits raw HTML here).',
  },
  respond: () => html(htmlPage({ title: 'Readings', bodyHtml: `<article><h1>Readings</h1><table><tr><th>Reading</th><th>Value</th></tr><tr><td>South Gate</td><td>2.1</td></tr></table></article>` })),
}

const t_colspan: Fixture = {
  truth: {
    id: 'table-colspan',
    target: '/table/colspan',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Full span'],
    mustNotContain: B,
    expectedTable: {
      columns: 3,
      rows: 2,
      cells: { '0,0': 'Full span', '1,0': 'A', '1,1': 'B', '1,2': 'C' },
      sameRow: ['A', 'B', 'C'],
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'colspan="3" header: the logical grid is 3 columns; continuation cells are empty spacers. A converter that drops the span shifts every following cell left.',
  },
  respond: () => html(htmlPage({ title: 'Span', bodyHtml: `<article><h1>Span</h1><table><tr><th colspan="3">Full span</th></tr><tr><td>A</td><td>B</td><td>C</td></tr></table></article>` })),
}

const t_rowspan: Fixture = {
  truth: {
    id: 'table-rowspan',
    target: '/table/rowspan',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Tall cell'],
    mustNotContain: B,
    expectedTable: {
      columns: 2,
      rows: 3,
      cells: { '0,0': 'Tall cell', '0,1': 'R1', '1,1': 'R2', '2,1': 'R3' },
      sameColumn: ['R1', 'R2', 'R3'],
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'rowspan="3" first cell: rows 1-2 cell 0 are spacer cells. A converter that repeats the value or drops the geometry fails the grid.',
  },
  respond: () => html(htmlPage({ title: 'Tall', bodyHtml: `<article><h1>Tall</h1><table><tr><th rowspan="3">Tall cell</th><th>R1</th></tr><tr><td>R2</td></tr><tr><td>R3</td></tr></table></article>` })),
}

const t_colRowSpan: Fixture = {
  truth: {
    id: 'table-colrowspan',
    target: '/table/colrowspan',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Origin'],
    mustNotContain: B,
    expectedTable: {
      columns: 3,
      rows: 3,
      cells: {
        '0,0': 'Origin',
        '0,2': 'Mid',
        '1,2': 'Right',
        '2,0': 'Left',
      },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes:
      'Combined rowspan="2" colspan="2" on one cell: exercises span interaction ' +
      'and spacer layout — Mid lands right of the span, Right under Mid, Left ' +
      'in the row below the span.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Combined',
        bodyHtml: `<article><h1>Combined</h1><table><tr><th rowspan="2" colspan="2">Origin</th><th>Mid</th></tr><tr><td>Right</td></tr><tr><td>Left</td><td> </td><td> </td></tr></table></article>`,
      }),
    ),
}

const t_nested: Fixture = {
  truth: {
    id: 'table-nested',
    target: '/table/nested',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Inner fact', 'Outer fact'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 20, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Table inside a cell: a converter must not let the inner table break the outer row.',
  },
  respond: () => html(htmlPage({ title: 'Nested', bodyHtml: `<article><h1>Nested</h1><table><tr><th>Outer fact</th><th>Detail</th></tr><tr><td>Inner fact</td><td><table><tr><th>Sub</th></tr><tr><td>1</td></tr></table></td></tr></table></article>` })),
}

const t_listInCell: Fixture = {
  truth: {
    id: 'table-list-in-cell',
    target: '/table/list-in-cell',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Aardvark', 'Bilberry', 'Cinder'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 20, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'List inside a cell: cell content must survive without emitting raw newlines that destroy the pipe row.',
  },
  respond: () => html(htmlPage({ title: 'List cell', bodyHtml: `<article><h1>List cell</h1><table><tr><th>Group</th><th>Members</th></tr><tr><td>Alpha</td><td><ul><li>Aardvark</li><li>Bilberry</li><li>Cinder</li></ul></td></tr></table></article>` })),
}

const t_pInCell: Fixture = {
  truth: {
    id: 'table-p-in-cell',
    target: '/table/p-in-cell',
    kind: 'fixture',
    category: 'table',
    mustContain: ['First sentence', 'Second sentence'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 20, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Two <p> blocks in one cell: block content must be joined inside the cell (e.g. <br>), not break the row.',
  },
  respond: () => html(htmlPage({ title: 'P cell', bodyHtml: `<article><h1>P cell</h1><table><tr><th>Context</th><th>Note</th></tr><tr><td>Beta</td><td><p>First sentence</p><p>Second sentence</p></td></tr></table></article>` })),
}

const t_codeInCell: Fixture = {
  truth: {
    id: 'table-code-in-cell',
    target: '/table/code-in-cell',
    kind: 'fixture',
    category: 'table',
    mustContain: ['const x', 'Kind'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes:
      'Inline code in a cell: backticks and pipes inside code spans must not be ' +
      'treated as cell delimiters. mustContain anchors the code text and the ' +
      'header label; the exact rendered form is left to the converter.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Code cell',
        bodyHtml: `<article><h1>Code cell</h1><table><tr><th>Kind</th><th>Snippet</th></tr><tr><td>Code</td><td><code>const x = 1 | 2</code></td></tr></table></article>`,
      }),
    ),
}

const t_emptyCell: Fixture = {
  truth: {
    id: 'table-empty-cell',
    target: '/table/empty-cell',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Filled A', 'Filled B'],
    mustNotContain: B,
    expectedTable: {
      columns: 3,
      rows: 2,
      cells: { '0,0': 'A', '0,1': 'B', '0,2': 'C', '1,0': 'Filled A', '1,2': 'Filled B' },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Empty middle cell: must remain an empty cell so Filled B stays in column 3, not shift left.',
  },
  respond: () => html(htmlPage({ title: 'Empty cell', bodyHtml: `<article><h1>Empty cell</h1><table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>Filled A</td><td></td><td>Filled B</td></tr></table></article>` })),
}

const t_pipeInCell: Fixture = {
  truth: {
    id: 'table-pipe-in-cell',
    target: '/table/pipe-in-cell',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Pipe cell'],
    mustNotContain: B,
    expectedTable: {
      columns: 2,
      rows: 2,
      cells: { '0,0': 'Expr', '0,1': 'Result', '1,0': 'left \\| right', '1,1': 'true' },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes:
      'Pipe character inside a cell: must be escaped so a 2-column row does not ' +
      'parse as 3. Scored via exact cell "left \\| right" (the parser resolves ' +
      'escaped pipes), NOT via mustContain — a substring check would reward ' +
      'unescaped output and punish the correct one.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Pipe cell',
        bodyHtml: `<article><h1>Pipe cell</h1><table><tr><th>Expr</th><th>Result</th></tr><tr><td>left | right</td><td>true</td></tr></table></article>`,
      }),
    ),
}

const t_ragged: Fixture = {
  truth: {
    id: 'table-ragged',
    target: '/table/ragged',
    kind: 'fixture',
    category: 'table',
    mustContain: ['C1', 'C3'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 20, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Rows with different cell counts: must not crash and must keep each row intact (may degrade to HTML).',
  },
  respond: () => html(htmlPage({ title: 'Ragged', bodyHtml: `<article><h1>Ragged</h1><table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>C1</td><td>C2</td></tr><tr><td>C3</td><td>C4</td><td>C5</td><td>C6</td></tr></table></article>` })),
}

const t_emptyTable: Fixture = {
  truth: {
    id: 'table-empty-table',
    target: '/table/empty-table',
    kind: 'fixture',
    category: 'table',
    mustContain: [],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 0, max: 60 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Literal <table></table>: must not throw (the official turndown-plugin-gfm throws an uncaught TypeError in isHeadingRow).',
  },
  respond: () => html(htmlPage({ title: 'Empty table', bodyHtml: `<article><h1>Empty table</h1><table></table><p>Text after the table.</p></article>` })),
}

const t_singleCell: Fixture = {
  truth: {
    id: 'table-single-cell',
    target: '/table/single-cell',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Layout content'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 5, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes:
      'Single-cell layout table (CSS layout abuse): a good converter may ' +
      'degrade this to the cell content, but must not produce a broken ' +
      '1-column table row.',
  },
  respond: () => html(htmlPage({ title: 'Layout', bodyHtml: `<article><h1>Layout</h1><table><tr><td>Layout content</td></tr></table></article>` })),
}

const t_caption: Fixture = {
  truth: {
    id: 'table-caption',
    target: '/table/caption',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Table 1: readings'],
    mustNotContain: B,
    expectedTable: {
      columns: 2,
      rows: 2,
      cells: { '0,0': 'Reading', '0,1': 'Value', '1,0': 'East', '1,1': '4.4' },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 120 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: '<caption> must be preserved as text, not dropped.',
  },
  respond: () => html(htmlPage({ title: 'Caption', bodyHtml: `<article><h1>Caption</h1><table><caption>Table 1: readings</caption><tr><th>Reading</th><th>Value</th></tr><tr><td>East</td><td>4.4</td></tr></table></article>` })),
}

const t_large: Fixture = {
  truth: {
    id: 'table-large',
    target: '/table/large',
    kind: 'fixture',
    category: 'table',
    mustContain: ['R0 C0', 'R99 C9'],
    mustNotContain: B,
    expectedTable: {
      columns: 10,
      rows: 101,
      cells: { '0,0': 'H0', '0,9': 'H9', '100,0': 'R99 C0', '100,9': 'R99 C9' },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 1800, max: 8000 },
    budget: budget(20_000, 15_000),
    expectedStatus: 'success',
    notes:
      '100-row x 10-col table (1,010 cells): wall-clock guard for converter ' +
      'complexity. A quadratic converter blows the budget here. Token floor ' +
      'derived from toGfmTable output (~2.3k tokens).',
  },
  respond: () => {
    const header = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9']
    const rows = Array.from({ length: 100 }, (_, i) =>
      Array.from({ length: 10 }, (_, j) => `R${i} C${j}`),
    )
    return html(htmlPage({ title: 'Large table', bodyHtml: `<article><h1>Large table</h1>${tableHtml([header, ...rows], true)}</article>` }))
  },
}

const t_colspanAmp: Fixture = {
  truth: {
    id: 'table-colspan-amplification',
    target: '/table/colspan-amplification',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Amplify me', 'Follower'],
    mustNotContain: B,
    expectedTable: null,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 5, max: 200 },
    budget: budget(1000, 15_000),
    expectedStatus: 'success',
    notes: 'colspan="10000" on one cell: the normalization step must clamp spans to the real column count. Reproduced bug: 112 bytes expanding to 60 MB output.',
  },
  respond: () => html(htmlPage({ title: 'Amplification', bodyHtml: `<article><h1>Amplification</h1><table><tr><td colspan="10000">Amplify me</td><td>Follower</td></tr></table></article>` })),
}

const t_largeColspan: Fixture = {
  truth: {
    id: 'table-large-colspan',
    target: '/table/large-colspan',
    kind: 'fixture',
    category: 'table',
    mustContain: ['Wide header', 'Tail'],
    mustNotContain: B,
    expectedTable: {
      columns: 4,
      rows: 3,
      cells: {
        '0,0': 'Wide header',
        '0,3': 'Tail',
        '1,0': 'B1',
        '1,1': 'B2',
        '2,0': 'C1',
      },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 15, max: 200 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes:
      'colspan="3" with distinct continuation cells: spacer cells must not ' +
      'swallow the Tail cell that follows the span, nor the B2/C1 cells below.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Large colspan',
        bodyHtml: `<article><h1>Large colspan</h1><table><tr><th colspan="3">Wide header</th><th>Tail</th></tr><tr><td>B1</td><td>B2</td><td> </td><td> </td></tr><tr><td>C1</td><td> </td><td> </td><td> </td></tr></table></article>`,
      }),
    ),
}

// ---------------------------------------------------------------------------
// Page-type routing
// ---------------------------------------------------------------------------

const ptListing: Fixture = {
  truth: {
    id: 'pt-listing',
    target: '/pt/listing',
    kind: 'fixture',
    category: 'page_type',
    mustContain: ['Bespoke teapot catalog 04', 'Bespoke teapot catalog 01'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 50, max: 800 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Listing page (link farm + text descriptions). The list strategy must ' +
      'return the list, not prose; the article cascade would drop every link.',
  },
  respond: () => {
    const items = Array.from(
      { length: 10 },
      (_, i) =>
        `<li><a href="/pt/item/${i + 1}">Bespoke teapot catalog ${String(i + 1).padStart(2, '0')}</a> — hand-thrown stoneware, glazed cobalt</li>`,
    ).join('\n')
    return html(
      htmlPage({
        title: 'Bespoke teapot catalog',
        bodyHtml: `<main><h1>Bespoke teapot catalog</h1><ul>${items}</ul></main>`,
      }),
    )
  },
}

const ptProduct: Fixture = {
  truth: {
    id: 'pt-product',
    target: '/pt/product',
    kind: 'fixture',
    category: 'page_type',
    mustContain: [
      'Four-spout infusion teapot',
      'Hand-thrown stoneware with four spouts for even infusion.',
    ],
    mustNotContain: B,
    expectedTable: {
      columns: 3,
      rows: 2,
      cells: {
        '0,0': 'Capacity',
        '0,1': 'Glaze',
        '0,2': 'Firing',
        '1,0': '600ml',
        '1,1': 'Cobalt ash',
        '1,2': '1260C',
      },
    },
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 40, max: 900 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Product page (spec table + description paragraphs). The table ' +
      'strategy must return the spec table without losing the description, ' +
      'and the router must see the JSON-LD Product type (title, description ' +
      'and spec cells all asserted). Floor 40 = measured extract-tf 50 / golden 43.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Four-spout infusion teapot',
        headExtra: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Four-spout infusion teapot","description":"Hand-thrown stoneware with four spouts for even infusion.","brand":{"@type":"Brand","name":"Fixture Kiln"},"offers":{"@type":"Offer","price":"84.00","priceCurrency":"USD"}}</script>',
        bodyHtml: `<main>
<h1>Four-spout infusion teapot</h1>
<table><tr><th>Capacity</th><th>Glaze</th><th>Firing</th></tr><tr><td>600ml</td><td>Cobalt ash</td><td>1260C</td></tr></table>
<p>Hand-thrown stoneware with four spouts for even infusion.</p>
</main>`,
      }),
    ),
}

const ptCollection: Fixture = {
  truth: {
    id: 'pt-collection',
    target: '/pt/collection',
    kind: 'fixture',
    category: 'page_type',
    // One item from each section, so a strategy that stops at the first
    // section cannot pass.
    mustContain: ['Seasonal collection 2026', 'Cobalt teapot', 'Grey saucer'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 35, max: 900 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Collection page (multiple sections with links). The collection ' +
      'strategy uses the article cascade on a page the router classifies as ' +
      'a collection. Floor 35 = measured extract-tf 79 / golden 37.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Seasonal collection 2026',
        bodyHtml: `<main>
<h1>Seasonal collection 2026</h1>
<h2>Stoneware</h2>
<ul><li><a href="/pt/c/1">Cobalt teapot</a></li><li><a href="/pt/c/2">Ash jug</a></li></ul>
<h2>Porcelain</h2>
<ul><li><a href="/pt/c/3">Ivory cup</a></li><li><a href="/pt/c/4">Grey saucer</a></li></ul>
<p>Curated from the winter kiln batch.</p>
</main>`,
      }),
    ),
}

const ptForum: Fixture = {
  truth: {
    id: 'pt-forum',
    target: '/pt/forum',
    kind: 'fixture',
    category: 'page_type',
    // Both post bodies must survive the article cascade, not just the thread title.
    mustContain: [
      'Thread: best kiln temperature',
      'glaze never crazes over the long winter months',
      'harbour air keeps the clay from drying too fast',
    ],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 35, max: 900 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Forum thread page (posts). The router must see the two ' +
      'article.post containers and route to the forum type while the ' +
      'article cascade extracts them. Floor 35 = measured golden 37.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Thread: best kiln temperature',
        bodyHtml: `<main>
<h1>Thread: best kiln temperature</h1>
<article class="post" data-post-id="1"><h2>Re: best kiln temperature</h2><p>We fire stoneware at 1260C and the glaze never crazes over the long winter months.</p></article>
<article class="post" data-post-id="2"><h2>Re: best kiln temperature</h2><p>Our kiln holds 1240C steady, and the harbour air keeps the clay from drying too fast between firings.</p></article>
</main>`,
      }),
    ),
}

const staticList: Fixture = {
  truth: {
    id: 'static-list',
    target: '/static/list',
    kind: 'fixture',
    category: 'listing',
    mustContain: [LIST_ITEM, 'Cistern maintenance log 01'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 40, max: 600 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Index pages have little prose; readability-style extractors often drop them. ' +
      'The h1 exists so the list strategy has a container.',
  },
  respond: () => {
    const items = Array.from(
      { length: 12 },
      (_, i) =>
        `<li><a href="/static/log/${i + 1}">Cistern maintenance log ${String(i + 1).padStart(2, '0')}</a> — inspected</li>`,
    ).join('\n')
    return html(
      htmlPage({
        title: 'Maintenance logs',
        bodyHtml: `<main><h1>Maintenance logs</h1><ul>${items}</ul></main>`,
      }),
    )
  },
}

const malformed: Fixture = {
  truth: {
    id: 'static-malformed',
    target: '/static/malformed',
    kind: 'fixture',
    category: 'static',
    mustContain: ['The valve seized in the second winter.'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 20, max: 400 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes:
      'Unclosed tags, stray markup, and an unquoted attribute must not crash the parser. ' +
      'Deliberately realistic: the <title> IS closed (an unclosed title is RCDATA and ' +
      'would swallow the whole document per spec).',
  },
  respond: () =>
    html(`<!doctype html><html><head><title>Broken markup</title></head><body>
<div class=unquoted><p>The valve seized in the second winter.
<p>Another paragraph with <b>unclosed bold
<ul><li>one<li>two
<p>Trailing text after a stray </div></span>
</body></html>
`),
}

// ---------------------------------------------------------------------------
// Client-side rendering
// ---------------------------------------------------------------------------

const SPA_FACT = 'Rendered client-side: the almanac lists nine tributaries.'

const spaShell: Fixture = {
  truth: {
    id: 'spa-shell',
    target: '/spa/shell',
    kind: 'fixture',
    category: 'spa',
    mustContain: [SPA_FACT],
    mustNotContain: B,
    expectedLane: 'browser_local',
    emptyIsLegit: false,
    expectedMainTokens: { min: 10, max: 300 },
    budget: budget(2000, 20_000),
    expectedStatus: 'success',
    notes:
      'HTTP lane yields an empty shell; correct behaviour is to escalate to the ' +
      'browser lane. An HTTP-only subject should register failed/empty here, not success.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Almanac viewer',
        bodyHtml: `<div id="root"></div>
<noscript>This application requires JavaScript.</noscript>
<script>
  document.getElementById('root').innerHTML =
    '<article><h1>Almanac viewer</h1><p>${SPA_FACT}</p><p>Nine tributaries feed the estuary basin.</p></article>'
</script>`,
      }),
    ),
}

const SPA_DELAYED_FACT = 'Loaded after a deliberate delay: the ravine gauge reads 12.'

const spaDelayed: Fixture = {
  truth: {
    id: 'spa-delayed',
    target: '/spa/delayed',
    kind: 'fixture',
    category: 'spa',
    mustContain: [SPA_DELAYED_FACT],
    mustNotContain: B,
    expectedLane: 'browser_local',
    emptyIsLegit: false,
    expectedMainTokens: { min: 10, max: 300 },
    budget: budget(2000, 20_000),
    expectedStatus: 'success',
    notes: 'Content appears ~600ms after load; guards premature snapshotting.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Ravine gauge',
        bodyHtml: `<div id="root">Loading…</div>
<script>
  setTimeout(function () {
    document.getElementById('root').innerHTML =
      '<article><h1>Ravine gauge</h1><p>${SPA_DELAYED_FACT}</p></article>'
  }, 600)
</script>`,
      }),
    ),
}

// ---------------------------------------------------------------------------
// Emptiness
// ---------------------------------------------------------------------------

const emptyLegit: Fixture = {
  truth: {
    id: 'empty-legit',
    target: '/empty/legit',
    kind: 'fixture',
    category: 'empty',
    mustContain: [],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: true,
    expectedMainTokens: { min: 0, max: 25 },
    budget: budget(500),
    expectedStatus: 'empty_verified',
    notes:
      'A page that genuinely has no article body. Correct answer is empty_verified, ' +
      'NOT failed — this is the case that separates proven emptiness from suspected.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Section index',
        bodyHtml: `<main><h1>Section index</h1></main>`,
      }),
    ),
}

const emptyBody: Fixture = {
  truth: {
    id: 'empty-body',
    target: '/empty/body',
    kind: 'fixture',
    category: 'empty',
    mustContain: [],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: true,
    expectedMainTokens: { min: 0, max: 5 },
    budget: budget(500),
    expectedStatus: 'empty_verified',
    notes: 'Zero-byte 200 response. Must not be reported as success with empty markdown.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '',
  }),
}

// ---------------------------------------------------------------------------
// Blocking and challenges
// ---------------------------------------------------------------------------

const CHALLENGE_TEXT = 'Just a moment...'

const blockChallenge: Fixture = {
  truth: {
    id: 'block-challenge',
    target: '/block/challenge',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: [CHALLENGE_TEXT, 'Enable JavaScript and cookies to continue'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'blocked',
    notes:
      'The canonical false-success trap: HTTP 403 carrying an interstitial. Returning ' +
      'this text as article content trips check 2 (challenge_text_returned).',
  },
  respond: () => ({
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cf-mitigated': 'challenge' },
    body: `<!doctype html><html><head><title>${CHALLENGE_TEXT}</title></head><body>
<div class="cf-wrapper"><h1>${CHALLENGE_TEXT}</h1>
<p>Enable JavaScript and cookies to continue.</p>
<p>Verifying you are human. This may take a few seconds.</p></div></body></html>`,
  }),
}

const blockChallenge200: Fixture = {
  truth: {
    id: 'block-challenge-200',
    target: '/block/challenge-200',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: [CHALLENGE_TEXT],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'blocked',
    notes:
      'Same interstitial served with HTTP 200 — status-code-only detection fails here. ' +
      'This is where most crawlers report a confident false success.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><title>${CHALLENGE_TEXT}</title></head><body>
<h1>${CHALLENGE_TEXT}</h1><p>Checking your browser before accessing the site.</p>
<p>Enable JavaScript and cookies to continue.</p></body></html>`,
  }),
}

const blockRateLimit: Fixture = {
  truth: {
    id: 'block-rate-limit',
    target: '/block/rate-limit',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: ['Too Many Requests'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 2),
    expectedStatus: 'blocked',
    notes: 'Retry-After must be honoured rather than hammered.',
  },
  respond: () => ({
    status: 429,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '2' },
    body: '<!doctype html><html><body><h1>Too Many Requests</h1></body></html>',
  }),
}

const blockLoginWall: Fixture = {
  truth: {
    id: 'block-login-wall',
    target: '/block/login-wall',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: ['Sign in to continue reading'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'blocked',
    notes:
      'Tier 1b (user-supplied session) is the correct escalation target; the public ' +
      'canary suite never exercises it.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><title>Sign in</title></head><body>
<h1>Sign in to continue reading</h1>
<form method="post" action="/login"><input name="email"><input name="password" type="password"><button>Sign in</button></form>
</body></html>`,
  }),
}

// ---------------------------------------------------------------------------
// Wrong-page content
// ---------------------------------------------------------------------------

const SOFT404_TEXT = 'We could not find that page'

const soft404: Fixture = {
  truth: {
    id: 'soft-404',
    target: '/wrong/soft-404',
    kind: 'fixture',
    category: 'wrong_page',
    mustContain: [],
    mustNotContain: [SOFT404_TEXT],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'failed',
    notes:
      'HTTP 200 error page. Trips check 4 (wrong_page_content) if returned as success. ' +
      'The random-path probe detects this without annotation.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Not found',
        bodyHtml: `<main><h1>${SOFT404_TEXT}</h1><p>Try searching instead.</p></main>`,
      }),
    ),
}

/** Serves the soft-404 body for any unrouted path, so the probe has something to compare. */
export const SOFT_404_BODY = htmlPage({
  title: 'Not found',
  bodyHtml: `<main><h1>${SOFT404_TEXT}</h1><p>Try searching instead.</p></main>`,
})

const redirectToHome: Fixture = {
  truth: {
    id: 'redirect-to-home',
    target: '/wrong/redirect-home',
    kind: 'fixture',
    category: 'wrong_page',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'failed',
    notes:
      'Requested article silently redirects to the homepage. Content is real but belongs ' +
      'to another URL — check 4 must catch it via the redirect chain.',
  },
  respond: () => ({
    status: 302,
    headers: { location: '/home' },
    body: '',
  }),
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

const REDIRECT_FACT = 'Arrived after three hops.'

const redirectChain: Fixture = {
  truth: {
    id: 'redirect-chain',
    target: '/redirect/chain/3',
    kind: 'fixture',
    category: 'redirect',
    mustContain: [REDIRECT_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 5, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Three hops is within the default limit of five.',
  },
  respond: (req) => {
    const n = Number(new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() ?? '0')
    if (n > 0) return { status: 302, headers: { location: `/redirect/chain/${n - 1}` }, body: '' }
    return html(
      htmlPage({
        title: 'Destination',
        bodyHtml: `<article><h1>Destination</h1><p>${REDIRECT_FACT}</p></article>`,
      }),
    )
  },
}

const redirectLoop: Fixture = {
  truth: {
    id: 'redirect-loop',
    target: '/redirect/loop/a',
    kind: 'fixture',
    category: 'redirect',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 1),
    expectedStatus: 'failed',
    notes: 'Must terminate with redirect_loop/redirect_limit, never spin.',
  },
  respond: (req) => {
    const last = (req.url ?? '').endsWith('/a') ? 'b' : 'a'
    return { status: 302, headers: { location: `/redirect/loop/${last}` }, body: '' }
  },
}

// ---------------------------------------------------------------------------
// Timeouts and cancellation
// ---------------------------------------------------------------------------

const slowHeaders: Fixture = {
  truth: {
    id: 'timeout-headers',
    target: '/timeout/headers',
    kind: 'fixture',
    category: 'timeout',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 2000, 1),
    expectedStatus: 'failed',
    notes: 'Never sends headers. Verifies the deadline actually cancels the socket.',
  },
  respond: () => ({
    handler: () => {
      // Deliberately never respond; the client deadline must fire.
    },
  }),
}

const slowBody: Fixture = {
  truth: {
    id: 'timeout-body',
    target: '/timeout/body',
    kind: 'fixture',
    category: 'timeout',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 2000, 1),
    expectedStatus: 'failed',
    notes:
      'Headers arrive immediately, body dribbles forever. Header-only timeouts miss this.',
  },
  respond: () => ({
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.write('<!doctype html><html><body><article><p>start')
      const timer = setInterval(() => res.write('.'), 300)
      res.on('close', () => clearInterval(timer))
    },
  }),
}

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

/**
 * Uncompressed size of the zip-bomb payload — 1 MB above
 * DEFAULT_NETWORK_POLICY.maxDecompressedBytes (50 MB), so a runner that enforces
 * the decompressed cap must abort on this fixture.
 *
 * Note this is the *decompressed* cap, not maxBodyBytes (10 MB): the wire body
 * here is only ~50 KB, so a wire-size check alone would let it through.
 */
export const ZIP_BOMB_UNCOMPRESSED_BYTES =
  DEFAULT_NETWORK_POLICY.maxDecompressedBytes + 1024 * 1024 // 51 MB

// Built on first request rather than at module load: a 51 MB Buffer.alloc during
// module evaluation aborts vitest's fork workers on macOS (ECANCELED while the
// loader is reading the module). gzipSync on uniform bytes is fast and the input
// Buffer becomes GC-eligible immediately, so only the ~50 KB result stays resident.
let _zipBombPayload: Buffer | null = null
function getZipBombPayload(): Buffer {
  if (!_zipBombPayload) {
    _zipBombPayload = gzipSync(Buffer.alloc(ZIP_BOMB_UNCOMPRESSED_BYTES, 0x41))
  }
  return _zipBombPayload
}

/**
 * Declared byte count for the huge-body fixture — 1 MB above
 * DEFAULT_NETWORK_POLICY.maxBodyBytes (10 MB), the *wire* cap.
 *
 * No module-level Buffer is allocated: HEAD answers from the header alone and GET
 * streams fill bytes on demand, so the 11 MB never exists as one resident buffer.
 */
const HUGE_BODY_DECLARED_BYTES = DEFAULT_NETWORK_POLICY.maxBodyBytes + 1024 * 1024 // 11 MB

const zipBomb: Fixture = {
  truth: {
    id: 'limit-zip-bomb',
    target: '/limit/zip-bomb',
    kind: 'fixture',
    category: 'resource_limit',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 15_000, 1),
    expectedStatus: 'failed',
    notes:
      'Gzip payload expanding to ZIP_BOMB_UNCOMPRESSED_BYTES — above ' +
      'DEFAULT_NETWORK_POLICY.maxDecompressedBytes (50 MB). ' +
      'Runner must abort with decompressed_too_large rather than buffering it.',
  },
  respond: () => ({
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
    },
    body: getZipBombPayload(),
  }),
}

const hugeBody: Fixture = {
  truth: {
    id: 'limit-huge-body',
    target: '/limit/huge-body',
    kind: 'fixture',
    category: 'resource_limit',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 15_000, 1),
    expectedStatus: 'failed',
    notes:
      'Uncompressed body declared at HUGE_BODY_DECLARED_BYTES — above ' +
      'DEFAULT_NETWORK_POLICY.maxBodyBytes (10 MB). HEAD returns Content-Length ' +
      'only; GET streams the body in 64 KB chunks with backpressure.',
  },
  respond: () => ({
    handler: (req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': HUGE_BODY_DECLARED_BYTES,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const prefix = Buffer.from('<!doctype html><html><body><p>', 'utf8')
      const suffix = Buffer.from('</p></body></html>', 'utf8')
      const CHUNK = 64 * 1024
      const fillChunk = Buffer.alloc(CHUNK, 0x78) // reused across iterations
      const fillTotal = HUGE_BODY_DECLARED_BYTES - prefix.length - suffix.length
      let filled = 0
      const writeFill = (): void => {
        while (filled < fillTotal) {
          if (res.destroyed) return
          const remaining = fillTotal - filled
          const chunk = remaining >= CHUNK ? fillChunk : Buffer.alloc(remaining, 0x78)
          const ok = res.write(chunk)
          filled += chunk.length
          if (!ok) {
            res.once('drain', writeFill)
            return
          }
        }
        if (!res.destroyed) res.end(suffix)
      }
      if (res.write(prefix)) writeFill()
      else res.once('drain', writeFill)
    },
  }),
}

const nonHtml: Fixture = {
  truth: {
    id: 'limit-non-html',
    target: '/limit/binary',
    kind: 'fixture',
    category: 'resource_limit',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'failed',
    notes: 'A PNG served where HTML was expected must be rejected, not parsed as text.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  }),
}

// ---------------------------------------------------------------------------
// Duplicate content (crawl-level dedupe)
// ---------------------------------------------------------------------------

const DUP_FACT = 'This body is served at three distinct URLs.'
const dupBody = htmlPage({
  title: 'Duplicated page',
  bodyHtml: `<article><h1>Duplicated page</h1><p>${DUP_FACT}</p>${prose(3, 71)}</article>`,
})

const duplicateA: Fixture = {
  truth: {
    id: 'duplicate-a',
    target: '/duplicate/a',
    kind: 'fixture',
    category: 'duplicate',
    mustContain: [DUP_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 100, max: 600 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Identical body to duplicate-b and duplicate-c; content hash must match.',
  },
  respond: () => html(dupBody),
}

const duplicateB: Fixture = {
  ...duplicateA,
  truth: { ...duplicateA.truth, id: 'duplicate-b', target: '/duplicate/b' },
}

const duplicateC: Fixture = {
  ...duplicateA,
  truth: { ...duplicateA.truth, id: 'duplicate-c', target: '/duplicate/c?utm_source=x' },
}

// ---------------------------------------------------------------------------
// HTTP errors
// ---------------------------------------------------------------------------

const http500: Fixture = {
  truth: {
    id: 'error-500',
    target: '/error/500',
    kind: 'fixture',
    category: 'http_error',
    mustContain: [],
    mustNotContain: ['Internal Server Error'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 2),
    expectedStatus: 'failed',
    notes: 'Retryable server error; body must not be returned as content.',
  },
  respond: () => ({
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><body><h1>Internal Server Error</h1></body></html>',
  }),
}

const http404: Fixture = {
  truth: {
    id: 'error-404',
    target: '/error/404',
    kind: 'fixture',
    category: 'http_error',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 1),
    expectedStatus: 'failed',
    notes: 'Honest 404 must not be retried.',
  },
  respond: () => ({
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><body><h1>Not Found</h1></body></html>',
  }),
}

// ---------------------------------------------------------------------------
// Flaky (retry behaviour)
// ---------------------------------------------------------------------------

const FLAKY_FACT = 'Succeeded on the second attempt.'

/**
 * Attempt counter for the flaky fixture. It is global mutable state by necessity —
 * the case exists to test retry behaviour — so anything that fetches it must call
 * `resetFixtureState()` first, or it will observe another caller's attempt number.
 */
let flakyHits = 0

const flaky: Fixture = {
  truth: {
    id: 'flaky-once',
    target: '/flaky/once',
    kind: 'fixture',
    category: 'retry',
    mustContain: [FLAKY_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 5, max: 200 },
    budget: budget(1000, 10_000, 2),
    expectedStatus: 'success',
    notes:
      'Fails once with 503 then succeeds. Subjects without retry will record failed. ' +
      'Stateful: reset the server between subjects so each starts on attempt 1.',
  },
  respond: () => {
    flakyHits++
    if (flakyHits === 1) {
      return {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!doctype html><html><body><h1>Service Unavailable</h1></body></html>',
      }
    }
    return html(
      htmlPage({
        title: 'Recovered',
        bodyHtml: `<article><h1>Recovered</h1><p>${FLAKY_FACT}</p></article>`,
      }),
    )
  },
}

/** Fixture ids whose response depends on how many times they have already been fetched. */
export const STATEFUL_FIXTURE_IDS: readonly string[] = ['flaky-once']

export function resetFixtureState(): void {
  flakyHits = 0
}

// ---------------------------------------------------------------------------
// Supporting page (redirect target)
// ---------------------------------------------------------------------------

const homePage: Fixture = {
  truth: {
    id: 'home',
    target: '/home',
    kind: 'fixture',
    category: 'support',
    mustContain: ['Welcome to the fixture site'],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 10, max: 300 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Redirect target for redirect-to-home. Its own annotation lets check 4 compare.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Fixture site',
        bodyHtml: `<main><h1>Welcome to the fixture site</h1><p>Browse the sections to begin.</p></main>`,
      }),
    ),
}

export const FIXTURES: readonly Fixture[] = [
  staticArticle,
  staticCjk,
  staticTable,
  t_thead,
  t_noThead,
  t_colspan,
  t_rowspan,
  t_colRowSpan,
  t_nested,
  t_listInCell,
  t_pInCell,
  t_codeInCell,
  t_emptyCell,
  t_pipeInCell,
  t_ragged,
  t_emptyTable,
  t_singleCell,
  t_caption,
  t_large,
  t_colspanAmp,
  t_largeColspan,
  ptListing,
  ptProduct,
  ptCollection,
  ptForum,
  staticLong,
  staticList,
  malformed,
  spaShell,
  spaDelayed,
  emptyLegit,
  emptyBody,
  blockChallenge,
  blockChallenge200,
  blockRateLimit,
  blockLoginWall,
  soft404,
  redirectToHome,
  redirectChain,
  redirectLoop,
  slowHeaders,
  slowBody,
  zipBomb,
  hugeBody,
  nonHtml,
  duplicateA,
  duplicateB,
  duplicateC,
  http500,
  http404,
  flaky,
  homePage,
]

export const SUITE_META = {
  name: 'fixtures',
  version: '0.1.0',
  curatedAt: '2026-08-17',
} as const
