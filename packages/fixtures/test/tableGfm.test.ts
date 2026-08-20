import { parseGfmTable } from '@w2l/contracts'
import { describe, expect, it } from 'vitest'
import { toGfmTable } from '../src/index.js'

function gridOf(md: string): (string | undefined)[][] {
  const t = parseGfmTable(md)
  expect(t, `expected a GFM table in:\n${md}`).not.toBeNull()
  const grid: (string | undefined)[][] = []
  for (let r = 0; r < t!.rows; r++) {
    const row: (string | undefined)[] = []
    for (let c = 0; c < t!.columns; c++) row.push(t!.cellAt(r, c))
    grid.push(row)
  }
  return grid
}

describe('toGfmTable', () => {
  it('converts a plain table with header row', () => {
    const md = toGfmTable(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    )
    expect(gridOf(md)).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ])
  })

  it('expands colspan into empty continuation cells', () => {
    const md = toGfmTable(
      '<table><tr><th colspan="3">Full span</th></tr><tr><td>A</td><td>B</td><td>C</td></tr></table>',
    )
    expect(gridOf(md)).toEqual([
      ['Full span', '', ''],
      ['A', 'B', 'C'],
    ])
  })

  it('expands rowspan into empty cells in following rows', () => {
    const md = toGfmTable(
      '<table><tr><th rowspan="3">Tall cell</th><th>R1</th></tr><tr><td>R2</td></tr><tr><td>R3</td></tr></table>',
    )
    expect(gridOf(md)).toEqual([
      ['Tall cell', 'R1'],
      ['', 'R2'],
      ['', 'R3'],
    ])
  })

  it('handles combined rowspan+colspan', () => {
    const md = toGfmTable(
      '<table><tr><th rowspan="2" colspan="2">Origin</th><th>Mid</th></tr>' +
        '<tr><td>Right</td></tr>' +
        '<tr><td>Left</td><td> </td><td> </td></tr></table>',
    )
    expect(gridOf(md)).toEqual([
      ['Origin', '', 'Mid'],
      ['', '', 'Right'],
      ['Left', '', ''],
    ])
  })

  it('escapes pipes in cells', () => {
    const md = toGfmTable(
      '<table><tr><th>Expr</th><th>Result</th></tr><tr><td>left | right</td><td>true</td></tr></table>',
    )
    expect(gridOf(md)).toEqual([
      ['Expr', 'Result'],
      ['left \\| right', 'true'],
    ])
  })

  it('keeps an empty middle cell so later cells do not shift', () => {
    const md = toGfmTable(
      '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>Filled A</td><td></td><td>Filled B</td></tr></table>',
    )
    expect(gridOf(md)).toEqual([
      ['A', 'B', 'C'],
      ['Filled A', '', 'Filled B'],
    ])
  })

  it('preserves a caption', () => {
    const md = toGfmTable(
      '<table><caption>Table 1: readings</caption><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    )
    expect(md.startsWith('Table 1: readings')).toBe(true)
    expect(gridOf(md)).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ])
  })

  it('returns an empty string for a table with no rows', () => {
    expect(toGfmTable('<table></table>')).toBe('')
  })
})
