import { parseGfmTable } from '@w2l/contracts'

/**
 * Convert a table fixture's HTML into the exact GFM markdown we expect a
 * conforming converter to emit, derived from the authoritative ground truth
 * (the `expectedTable` annotation) rather than maintained by hand.
 *
 * The HTML→markdown rules below are deliberately strict and only support the
 * constructions the structurally-annotated table fixtures use (the GFM subset
 * of the fixture shapes): a header row (first <tr>), `colspan`/`rowspan` on
 * td/th expanded to the logical grid — colspan adds empty continuation cells
 * in the same row, rowspan adds empty cells in the same column of following
 * rows — plus `caption`. Cell content is single-line: innerHTML is
 * interpreted, whitespace-normalized, and `|` escaped. Anything fancier
 * (nested tables, multi-paragraph cells) belongs in the irregular-table
 * fixtures, whose annotations pin the tolerated representation
 * (`requireMarkdown: false`) but leave the exact shape to the converter.
 */

interface ParsedCell {
  value: string
  colspan: number
  rowspan: number
}

function entityDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
}

/** Normalize whitespace, resolve entities and escape pipes inside a table cell. */
function normalizeCell(s: string): string {
  const text = entityDecode(s)
    .replace(/<br\s*\/?>/gi, ' | ')
    .replace(/<(?!\/?(?:br)\b)[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.replace(/\|/g, '\\|')
}

function parseCells(html: string): { caption: string | null; rows: ParsedCell[][] } {
  let caption: string | null = null
  const capMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(html)
  if (capMatch) caption = normalizeCell(capMatch[1]!)

  const rowHtmls = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
  const rows = rowHtmls.map((rowHtml) => {
    const cells: ParsedCell[] = []
    const parts = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []
    for (const part of parts) {
      const m = /^<(t[dh])([^>]*)>([\s\S]*?)<\/t[dh]>$/i.exec(part.trim())
      if (!m) continue
      const attrs = m[2]!.toLowerCase()
      const colspan = Number(/colspan\s*=\s*["']?(\d+)/.exec(attrs)?.[1] ?? 1)
      const rowspan = Number(/rowspan\s*=\s*["']?(\d+)/.exec(attrs)?.[1] ?? 1)
      cells.push({ value: normalizeCell(m[3]!), colspan, rowspan })
    }
    return cells
  })
  return { caption, rows }
}

/**
 * Expand spanned cells into the logical grid. colspan adds '' continuation
 * cells in the same row; rowspan registers '' cells in the same column of the
 * following rows, for every column the spanning cell covers.
 */
function expandRows(rows: ParsedCell[][]): string[][] {
  const out: (string | undefined)[][] = []
  /** Rowspan continuations still owed from rows above: {col, left}. */
  const vertical: { col: number; left: number }[] = []
  for (const htmlRow of rows) {
    const row: (string | undefined)[] = []
    let cursor = 0
    const fillOccupied = () => {
      for (;;) {
        const span = vertical.find((s) => s.col === cursor)
        if (!span) break
        row[cursor] = ''
        cursor++
        if (--span.left === 0) vertical.splice(vertical.indexOf(span), 1)
      }
    }
    for (const cell of htmlRow) {
      fillOccupied()
      row[cursor] = cell.value
      const cs = Math.max(1, cell.colspan)
      const rs = Math.max(1, cell.rowspan)
      if (cs > 1) for (let x = 1; x < cs; x++) row[++cursor] = ''
      if (rs > 1) {
        for (let w = 0; w < cs; w++) vertical.push({ col: cursor - cs + 1 + w, left: rs - 1 })
      }
      cursor++
    }
    fillOccupied()
    out.push(row)
  }
  const width = Math.max(0, ...out.map((r) => r.length))
  return out.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''))
}

export function toGfmTable(html: string): string {
  const { caption, rows } = parseCells(html)
  if (rows.length === 0) return ''

  const grid = expandRows(rows)
  const header = grid[0]!

  // When the first header cell is empty (a common GFM convention), generate a
  // consistent placeholder rather than emit an empty leading cell.
  if (header[0] === '') header[0] = '(header)'

  const lines: string[] = []
  if (caption) lines.push(caption)
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of grid.slice(1)) {
    lines.push(`| ${row.join(' | ')} |`)
  }
  return lines.join('\n')
}
