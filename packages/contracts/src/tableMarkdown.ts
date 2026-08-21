/**
 * Structural table assertions for benchmark ground truth.
 *
 * mustContain/mustNotContain are substring checks: an extraction that drops a
 * column, shifts a row, or flattens the table into prose still contains every
 * required string. These helpers parse GFM tables out of extracted markdown and
 * score column/row geometry against an ExpectedTable annotation.
 */

/** A parsed GFM table. Rows and columns are logical (span spacer cells counted). */
export interface GfmTable {
  columns: number
  rows: number
  /** Trimmed cell text at a logical position; undefined outside bounds. */
  cellAt: (row: number, col: number) => string | undefined
}

/**
 * Structural assertion for one table in the extracted markdown.
 *
 * Cell keys are zero-indexed "row,col". A position covered by a colspan/rowspan
 * spacer cell is addressable but always empty, so annotations should address
 * span origins, not continuations. Cell text is compared exactly against the
 * trimmed markdown cell, so fixture cells must be unique strings.
 */
export interface ExpectedTable {
  /** Logical column count after colspans are expanded. */
  columns: number
  /** Logical row count after rowspans are expanded (header row included). */
  rows: number
  /** Exact cell text by logical position. Use unique cell strings. */
  cells?: Readonly<Record<string, string>>
  /** Cell texts that must land in the same table row. */
  sameRow?: readonly string[]
  /** Cell texts that must land in the same table column. */
  sameColumn?: readonly string[]
  /**
   * Require the content to be a real GFM table. Set false for fixtures that
   * accept any representation; presence is then enforced by mustContain alone.
   * Defaults to true.
   */
  requireMarkdown?: boolean
}

export interface ExpectedTableCheck {
  pass: boolean
  /** Human-readable failures, one per violated constraint. */
  issues: readonly string[]
  /** The parsed table, or null when no GFM table was found. */
  table: GfmTable | null
}

/** Split one line into GFM row cells, or null when the line is not a table row. */
function splitRow(line: string): string[] | null {
  if (!line.includes('|')) return null
  let s = line
  if (s.startsWith('|')) s = s.slice(1)

  // Whether the final character is an unescaped pipe (a row border, not an
  // empty trailing cell): count the backslashes directly before it.
  let backslashes = 0
  let k = s.length - 1
  while (k > 0 && s[k - 1] === '\\') {
    backslashes++
    k--
  }
  const trailingBorder = s.endsWith('|') && backslashes % 2 === 0

  const cells: string[] = []
  let cur = ''
  let inCodeSpan = false
  let codeSpanFence = 0
  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx]!
    if (ch === '\\') {
      cur += ch + (s[idx + 1] ?? '')
      idx++
      continue
    }
    if (ch === '`') {
      let run = 1
      while (s[idx + run] === '`') run++
      cur += '`'.repeat(run)
      if (inCodeSpan) {
        if (codeSpanFence === run) inCodeSpan = false
      } else {
        inCodeSpan = true
        codeSpanFence = run
      }
      idx += run - 1
      continue
    }
    if (ch === '|' && !inCodeSpan) {
      cells.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur.trim())
  if (trailingBorder && cells[cells.length - 1] === '') cells.pop()
  return cells
}

function isDelimiterCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell)
}

/**
 * Find the first GFM table in markdown: a header row, a delimiter row with the
 * same cell count whose cells are hyphens (optionally colon-aligned), and zero
 * or more body rows of the same cell count. Fenced code blocks are skipped.
 * Returns null when no table is present.
 */
export function parseGfmTable(markdown: string): GfmTable | null {
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  let fenceMarker = ''
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i]!.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      if (!inFence) {
        inFence = true
        fenceMarker = trimmed.slice(0, 3)
      } else if (trimmed.startsWith(fenceMarker)) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const header = splitRow(lines[i]!)
    if (!header || header.length < 2) continue
    const delimiter = splitRow(lines[i + 1]!)
    if (!delimiter || delimiter.length !== header.length) continue
    if (!delimiter.every(isDelimiterCell)) continue

    const cells: string[][] = [header]
    let j = i + 2
    while (j < lines.length) {
      const row = splitRow(lines[j]!)
      if (!row || row.length !== header.length) break
      cells.push(row)
      j++
    }
    // A header + delimiter alone is not a table; require at least one body row.
    if (cells.length < 2) continue
    return {
      columns: header.length,
      rows: cells.length,
      cellAt: (row, col) => cells[row]?.[col],
    }
  }
  return null
}

/** First table cell (row-major) whose text contains the needle. */
function locateCell(table: GfmTable, needle: string): { r: number; c: number } | null {
  for (let r = 0; r < table.rows; r++) {
    for (let c = 0; c < table.columns; c++) {
      const cell = table.cellAt(r, c)
      if (cell !== undefined && cell.includes(needle)) return { r, c }
    }
  }
  return null
}

/** Score extracted markdown against an ExpectedTable annotation. */
export function evaluateExpectedTable(
  markdown: string,
  spec: ExpectedTable,
): ExpectedTableCheck {
  const issues: string[] = []
  const table = parseGfmTable(markdown)
  const requireMarkdown = spec.requireMarkdown ?? true

  if (requireMarkdown && !table) {
    return { pass: false, issues: ['No GFM table found in markdown'], table: null }
  }

  if (table) {
    if (table.columns !== spec.columns) {
      issues.push(`Column count ${table.columns}, expected ${spec.columns}`)
    }
    if (table.rows !== spec.rows) {
      issues.push(`Row count ${table.rows}, expected ${spec.rows}`)
    }
  }

  if (table && spec.cells) {
    for (const [key, expected] of Object.entries(spec.cells)) {
      const m = /^(\d+),(\d+)$/.exec(key)
      if (!m) {
        issues.push(`Malformed cell key ${JSON.stringify(key)}`)
        continue
      }
      const r = Number(m[1] ?? NaN)
      const c = Number(m[2] ?? NaN)
      const actual = table.cellAt(r, c)
      if (actual === undefined) {
        issues.push(`Cell [${r},${c}] missing, expected ${JSON.stringify(expected)}`)
      } else if (actual !== expected) {
        issues.push(
          `Cell [${r},${c}] is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        )
      }
    }
  }

  if (table) {
    const anchor = spec.sameRow?.[0]
    if (anchor !== undefined) {
      const first = locateCell(table, anchor)
      if (!first) {
        issues.push(`sameRow anchor ${JSON.stringify(anchor)} not found`)
      } else {
        for (const needle of spec.sameRow!.slice(1)) {
          const pos = locateCell(table, needle)
          if (!pos) issues.push(`sameRow member ${JSON.stringify(needle)} not found`)
          else if (pos.r !== first.r) {
            issues.push(
              `sameRow member ${JSON.stringify(needle)} is in row ${pos.r}, expected ${first.r}`,
            )
          }
        }
      }
    }
    const colAnchor = spec.sameColumn?.[0]
    if (colAnchor !== undefined) {
      const first = locateCell(table, colAnchor)
      if (!first) {
        issues.push(`sameColumn anchor ${JSON.stringify(colAnchor)} not found`)
      } else {
        for (const needle of spec.sameColumn!.slice(1)) {
          const pos = locateCell(table, needle)
          if (!pos) issues.push(`sameColumn member ${JSON.stringify(needle)} not found`)
          else if (pos.c !== first.c) {
            issues.push(
              `sameColumn member ${JSON.stringify(needle)} is in column ${pos.c}, expected ${first.c}`,
            )
          }
        }
      }
    }
  }

  return { pass: issues.length === 0, issues, table }
}
