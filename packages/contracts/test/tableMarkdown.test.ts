import { describe, expect, it } from 'vitest'
import {
  evaluateExpectedTable,
  parseGfmTable,
  type ExpectedTable,
  type GfmTable,
} from '../src/index.js'

const BASIC = [
  '| Station | Flow | Recorded |',
  '| --- | --- | --- |',
  '| Meridian | 41 | 1873-04-02 |',
  '| Quarry | 28 | 1873-04-03 |',
  '| Estuary | 17 | 1873-04-05 |',
].join('\n')

function basicSpec(overrides: Partial<ExpectedTable> = {}): ExpectedTable {
  return {
    columns: 3,
    rows: 4,
    cells: { '0,0': 'Station', '1,0': 'Meridian', '1,1': '41', '1,2': '1873-04-02' },
    sameColumn: ['Meridian', 'Quarry', 'Estuary'],
    ...overrides,
  }
}

describe('parseGfmTable', () => {
  it('parses the basic table with correct dimensions and cell access', () => {
    const t = parseGfmTable(BASIC)
    expect(t).not.toBeNull()
    expect(t!.columns).toBe(3)
    expect(t!.rows).toBe(4)
    expect(t!.cellAt(0, 0)).toBe('Station')
    expect(t!.cellAt(1, 1)).toBe('41')
    expect(t!.cellAt(3, 2)).toBe('1873-04-05')
    expect(t!.cellAt(4, 0)).toBeUndefined()
    expect(t!.cellAt(0, 9)).toBeUndefined()
  })

  it('treats a leading pipe as an optional border', () => {
    const bordered = BASIC.split('\n')
      .map((l) => l.slice(1))
      .join('\n')
    const t = parseGfmTable(bordered)
    expect(t!.columns).toBe(3)
    expect(t!.rows).toBe(4)
    expect(t!.cellAt(1, 0)).toBe('Meridian')
  })

  it('skips a whole table when its delimiter row is malformed', () => {
    const bad = '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |'
    expect(parseGfmTable(bad)).toBeNull()
  })

  it('does not treat a delimiter cell with text as a delimiter row', () => {
    const noDelim = '| A | B |\n| x | y |\n| 1 | 2 |'
    expect(parseGfmTable(noDelim)).toBeNull()
  })

  it('keeps escaped pipes inside cells and does not split on them', () => {
    const t = parseGfmTable('| A | B |\n| --- | --- |\n| `x|y` | z |')
    expect(t!.columns).toBe(2)
    expect(t!.cellAt(1, 0)).toBe('`x|y`')
  })

  it('skips a table-like block inside a fenced code block', () => {
    const inFence = ['```', '| A | B |', '| --- | --- |', '| 1 | 2 |', '```', BASIC].join('\n')
    const t = parseGfmTable(inFence)
    expect(t).not.toBeNull()
    expect(t!.cellAt(0, 0)).toBe('Station') // first real table, not the code block
  })
})

describe('evaluateExpectedTable', () => {
  it('passes a conforming table', () => {
    const check = evaluateExpectedTable(BASIC, basicSpec())
    expect(check.pass).toBe(true)
    expect(check.issues).toEqual([])
  })

  it('fails when no GFM table exists', () => {
    const check = evaluateExpectedTable('just prose, no table here', basicSpec())
    expect(check.pass).toBe(false)
    expect(check.issues[0]).toContain('No GFM table found')
    expect(check.table).toBeNull()
  })

  it('accepts a prose representation only when requireMarkdown is false', () => {
    const prose = 'Stations: Meridian 41, Quarry 28, Estuary 17.'
    expect(evaluateExpectedTable(prose, basicSpec({ requireMarkdown: false })).pass).toBe(true)
  })

  it('fails on a dropped column via dimensions and cells', () => {
    const twoCol = [
      '| Station | Flow |',
      '| --- | --- |',
      '| Meridian | 41 |',
      '| Quarry | 28 |',
      '| Estuary | 17 |',
    ].join('\n')
    const check = evaluateExpectedTable(twoCol, basicSpec())
    expect(check.pass).toBe(false)
    expect(check.issues.join('\n')).toContain('Column count 2, expected 3')
  })

  it('fails on a dropped row', () => {
    const short = BASIC.split('\n').slice(0, 4).join('\n')
    const check = evaluateExpectedTable(short, basicSpec())
    expect(check.pass).toBe(false)
    expect(check.issues.join('\n')).toContain('Row count 3, expected 4')
    expect(check.issues.join('\n')).toContain('sameColumn member "Estuary" not found')
  })

  it('fails on a shifted column and reports the exact mismatch', () => {
    const shifted = [
      '| Station | Flow | Recorded |',
      '| --- | --- | --- |',
      '| 41 | Meridian | 1873-04-02 |',
      '| Quarry | 28 | 1873-04-03 |',
      '| Estuary | 17 | 1873-04-05 |',
    ].join('\n')
    const check = evaluateExpectedTable(shifted, basicSpec())
    expect(check.pass).toBe(false)
    expect(check.issues.join('\n')).toContain(
      'Cell [1,0] is "41", expected "Meridian"',
    )
  })

  it('fails when a cell is flattened into prose', () => {
    const prose =
      '| Station | Flow | Recorded |\n| --- | --- | --- |\n| Meridian station flow 41 recorded 1873-04-02 |  |  |'
    const check = evaluateExpectedTable(prose, basicSpec())
    expect(check.pass).toBe(false)
    expect(check.issues.join('\n')).toContain('Cell [1,1]')
  })

  it('requires the table to carry exactly the same number of body rows', () => {
    const check = evaluateExpectedTable(BASIC, basicSpec({ rows: 3 }))
    expect(check.pass).toBe(false)
    expect(check.issues.join('\n')).toContain('Row count 4, expected 3')
  })

  it('treats the first anchor of a sameColumn group as its leader', () => {
    const check = evaluateExpectedTable(BASIC, basicSpec({ sameColumn: ['Quarry', 'Estuary'] }))
    expect(check.pass).toBe(true)
  })

  it('fails when a sameColumn member lands in a different column', () => {
    const shuffled = [
      '| Station | Flow | Recorded |',
      '| --- | --- | --- |',
      '| Meridian | 41 | 1873-04-02 |',
      '| 28 | Quarry | 1873-04-03 |',
      '| Estuary | 17 | 1873-04-05 |',
    ].join('\n')
    const check = evaluateExpectedTable(shuffled, basicSpec())
    expect(check.pass).toBe(false)
    expect(check.issues.join('\n')).toContain('is in column 1, expected 0')
  })
})
