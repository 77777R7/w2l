/**
 * HTML → Markdown after main-content extraction.
 *
 * ExtractorOutput.mainHtml stays HTML (the extractor's job is the region).
 * This is pipeline step 7: turn that region into LLM-ready Markdown.
 * Tables keep the GFM grid rules the fixture suite already scores.
 */

import { parse, tagOf, textOf } from './dom.js'

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

function normalizeCell(s: string): string {
  return entityDecode(s)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|')
}

function expandGrid(rows: { value: string; colspan: number; rowspan: number }[][]): string[][] {
  const out: (string | undefined)[][] = []
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

function tableToGfm(table: Element): string {
  const captionEl = table.querySelector('caption')
  const caption = captionEl ? normalizeCell(textOf(captionEl)) : null
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).map((cell) => ({
      value: normalizeCell(textOf(cell)),
      colspan: Number(cell.getAttribute('colspan') ?? 1) || 1,
      rowspan: Number(cell.getAttribute('rowspan') ?? 1) || 1,
    })),
  )
  if (rows.length === 0) return ''
  const grid = expandGrid(rows)
  const header = grid[0]!
  if (header[0] === '') header[0] = '(header)'
  const lines: string[] = []
  if (caption) lines.push(caption)
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of grid.slice(1)) lines.push(`| ${row.join(' | ')} |`)
  return lines.join('\n')
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? ''
}

function inline(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ')
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const tag = tagOf(el)
  const inner = Array.from(el.childNodes).map(inline).join('')
  switch (tag) {
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return `**${inner.trim()}**`
    case 'em':
    case 'i':
      return `*${inner.trim()}*`
    case 'code':
      return `\`${inner.trim()}\``
    case 'a': {
      const href = attr(el, 'href')
      const text = inner.trim() || href
      return href ? `[${text}](${href})` : text
    }
    case 'img': {
      const alt = attr(el, 'alt')
      const src = attr(el, 'src')
      return src ? `![${alt}](${src})` : alt
    }
    case 'ul':
    case 'ol':
    case 'table':
    case 'pre':
      return ''
    default:
      return inner
  }
}

function block(el: Element): string {
  const tag = tagOf(el)
  if (['script', 'style', 'noscript', 'button'].includes(tag)) return ''
  if (tag === 'table') return `\n${tableToGfm(el)}\n`
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    return `\n${'#'.repeat(level)} ${inline(el).trim()}\n`
  }
  if (tag === 'p') return `\n${inline(el).trim()}\n`
  if (tag === 'blockquote') {
    const body = blocks(el)
      .split('\n')
      .map((l) => (l.length ? `> ${l}` : '>'))
      .join('\n')
    return `\n${body}\n`
  }
  if (tag === 'pre') return `\n\`\`\`\n${textOf(el).replace(/\n$/, '')}\n\`\`\`\n`
  if (tag === 'li') {
    const nested = Array.from(el.children)
      .filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
      .map(block)
      .join('')
    const text = inline(el).trim()
    return `\n- ${text}${nested}`
  }
  if (tag === 'ul' || tag === 'ol') {
    return Array.from(el.children)
      .filter((c) => tagOf(c) === 'li')
      .map(block)
      .join('')
  }
  if (tag === 'hr') return '\n---\n'
  return blocks(el) || inline(el)
}

function blocks(root: Element): string {
  const parts: string[] = []
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (t) parts.push(t)
      continue
    }
    if (child.nodeType === 1) parts.push(block(child as Element))
  }
  return parts.join('')
}

export function htmlToMarkdown(html: string): string {
  if (html.trim().length === 0) return ''
  const wrapped = /<html[\s>]|<!doctype/i.test(html)
    ? html
    : `<!doctype html><html><body>${html}</body></html>`
  const doc = parse(wrapped)
  const root =
    doc.document.body && doc.document.body.childNodes.length > 0
      ? doc.document.body
      : (doc.document.documentElement ?? doc.document.body)
  if (!root) {
    doc.close()
    return ''
  }
  const md = blocks(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  doc.close()
  return md
}
