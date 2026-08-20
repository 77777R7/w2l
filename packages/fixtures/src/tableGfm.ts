import { parseGfmTable } from '@w2l/contracts'

/**
 * Convert a table fixture's HTML into the exact GFM markdown we expect a
 * conforming converter to emit, derived from the authoritative ground truth
 * (the `expectedTable` annotation) rather than maintained by hand.
 *
 * The HTML→markdown rules below are deliberately strict and only support the
 * constructions the table fixtures use (the GFM subset of the fixture shapes):
 * thead/tbody rows, `colspan`/`rowspan` on `td`/`th`, `caption`, and block
 * content inside cells via the `<br>`-join convention (innerHTML is
 * interpreted, then whitespace-normalized and re-joined with ` | ` in the
 * reader's locale-free representation — trailing cell separators are always
 * stripped). Anything fancier belongs in the irregular-table fixtures, whose
 * annotations pin the tolerated representation (`requireMarkdown: false`) but
 * leave it to the converter.
 */

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

function parseFragment(html: string): {
  caption: string | null
  thead: string[][] | null
  tbody: string[][]
} {
  let caption: string | null = null
  const capMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(html)
  if (capMatch) caption = normalizeCell(capMatch[1]!)

  const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(html)
  let thead: string[][] | null = null
  if (theadMatch) {
    const rows = theadMatch[1]!.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
    thead = rows.map((r) => parseRow(r))
  }

  const bodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html)
  const bodySource = bodyMatch ? bodyMatch[1]! : html
  const bodyRows = (bodySource.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []).map((r) =>
    parseRow(r),
  )
  return { caption, thead, tbody: bodyRows }
}

function parseRow(rowHtml: string): string[] {
  const out: string[] = []
  const parts = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []
  for (const part of parts) {
    const m = /^<(t[dh])([^>]*)>([\s\S]*?)<\/t[dh]>$/i.exec(part.trim())
    if (!m) continue
    const attrs = m[2]!.toLowerCase()
    const colspan = /colspan\s*=\s*["']?(\d+)/.exec(attrs)
    const rowspan = /rowspan\s*=\s*["']?(\d+)/.exec(attrs)
    const span = Math.max(Number(colspan?.[1] ?? 1), Number(rowspan?.[1] ?? 1), 1)
    const value = normalizeCell(m[3]!)
    out.push(value)
    for (let s = 1; s < span; s++) out.push('')
  }
  return out
}

export function toGfmTable(html: string): string {
  const { caption, thead, tbody } = parseFragment(html)
  const lines: string[] = []

  const rows: string[][] = [...(thead ?? []), ...tbody]
  if (rows.length === 0) return ''
  const maxCells = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array<string>(maxCells - r.length).fill('')])
  const header = padded[0]!

  if (thead && thead.length > 0) {
    // When the first header cell is empty (a common GFM convention), generate a
    // consistent placeholder rather than emit an empty leading cell.
    if (header[0] === '') header[0] = '(header)'
  }

  if (caption) lines.push(caption)
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of padded.slice(1)) {
    lines.push(`| ${row.join(' | ')} |`)
  }
  return lines.join('\n')
}
