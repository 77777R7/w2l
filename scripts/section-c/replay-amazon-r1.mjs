import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { extractTf } from '../../packages/extract-tf/dist/index.js'

const evidenceRoot = process.argv[2]
if (!evidenceRoot) {
  console.error('Usage: npm run replay:amazon:r1 -- /absolute/path/to/private/.w2l/public-preview')
  process.exit(2)
}

const ledger = JSON.parse(readFileSync(new URL('../../docs/evidence/amazon-public-r0-failure-ledger-2026-09-24.json', import.meta.url), 'utf8'))
const records = [...ledger.failures, ...ledger.successControls]
if (ledger.failures.length !== 29 || ledger.successControls.length !== 20) throw new Error('Frozen review set changed')

const counts = { reviewed: 0, hashVerified: 0, matched: 0, mismatched: 0, unavailable: 0, optionsUnobserved: 0, controlsPresent: 0 }
const errors = []
for (const row of records) {
  const file = resolve(join(evidenceRoot, row.witness.privateRelativePath))
  const root = resolve(evidenceRoot)
  if (!file.startsWith(`${root}/`)) throw new Error('Evidence path escaped the private root')
  const html = readFileSync(file)
  if (createHash('sha256').update(html).digest('hex') !== row.witness.htmlSha256) {
    errors.push(`${row.cohort}#${row.index}: hash mismatch`)
    continue
  }
  counts.hashVerified++
  const product = extractTf.extract(html.toString('utf8'), { url: row.finalUrl }).product
  const identity = product?.identity
  const quote = product?.quoteState
  counts.reviewed++
  if (identity?.status === 'matched') counts.matched++
  if (identity?.status === 'mismatched') counts.mismatched++
  const expected = row.classification === 'selected_subject_mismatch' ? ['mismatched', 'unobserved']
    : row.classification === 'unavailable_in_captured_context' ? ['matched', 'absent_observed']
      : row.classification === 'purchase_options_only_in_capture' ? ['matched', 'unobserved']
        : ['matched', 'present']
  if (identity?.status !== expected[0] || quote !== expected[1]) errors.push(`${row.cohort}#${row.index}: expected ${expected.join('/')}, observed ${identity?.status ?? 'none'}/${quote ?? 'none'}`)
  if (row.classification === 'selected_subject_mismatch' && product?.price) errors.push(`${row.cohort}#${row.index}: substitute price leaked`)
  if (row.classification === 'unavailable_in_captured_context' && quote === 'absent_observed') counts.unavailable++
  if (row.classification === 'purchase_options_only_in_capture' && quote === 'unobserved') counts.optionsUnobserved++
  if (row.classification === 'complete_control_subject_quote_visible' && quote === 'present') counts.controlsPresent++
}
console.log(JSON.stringify({ ...counts, errors }, null, 2))
if (errors.length) process.exitCode = 1
