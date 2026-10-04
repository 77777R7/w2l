/**
 * HTML → Markdown after main-content extraction.
 *
 * ExtractorOutput.mainHtml stays HTML (the extractor's job is the region).
 * This is pipeline step 7: turn that region into LLM-ready Markdown
 * (CommonMark, with GFM tables).
 *
 * The walk follows the browser's default layout without CSS: block elements
 * start new Markdown blocks, the inline content between them forms one
 * paragraph, and whitespace collapses the way a browser collapses it.
 * Tables keep the GFM grid rules the fixture suite already scores.
 *
 * Where a browser capture saw the page's CSS lay an element out differently,
 * its copy of the page carries LAYOUT_MARKERS, and the walk follows them: a
 * marked inline element is a block, a marked hidden one is skipped with all
 * it contains. HTML without markers converts by its tags alone.
 */

import { detachAll, isLayoutTable, parse } from './dom.js'
import { namedBy } from './selectors.js'
import { documentBaseUrl } from './links.js'

export interface MarkdownOptions {
  /**
   * Base for relative link and image targets: the document base URL
   * (ExtractorOutput.baseUrl). A whole document's own `<base href>` is
   * resolved against it. Without a base, targets stay as written.
   */
  baseUrl?: string | null
  /**
   * CSS selectors whose elements are left out with all they contain: the
   * caller's exclusions on a whole page, which no extraction pruned.
   */
  exclude?: readonly string[]
  /**
   * What becomes of an image whose `src` is a `data:` URI. `drop` (the
   * default, Firecrawl's `removeBase64Images`): the image is left out and
   * its alt text kept. `keep`: it is written as `![alt](data:…)`, and the
   * token count then counts it. A `data:` link target is always dropped.
   */
  dataUriImages?: 'drop' | 'keep'
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/** Never content: skipped together with everything inside. */
const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'base',
  'button', 'input', 'select', 'option', 'optgroup', 'datalist', 'textarea',
  'svg', 'canvas', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'track', 'map', 'area',
  // An inline XBRL filing's hidden facts and contexts.
  'ix:header',
])

/** Elements a browser lays out as blocks by default. Everything else is inline. */
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details', 'dialog',
  'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol',
  'p', 'pre', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

const LIST = new Set(['ul', 'ol', 'menu', 'dir'])

/**
 * The layout markers a browser capture sets on its own copy of the rendered
 * page, never on the page it keeps as evidence. They go on elements the walk
 * would lay out inline: the tags it lays out as blocks keep that layout, and
 * the tags it skips need none.
 */
export const LAYOUT_MARKERS = {
  /** Set to "block" where the page's CSS lays out an element as a block. */
  display: 'data-w2l-display',
  /** Set where the page's CSS hides an element (display: none). */
  hidden: 'data-w2l-hidden',
  /** Tags the walk lays out as blocks. */
  blockTags: [...BLOCK] as readonly string[],
  /** Tags the walk skips with all they contain. */
  skipTags: [...SKIP] as readonly string[],
} as const

/** HTML's collapsible whitespace, plus the no-break space, which becomes a plain space. */
const WHITESPACE = /[\t\n\f\r \u00a0]+/g

/** Script forms for `<sup>` and `<sub>`: digits, signs and the few letters Unicode has. */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}
const SUBSCRIPT: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
}

/**
 * The script form of a superscript or subscript when every character has
 * one (`m<sup>2</sup>` is m², `H<sub>2</sub>O` is H₂O), else null. Without
 * it a unit's exponent joins the number the page writes next to it: a data
 * centre's `12,000 ft<sup>2</sup> 1,100 m<sup>2</sup>` read "12,000 ft 21,100
 * m 2", and the square-metre figure could not be found in the text.
 */
function scriptText(text: string, tag: string): string | null {
  const map = tag === 'sup' ? SUPERSCRIPT : SUBSCRIPT
  const mapped = Array.from(text).map((c) => map[c])
  return text.length > 0 && mapped.every((c) => c !== undefined) ? mapped.join('') : null
}

interface Context {
  base: URL | null
  /** containsBlock results, so the walk stays linear in the size of the tree. */
  blockMemo: Map<Element, boolean>
  /** The HTML carries layout markers. */
  layout: boolean
  /** `data:` image URIs are written as targets instead of being dropped (MarkdownOptions.dataUriImages 'keep'). */
  keepDataUriImages: boolean
  /** When set, every data table the walk writes as a GFM table is also collected here, in document order (htmlToTables). */
  tables?: ExtractedTable[]
  /** What the collected tables of this page may still hold, in MAX_PAGE_TABLE_CHARS units; shared by every table of one walk. */
  tableBudget?: { left: number }
  /** What the GFM grids of this page's tables may still add as empty cells (MAX_PAGE_TABLE_PADDING). */
  tablePadding: { left: number }
}

/** Never content, or hidden by the page's CSS: skipped together with everything inside. */
function skipped(el: Element, ctx: Context): boolean {
  return SKIP.has(el.localName) || (ctx.layout && el.hasAttribute(LAYOUT_MARKERS.hidden))
}

/** Laid out as a block by the page's CSS, whatever its tag. */
function cssBlock(el: Element, ctx: Context): boolean {
  return ctx.layout && el.getAttribute(LAYOUT_MARKERS.display) === 'block'
}

/** An element's text without the parts the page's CSS hides. */
function shownText(el: Element, ctx: Context): string {
  if (!ctx.layout) return el.textContent ?? ''
  let text = ''
  for (let node = el.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType === TEXT_NODE) text += (node as Text).data
    else if (node.nodeType === ELEMENT_NODE && !(node as Element).hasAttribute(LAYOUT_MARKERS.hidden)) text += shownText(node as Element, ctx)
  }
  return text
}

/** One rendered Markdown block, without surrounding blank lines. */
interface Block {
  text: string
  /** A list that may follow a paragraph without a blank line (bullets, or numbers from 1). */
  interrupts?: boolean
}

// ---------------------------------------------------------------- tables

function normalizeCell(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}

/**
 * A cell's inline content on one line: links and images keep their targets,
 * as in a paragraph; emphasis and code are plain text; <br> and block
 * boundaries are spaces, so separate lines stay separate words.
 */
function cellText(cell: Element, ctx: Context): string {
  const inline = new Inline()
  inlineChildren(cell, inline, ctx, CELL_MARKS)
  return inline.finish().text.replace(/\n/g, ' ')
}

/** The span limits browsers apply (HTML: colspan at most 1000, rowspan at most 65534). */
const MAX_COLSPAN = 1000
const MAX_ROWSPAN = 65534
/**
 * The most empty cells the GFM grid of one table, and of all a page's
 * tables together, may add for spans and short rows (each is written as
 * ` | `). Padding is what lets a small page make a huge one: one wide row
 * over many one-cell rows pads every row to its width. A table past either
 * is written as its rows of cells, unpadded.
 */
export const MAX_TABLE_PADDING = 500_000
export const MAX_PAGE_TABLE_PADDING = 2_000_000

type GridCell = { value: string; colspan: number; rowspan: number }

/**
 * The cells of a table, one grid row per HTML row, a spanned cell's value
 * in every slot it covers (`fill: 'repeat'`) or in its first slot with the
 * others empty (`fill: 'empty'`, the GFM table), every row padded to the
 * widest; null once the grid would hold more than `maxPadding` slots that
 * are not a cell's first.
 */
function expandGrid(rows: GridCell[][], maxPadding: number, fill: 'empty' | 'repeat' = 'empty'): string[][] | null {
  const out: string[][] = []
  // Column → the rowspans started over it, newest last, each covering the rows before its `end`.
  const vertical = new Map<number, { end: number; value: string }[]>()
  let slots = 0
  let cells = 0
  for (let y = 0; y < rows.length; y++) {
    const row: string[] = []
    let cursor = 0
    // The rowspans still covering `col` in this row, newest last. Ended spans
    // are popped from the top as they are met, so a row's work is one look per
    // column it covers plus the spans it pops, never every span still pending.
    const live = (col: number) => {
      const spans = vertical.get(col)
      if (spans === undefined) return undefined
      while (spans.length > 0 && spans[spans.length - 1]!.end <= y) spans.pop()
      if (spans.length > 0) return spans
      vertical.delete(col)
      return undefined
    }
    // A slot two spans cover (a table model error) holds the later cell's value.
    const covered = (spans: { value: string }[]) => (fill === 'repeat' ? spans[spans.length - 1]!.value : '')
    const fillOccupied = () => {
      for (let spans = live(cursor); spans !== undefined; spans = live(cursor)) row[cursor++] = covered(spans)
    }
    for (const cell of rows[y]!) {
      fillOccupied()
      row[cursor] = cell.value
      const cs = cell.colspan
      const rs = cell.rowspan
      if (cs > 1) for (let x = 1; x < cs; x++) row[++cursor] = fill === 'repeat' ? cell.value : ''
      // Its columns are behind the cursor now, so the span is not met again in this row.
      if (rs > 1) {
        for (let col = cursor - cs + 1; col <= cursor; col++) {
          const spans = vertical.get(col)
          if (spans) spans.push({ end: y + rs, value: cell.value })
          else vertical.set(col, [{ end: y + rs, value: cell.value }])
        }
      }
      cursor++
      if (slots + cursor - ++cells > maxPadding) return null
    }
    // A rowspan covers every row it spans, as browsers do, also where the
    // row's cells end before its column (the gap between is padding).
    for (const col of vertical.keys()) {
      const spans = live(col)
      if (spans !== undefined && col >= cursor) row[col] = covered(spans)
    }
    slots += row.length
    if (slots - cells > maxPadding) return null
    out.push(row)
  }
  // A loop, not Math.max(...rows): a table of 200,000 rows would overflow the call stack.
  let width = 0
  for (const r of out) width = Math.max(width, r.length)
  if (width * out.length - cells > maxPadding) return null
  return out.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''))
}

const ROW_GROUPS = new Set(['thead', 'tbody', 'tfoot'])

/**
 * The `<thead>`, `<tbody>` or `<tfoot>` of the table a row is in, or null for
 * a row directly in the table (a fragment's). The walk stops at the table, so
 * a deep page costs no more than the row's own depth.
 */
function rowGroup(tr: Element, table: Element): Element | null {
  for (let el = tr.parentElement; el !== null && el !== table; el = el.parentElement) {
    if (ROW_GROUPS.has(el.localName)) return el
  }
  return null
}

/**
 * The table's first `<thead>` and first `<tfoot>` in tree order, empty ones
 * included, as CSS takes the first of each as the header and footer. One
 * written in a cell counts too, as the browser's parser closes the cell there;
 * nested tables are not searched.
 */
function headAndFoot(table: Element): { head: Element | null; foot: Element | null } {
  let head: Element | null = null
  let foot: Element | null = null
  const stack: Element[] = []
  for (let child = table.lastElementChild; child !== null; child = child.previousElementSibling) stack.push(child)
  for (let el = stack.pop(); el !== undefined && (head === null || foot === null); el = stack.pop()) {
    if (el.localName === 'thead') head ??= el
    else if (el.localName === 'tfoot') foot ??= el
    if (el.localName === 'table') continue
    // One push per child, not push(...children): a <div> of 30,000 rows would overflow the call stack.
    for (let child = el.lastElementChild; child !== null; child = child.previousElementSibling) stack.push(child)
  }
  return { head, foot }
}

/**
 * The table's own rows, not those of a table nested in one of its cells, by
 * row group in the order browsers lay them out: the first `<thead>` first and
 * the first `<tfoot>` last, wherever they are written. A later `<thead>` or
 * `<tfoot>` stays where it is, as CSS lays out only the first as the header
 * or footer. Each run of rows directly in the table is a group of its own,
 * as the browser's parser wraps each in a `<tbody>`.
 */
function ownRowGroups(table: Element): Element[][] {
  const runs: { group: Element | null; rows: Element[] }[] = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table || inForeign(tr, table)) continue
    const group = rowGroup(tr, table)
    const last = runs[runs.length - 1]
    if (last !== undefined && last.group === group) last.rows.push(tr)
    else runs.push({ group, rows: [tr] })
  }
  const { head, foot } = headAndFoot(table)
  const headRun = head === null ? undefined : runs.find((run) => run.group === head)
  const footRun = foot === null ? undefined : runs.find((run) => run.group === foot)
  const body = runs.filter((run) => run !== headRun && run !== footRun)
  return [...(headRun ? [headRun] : []), ...body, ...(footRun ? [footRun] : [])].map((run) => run.rows)
}

function ownRows(table: Element): Element[] {
  return ownRowGroups(table).flat()
}

/** A row's own cells, not those of a table nested in one of them. */
function ownCells(tr: Element): Element[] {
  return Array.from(tr.querySelectorAll('th,td')).filter((cell) => cell.closest('tr') === tr && !inForeign(cell, tr))
}

/** Whether an svg or math element lies between `el` and its ancestor `top`: its <tr> or <td> is not a row or cell. */
function inForeign(el: Element, top: Element): boolean {
  for (let up = el.parentElement; up !== null && up !== top; up = up.parentElement) {
    if (up.localName === 'svg' || up.localName === 'math') return true
  }
  return false
}

/**
 * An attribute read by HTML's rules for parsing non-negative integers:
 * leading whitespace, an optional sign, then the leading digits (`1.5` is 1,
 * `2abc` is 2); null when absent, when no digit follows, or when negative.
 */
function nonNegativeInteger(attr: string | null): number | null {
  const m = attr === null ? null : /^[\t\n\f\r ]*([-+]?)([0-9]+)/.exec(attr)
  if (m === null) return null
  const n = Number(m[2])
  return m[1] === '-' && n !== 0 ? null : n
}

/**
 * A table's caption and cells as `cell` writes each one; a table nested in a
 * cell is that cell's text. Spans are integers of at least 1, read as browsers
 * read them: a colspan that is invalid or 0 is 1, an invalid rowspan is 1, a
 * rowspan of 0 covers the rest of its row group (its `<thead>`, `<tbody>` or
 * `<tfoot>`, or the run of rows directly in the table), and no rowspan goes
 * past the end of its row group.
 */
function tableCells(table: Element, cell: (el: Element) => string): { caption: string | null; rows: GridCell[][] } {
  const captionEl = table.querySelector(':scope > caption')
  const groups = ownRowGroups(table)
  const trs = groups.flat()
  // Row → how many rows from it to the end of its row group.
  const groupLeft = groups.flatMap((group) => group.map((_, i) => group.length - i))
  const rows = trs.map((tr, r) => ownCells(tr).map((el) => {
    const rowspan = nonNegativeInteger(el.getAttribute('rowspan')) ?? 1
    return {
      value: cell(el),
      colspan: Math.min(nonNegativeInteger(el.getAttribute('colspan')) || 1, MAX_COLSPAN),
      rowspan: Math.min(rowspan === 0 ? groupLeft[r]! : rowspan, groupLeft[r]!, MAX_ROWSPAN),
    }
  }))
  return { caption: captionEl ? cell(captionEl) : null, rows }
}

/**
 * The most characters a table's rows may hold once its spans are repeated
 * into every slot they cover and every row is padded to the widest, and the
 * most all of a page's tables may hold together; past either, a table is
 * given as `omitted: 'too_large'` with no rows, so a small page cannot make a
 * huge CSV or response. A cell counts what its CSV field and its JSON string
 * cost: its text, each `"` three more times (`""` in CSV, escaped again in
 * JSON), each `\` once more and each control character five more (`\u00XX`
 * in JSON), plus three for the separators and quotes.
 */
export const MAX_TABLE_CHARS = 2_000_000
export const MAX_PAGE_TABLE_CHARS = 5_000_000

function cellCost(value: string): number {
  let extra = 3
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c === 34) extra += 3
    else if (c === 92) extra += 1
    // JSON writes a control character as \u00XX.
    else if (c < 32) extra += 5
  }
  return value.length + extra
}

/**
 * One data table as data: its caption and cells as plain text (a link is its
 * text, an image its alt text, whitespace collapsed, no Markdown escaping),
 * a spanned cell's value in every slot it covers, and how many leading rows
 * are headers (in `<thead>`, or made of `<th>` cells alone). Null when it
 * has no cells, as the GFM table is then empty.
 */
function tableData(table: Element, ctx: Context, tableIndex: number): ExtractedTable | null {
  const { caption, rows } = tableCells(table, (el) => plainCell(el, ctx))
  if (rows.every((row) => row.length === 0)) return null
  // What the repeated spans would hold, before any of it is built (a span past the last row adds nothing).
  let chars = 0
  let spanSlots = 0
  let cellCount = 0
  rows.forEach((row, r) => {
    for (const cell of row) {
      const slots = cell.colspan * Math.min(cell.rowspan, rows.length - r)
      chars += cellCost(cell.value) * slots
      spanSlots += slots
      cellCount++
    }
  })
  const budget = ctx.tableBudget
  const limit = Math.min(MAX_TABLE_CHARS, budget?.left ?? Infinity)
  const omitted: ExtractedTable = { tableIndex, caption: caption === '' ? null : caption, headerRows: 0, rows: [], omitted: 'too_large' }
  if (chars > limit) return omitted
  // Every slot past the spans pads a row to the widest and costs cellCost('') = 3:
  // the grid may hold (limit - chars) / 3 of them, and expandGrid stops building
  // once it would hold more.
  const grid = expandGrid(rows, spanSlots - cellCount + Math.floor((limit - chars) / 3), 'repeat')
  if (grid === null) return omitted
  if (budget !== undefined) budget.left -= chars + 3 * (grid.length * grid[0]!.length - spanSlots)
  let headerRows = 0
  for (const tr of ownRows(table)) {
    const cells = ownCells(tr)
    if (cells.length === 0 || !(rowGroup(tr, table)?.localName === 'thead' || cells.every((el) => el.localName === 'th'))) break
    headerRows++
  }
  return { tableIndex, caption: caption === '' ? null : caption, headerRows, rows: grid }
}

function plainCell(cell: Element, ctx: Context): string {
  const inline = new Inline()
  inlineChildren(cell, inline, ctx, TEXT_MARKS)
  return inline.finish().text.replace(/\s+/g, ' ').trim()
}

function tableToGfm(table: Element, ctx: Context): string {
  const { caption, rows } = tableCells(table, (el) => normalizeCell(cellText(el, ctx)))
  if (rows.every((row) => row.length === 0)) return ''
  if (ctx.tables !== undefined) {
    const data = tableData(table, ctx, ctx.tables.length)
    if (data !== null) ctx.tables.push(data)
  }
  const budget = ctx.tablePadding
  const grid = expandGrid(rows, Math.min(MAX_TABLE_PADDING, budget.left))
  // Too large to pad: each row's own cells, in order and unpadded (GFM fills
  // a short body row and drops cells past the header's width when rendering;
  // the text keeps them), so it stays one table of the Markdown.
  if (grid === null) {
    const lines = caption ? [caption] : []
    const header = rows[0]!.length > 0 ? rows[0]!.map((cell) => cell.value) : ['']
    lines.push(`| ${header.join(' | ')} |`)
    lines.push(`| ${header.map(() => '---').join(' | ')} |`)
    for (const row of rows.slice(1)) lines.push(`| ${row.map((cell) => cell.value).join(' | ')} |`)
    return lines.join('\n')
  }
  budget.left -= grid.length * grid[0]!.length - rows.reduce((n, row) => n + row.length, 0)
  // An empty corner cell stays empty: GFM allows it, and any text put there
  // would not be on the page.
  const header = grid[0]!
  const lines: string[] = []
  if (caption) lines.push(caption)
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of grid.slice(1)) lines.push(`| ${row.join(' | ')} |`)
  return lines.join('\n')
}

// ---------------------------------------------------------------- inline content

interface InlineResult {
  text: string
  /** Whitespace or a line break before or after the text, re-emitted outside a wrapper's markers. */
  lead: boolean
  trail: boolean
  leadBreak: boolean
  trailBreak: boolean
}

/**
 * The inline content of one paragraph (or of one link, emphasis or heading),
 * with whitespace collapsed as a browser collapses it. A '\n' in the text is a
 * <br>.
 */
class Inline {
  private readonly parts: string[] = []
  private any = false
  private lineStarted = false
  private pendingSpace = false
  private lead = false
  private leadBreak = false

  text(raw: string): void {
    const text = raw.replace(WHITESPACE, ' ')
    if (text.length === 0) return
    const leading = text.startsWith(' ')
    const trailing = text.length > 1 && text.endsWith(' ')
    if (leading) this.space()
    const core = text.slice(leading ? 1 : 0, trailing ? -1 : undefined)
    if (core) this.content(core)
    if (trailing) this.space()
  }

  space(): void {
    if (this.lineStarted) this.pendingSpace = true
    else if (!this.any) this.lead = true
  }

  content(s: string): void {
    if (this.pendingSpace) {
      this.parts.push(' ')
      this.pendingSpace = false
    }
    this.parts.push(s)
    this.any = this.lineStarted = true
  }

  lineBreak(): void {
    this.pendingSpace = false
    if (!this.any) {
      this.leadBreak = true
      return
    }
    this.parts.push('\n')
    this.lineStarted = false
  }

  /**
   * Append a nested run between markers. Its outer whitespace goes outside
   * the markers (`** bold **` is not emphasis), and an empty run emits no
   * markers at all.
   */
  wrap(inner: InlineResult, open: string, close: string): void {
    if (inner.leadBreak) this.lineBreak()
    else if (inner.lead) this.space()
    // A blank line would end the paragraph inside the markers.
    if (inner.text) this.content(open + inner.text.replace(/\n{2,}/g, '\n') + close)
    if (inner.trailBreak) this.lineBreak()
    else if (inner.trail) this.space()
  }

  finish(): InlineResult {
    const joined = this.parts.join('')
    const text = joined.replace(/\n+$/, '')
    return {
      text,
      lead: this.lead,
      trail: this.pendingSpace,
      leadBreak: this.leadBreak,
      trailBreak: text.length < joined.length,
    }
  }

  /** The text as paragraph Markdown: a <br> is a hard break, two in a row start a new paragraph. */
  paragraph(): string {
    return this.finish()
      .text.split(/\n{2,}/)
      .map((part) => part.split('\n').join('  \n'))
      .join('\n\n')
  }
}

interface Marks {
  strong: boolean
  em: boolean
  link: boolean
  /** Emphasis and code spans are written as plain text (a table cell). */
  plain: boolean
  /** Links and images too: a link is its text, an image its alt text (a cell of the `tables` format). */
  text: boolean
}

const NO_MARKS: Marks = { strong: false, em: false, link: false, plain: false, text: false }
const CELL_MARKS: Marks = { ...NO_MARKS, plain: true }
const TEXT_MARKS: Marks = { ...CELL_MARKS, text: true }

/**
 * Link and image targets are made absolute against the document base, so the
 * Markdown stands on its own. Same-document fragments ("#section") stay as
 * written: they point at headings of this same Markdown, and Monitor heading
 * rules read heading anchors in that form. Without a base, targets stay as
 * written. javascript: targets and unparseable ones give no target. Nor does a
 * data: URI, as Firecrawl's removeBase64Images drops image ones by default:
 * the encoded bytes are noise in Markdown and point at no source, so a link
 * keeps only its text and an image only its alt text.
 */
function linkTarget(raw: string, base: URL | null): string | null {
  const href = raw.replace(/[\t\n\r]/g, '').trim()
  if (href === '' || /^(?:javascript|data):/i.test(href)) return null
  if (href.startsWith('#') || base === null) return href
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

/** A target as a CommonMark link destination, in <…> where a space or unbalanced parenthesis would cut it short. */
function destination(target: string): string {
  if (!/[()\s<>]/.test(target)) return target
  let depth = 0
  for (const ch of target) {
    if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) break
  }
  if (depth === 0 && !/[\s<>]/.test(target)) return target
  return `<${target.replace(/</g, '%3C').replace(/>/g, '%3E')}>`
}

function longestBacktickRun(text: string): number {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return longest
}

function inlineChildren(parent: Node, out: Inline, ctx: Context, marks: Marks): void {
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType === TEXT_NODE) out.text((node as Text).data)
    else if (node.nodeType === ELEMENT_NODE) inlineElement(node as Element, out, ctx, marks)
  }
}

function inlineElement(el: Element, out: Inline, ctx: Context, marks: Marks): void {
  const tag = el.localName
  if (skipped(el, ctx)) return
  // Blocks met in inline context (a card inside a link, a paragraph inside a
  // heading, a box the page's CSS lays out as a block) flatten to one line:
  // their boundaries become spaces.
  const block = BLOCK.has(tag) || cssBlock(el, ctx)
  if (block) out.space()
  let rendered = true
  switch (tag) {
    case 'br':
      out.lineBreak()
      break
    case 'img':
      if (marks.text) {
        const alt = (el.getAttribute('alt') ?? '').replace(WHITESPACE, ' ').trim()
        if (alt) out.content(alt)
      } else image(el, out, ctx)
      break
    case 'code':
      if (marks.plain) rendered = false
      else codeSpan(el, out, ctx)
      break
    case 'a':
      rendered = link(el, out, ctx, marks)
      break
    case 'strong':
    case 'b':
      if (marks.strong || marks.plain) rendered = false
      else emphasis(el, out, ctx, { ...marks, strong: true }, '**')
      break
    case 'em':
    case 'i':
      if (marks.em || marks.plain) rendered = false
      else emphasis(el, out, ctx, { ...marks, em: true }, '*')
      break
    case 'sup':
    case 'sub': {
      // Digits and signs keep their script form; a footnote mark or a word
      // in a superscript stays as written.
      const inner = new Inline()
      inlineChildren(el, inner, ctx, marks)
      const run = inner.finish()
      const script = scriptText(run.text, tag)
      out.wrap(script === null ? run : { ...run, text: script }, '', '')
      break
    }
    default:
      rendered = false
  }
  // The loop is written out (not inlineChildren) so deep nesting costs one
  // stack frame per level.
  if (!rendered) {
    for (let node = el.firstChild; node !== null; node = node.nextSibling) {
      if (node.nodeType === TEXT_NODE) out.text((node as Text).data)
      else if (node.nodeType === ELEMENT_NODE) inlineElement(node as Element, out, ctx, marks)
    }
  }
  if (block) out.space()
}

function emphasis(el: Element, out: Inline, ctx: Context, marks: Marks, marker: string): void {
  const inner = new Inline()
  inlineChildren(el, inner, ctx, marks)
  out.wrap(inner.finish(), marker, marker)
}

function codeSpan(el: Element, out: Inline, ctx: Context): void {
  const inner = new Inline()
  inner.text(shownText(el, ctx))
  const result = inner.finish()
  const fence = '`'.repeat(longestBacktickRun(result.text) + 1)
  const pad = result.text.startsWith('`') || result.text.endsWith('`') ? ' ' : ''
  out.wrap(result, fence + pad, pad + fence)
}

/** Render a link; false when it has no usable target (no href, or inside another link) and is only text. */
function link(el: Element, out: Inline, ctx: Context, marks: Marks): boolean {
  const href = el.getAttribute('href')
  const target = href === null || marks.link || marks.text ? null : linkTarget(href, ctx.base)
  if (target === null) return false
  const inner = new Inline()
  inlineChildren(el, inner, ctx, { ...marks, link: true })
  const result = inner.finish()
  // A link with no text keeps its target as the text, except a bare
  // same-page anchor (a heading's permalink icon), which says nothing.
  if (!result.text && target.startsWith('#')) out.wrap(result, '', '')
  else out.wrap({ ...result, text: result.text || target }, '[', `](${destination(target)})`)
  return true
}

/** An image with its alt text and absolute target; only the alt text when it has no target (a `data:` URI, unless the caller keeps those). */
function image(el: Element, out: Inline, ctx: Context): void {
  const alt = (el.getAttribute('alt') ?? '').replace(WHITESPACE, ' ').trim()
  const src = el.getAttribute('src')
  const kept = src === null ? null : src.replace(/[\t\n\r]/g, '').trim()
  const target = kept === null ? null : ctx.keepDataUriImages && /^data:/i.test(kept) ? kept : linkTarget(kept, ctx.base)
  if (target !== null) out.content(`![${alt.replace(/[[\]]/g, '\\$&')}](${destination(target)})`)
  else if (alt) out.content(alt)
}

// ---------------------------------------------------------------- blocks

/** Blocks of one container, plus the paragraph its inline content is building. */
class Flow {
  readonly blocks: Block[] = []
  inline = new Inline()

  constructor(readonly ctx: Context) {}

  flush(): void {
    const text = this.inline.paragraph()
    if (text) this.blocks.push({ text })
    this.inline = new Inline()
  }

  add(...blocks: (Block | null)[]): void {
    this.flush()
    for (const block of blocks) if (block !== null && block.text) this.blocks.push(block)
  }
}

function flowChildren(parent: Node, flow: Flow): void {
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) flowNode(node, flow)
}

function flowNode(node: Node, flow: Flow): void {
  if (node.nodeType === TEXT_NODE) {
    flow.inline.text((node as Text).data)
    return
  }
  if (node.nodeType !== ELEMENT_NODE) return
  const el = node as Element
  const tag = el.localName
  const ctx = flow.ctx
  if (skipped(el, ctx)) return
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      flow.add(heading(el, ctx))
      return
    case 'pre':
      flow.add(codeBlock(el, ctx))
      return
    case 'table':
      // A table whose nested tables hold most of its text lays out the page
      // (Hacker News puts its header, story list and footer in one), and so
      // does a single row (a bar of links): their cells are blocks, and only
      // the data tables inside are grids.
      if (isLayoutTable(el) || ownRows(el).length < 2) break
      flow.add({ text: tableToGfm(el, ctx) })
      return
    case 'li': {
      // An item outside any list still renders with its bullet.
      const text = listItem('-', blocksOf(el, ctx))
      flow.add({ text, interrupts: true })
      return
    }
    case 'blockquote':
      flow.add(blockquote(el, ctx))
      return
    case 'hr':
      flow.add({ text: '---' })
      return
    case 'br':
      flow.inline.lineBreak()
      return
  }
  if (LIST.has(tag)) {
    flow.add(...list(el, ctx))
    return
  }
  const tagBlock = BLOCK.has(tag)
  const block = tagBlock || cssBlock(el, ctx)
  if (!tagBlock && !containsBlock(el, ctx)) {
    // Inline content, in a paragraph of its own when the page's CSS makes
    // the element a block (a link or emphasis keeps its markup).
    if (block) flow.flush()
    inlineElement(el, flow.inline, ctx, NO_MARKS)
    if (block) flow.flush()
    return
  }
  if (!tagBlock && tag === 'a' && el.hasAttribute('href')) {
    // A link around blocks (a card) stays one link, with its text flattened,
    // in a paragraph of its own.
    flow.flush()
    inlineElement(el, flow.inline, ctx, NO_MARKS)
    flow.flush()
    return
  }
  // A block container, or an inline element around blocks (a <span> holding
  // <div>s), which is laid out as those blocks. The loop is written out so
  // deep nesting costs one stack frame per level.
  if (block) flow.flush()
  for (let child = el.firstChild; child !== null; child = child.nextSibling) flowNode(child, flow)
  if (block) flow.flush()
}

function containsBlock(el: Element, ctx: Context): boolean {
  const known = ctx.blockMemo.get(el)
  if (known !== undefined) return known
  let found = false
  for (let child = el.firstElementChild; child !== null && !found; child = child.nextElementSibling) {
    if (!skipped(child, ctx)) found = BLOCK.has(child.localName) || cssBlock(child, ctx) || containsBlock(child, ctx)
  }
  ctx.blockMemo.set(el, found)
  return found
}

/** The blocks inside a container element. */
function blocksOf(el: Node, ctx: Context): Block[] {
  const flow = new Flow(ctx)
  flowChildren(el, flow)
  flow.flush()
  return flow.blocks
}

/** The blocks one node renders to on its own. */
function nodeBlocks(node: Node, ctx: Context): Block[] {
  const flow = new Flow(ctx)
  flowNode(node, flow)
  flow.flush()
  return flow.blocks
}

function heading(el: Element, ctx: Context): Block | null {
  const inner = new Inline()
  inlineChildren(el, inner, ctx, NO_MARKS)
  // A heading is one line: a <br> inside it becomes a space.
  const text = inner.finish().text.split('\n').filter(Boolean).join(' ')
  return text ? { text: `${'#'.repeat(Number(el.localName[1]))} ${text}` } : null
}

/** Text of a <pre>, exactly, with <br> as a newline. */
function preText(pre: Element, ctx: Context): string {
  const parts: string[] = []
  const walk = (parent: Node): void => {
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
      if (node.nodeType === TEXT_NODE) {
        parts.push((node as Text).data)
      } else if (node.nodeType === ELEMENT_NODE) {
        if (skipped(node as Element, ctx)) continue
        if ((node as Element).localName === 'br') parts.push('\n')
        else walk(node)
      }
    }
  }
  walk(pre)
  return parts.join('')
}

const LANGUAGE_CLASS = /(?:^|\s)(?:language|lang)-([^\s`]+)/

function codeLanguage(pre: Element): string {
  for (const el of [pre, pre.querySelector('code')]) {
    const match = LANGUAGE_CLASS.exec(el?.getAttribute('class') ?? '')
    if (match) return match[1]!
  }
  return ''
}

function codeBlock(pre: Element, ctx: Context): Block | null {
  let text = preText(pre, ctx).replace(/\r\n?/g, '\n')
  // The HTML parser drops a newline right after <pre>; the last one only ends the last line.
  if (text.startsWith('\n')) text = text.slice(1)
  text = text.replace(/\n$/, '')
  if (text.trim() === '') return null
  // The fence must be longer than any backtick run that could close it.
  let longest = 0
  for (const match of text.matchAll(/^ {0,3}(`+)/gm)) longest = Math.max(longest, match[1]!.length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return { text: `${fence}${codeLanguage(pre)}\n${text}\n${fence}` }
}

function blockquote(el: Element, ctx: Context): Block | null {
  const inner = blocksOf(el, ctx)
    .map((block) => block.text)
    .join('\n\n')
  if (!inner) return null
  return { text: inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n') }
}

/**
 * One list item: the marker, then the item's blocks indented under it. A
 * nested list follows the text before it directly; other blocks are
 * separated by a blank line. An item with no content is dropped.
 */
function listItem(marker: string, blocks: Block[]): string {
  if (blocks.length === 0) return ''
  let body = blocks[0]!.text
  for (const block of blocks.slice(1)) body += (block.interrupts ? '\n' : '\n\n') + block.text
  return `${marker} ${body.replace(/\n(?=.)/g, `\n${' '.repeat(marker.length + 1)}`)}`
}

function hasItemChild(el: Element): boolean {
  for (let child = el.firstElementChild; child !== null; child = child.nextElementSibling) {
    if (child.localName === 'li') return true
  }
  return false
}

/**
 * A list, preceded by any content that sits in the list before its first
 * item. Ordered items are numbered from `start` (and an item's `value`).
 * Other children of the list (a nested list written as a sibling of the
 * items) belong to the item before them; wrappers around items are looked
 * through.
 */
function list(el: Element, ctx: Context): Block[] {
  const ordered = el.localName === 'ol'
  const start = Number.parseInt(el.getAttribute('start') ?? '', 10)
  let number = ordered && start >= 0 ? start : 1
  const before: Block[] = []
  const items: { marker: string; blocks: Block[] }[] = []
  const visit = (parent: Element): void => {
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
      const tag = node.nodeType === ELEMENT_NODE ? (node as Element).localName : ''
      if (tag === 'li') {
        const value = ordered ? Number.parseInt((node as Element).getAttribute('value') ?? '', 10) : Number.NaN
        if (value >= 0) number = value
        items.push({ marker: ordered ? `${number}.` : '-', blocks: blocksOf(node, ctx) })
        number++
      } else if (tag !== '' && !SKIP.has(tag) && !LIST.has(tag) && hasItemChild(node as Element)) {
        visit(node as Element)
      } else {
        const blocks = nodeBlocks(node, ctx)
        const last = items[items.length - 1]
        if (last) last.blocks.push(...blocks)
        else before.push(...blocks)
      }
    }
  }
  visit(el)
  const text = items
    .map((item) => listItem(item.marker, item.blocks))
    .filter(Boolean)
    .join('\n')
  return [...before, { text, interrupts: text.startsWith('- ') || text.startsWith('1. ') }]
}

function toUrl(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function htmlToMarkdown(html: string, options: MarkdownOptions = {}): string {
  return convert(html, options)
}

/**
 * One data table of a page, as the Markdown writes it as a GFM table:
 * `tableIndex` counts those tables from 0 in document order, so table N here
 * is the Nth GFM table of the Markdown made from the same HTML and options.
 * Layout tables and single-row tables are not data tables, and a table
 * nested in a cell is that cell's text, as in the Markdown.
 */
export interface ExtractedTable {
  tableIndex: number
  /** The `<caption>` as plain text; null when there is none. */
  caption: string | null
  /** Leading rows in `<thead>` or made of `<th>` cells alone. */
  headerRows: number
  /** Every row padded to the table's width; a spanned cell's value fills each slot it covers. Empty when the table is omitted. */
  rows: string[][]
  /** Present when the table's repeated and padded cells would exceed MAX_TABLE_CHARS, or what the page's tables have left of MAX_PAGE_TABLE_CHARS: its rows are not given. */
  omitted?: 'too_large'
}

/** The data tables of the HTML, from the same walk htmlToMarkdown makes with the same options. */
export function htmlToTables(html: string, options: MarkdownOptions = {}): ExtractedTable[] {
  const tables: ExtractedTable[] = []
  convert(html, options, tables)
  return tables
}

/**
 * HTML that starts with <head>, after whitespace and comments, is a page
 * served without <html>; a fragment never starts there. One that starts with
 * <body> may be a fragment (mainHtml is the body itself when that is the main
 * content), so it stays one. A scan, not a regex: a repeated comment pattern
 * backtracks exponentially over a page that opens with many comments.
 */
function startsWithHead(html: string): boolean {
  let at = 0
  for (;;) {
    while (at < html.length && /\s/.test(html[at]!)) at++
    if (!html.startsWith('<!--', at)) break
    const end = html.indexOf('-->', at + 4)
    if (end < 0) return false
    at = end + 3
  }
  return /^<head[\s>]/i.test(html.slice(at, at + 6))
}

function convert(html: string, options: MarkdownOptions, tables?: ExtractedTable[]): string {
  if (html.trim().length === 0) return ''
  const whole = /<html[\s>]|<!doctype/i.test(html) || startsWithHead(html)
  // A fragment is read as a <template>'s content, so its rows and cells stay: it may be one row of a layout table.
  const doc = parse(html, !whole)
  const document = doc.document
  // A whole document may carry its own <base href>; a fragment such as
  // mainHtml is resolved against the base the caller passes.
  const base = toUrl(whole ? documentBaseUrl(document, options.baseUrl) : options.baseUrl)
  detachAll(namedBy(document, options.exclude ?? []))
  const root =
    document.body && document.body.childNodes.length > 0 ? document.body : (document.documentElement ?? document.body)
  if (!root) {
    doc.close()
    return ''
  }
  const layout = document.querySelector(`[${LAYOUT_MARKERS.display}],[${LAYOUT_MARKERS.hidden}]`) !== null
  const markdown = blocksOf(root, { base, blockMemo: new Map(), layout, keepDataUriImages: options.dataUriImages === 'keep', tablePadding: { left: MAX_PAGE_TABLE_PADDING }, ...(tables === undefined ? {} : { tables, tableBudget: { left: MAX_PAGE_TABLE_CHARS } }) })
    .map((block) => block.text)
    .join('\n\n')
  doc.close()
  return markdown
}
