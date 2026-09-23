import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'

const directory = mkdtempSync(join(tmpdir(), 'amazon-field-review-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const fieldNames = ['asin', 'title', 'kind', 'brand', 'price', 'currency', 'seller', 'availability',
  'deliveryLocation', 'rating', 'reviewCount', 'images', 'prices', 'variants', 'specifications']

function score(entries: unknown[]) {
  const input = join(directory, 'review.json')
  const output = join(directory, 'score.json')
  writeFileSync(input, JSON.stringify({
    source: { commit: 'test', dirty: false }, expectedEntries: 30, entries,
    signoff: { reviewer: 'Howard', signedAt: '2026-09-23T00:00:00Z' },
  }))
  try {
    execFileSync(process.execPath, ['scripts/section-b/amazon-field-review.mjs', 'score', input, output], { stdio: 'ignore' })
  } catch { /* a failed score still writes its findings */ }
  return JSON.parse(readFileSync(output, 'utf8'))
}

it('keeps accuracy, coverage, and subject leakage as separate acceptance conditions', () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    asin: `B${String(index).padStart(9, '0')}`,
    recommendationLeak: { checked: true, found: false },
    fields: Object.fromEntries(fieldNames.map(name => [name, {
      output: name === 'asin' ? `B${String(index).padStart(9, '0')}` : 'visible value',
      humanTruth: { applicable: true, visible: true,
        value: name === 'asin' ? `B${String(index).padStart(9, '0')}` : 'visible value', location: '#subject' },
    }])),
  }))
  entries[0]!.fields.title.output = 'different title'
  const oneMismatch = score(entries)
  expect(oneMismatch.accuracy.rate).toBeGreaterThan(0.98)
  expect(oneMismatch.coverage.rate).toBe(1)
  expect(oneMismatch.passed).toBe(true)

  for (let index = 0; index < 10; index++) entries[index]!.fields.price.output = ''
  const missingVisible = score(entries)
  expect(missingVisible.coverage.rate).toBeLessThan(0.98)
  expect(missingVisible.passed).toBe(false)

  entries[0]!.recommendationLeak.found = true
  const leaked = score(entries)
  expect(leaked.findings.some((finding: { issue: string }) => finding.issue === 'recommendation_leak_unreviewed_or_found')).toBe(true)
  expect(leaked.passed).toBe(false)
})
