import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parseHTML } from 'linkedom'

const FIELDS = ['asin', 'title', 'kind', 'brand', 'price', 'currency', 'seller', 'availability',
  'deliveryLocation', 'rating', 'reviewCount', 'images', 'prices', 'variants', 'specifications']
const [command, inputPath, outputPath] = process.argv.slice(2)
if (!['prepare', 'score'].includes(command) || !inputPath || !outputPath) {
  throw new Error('usage: node amazon-field-review.mjs prepare <baseline.json> <review.json> | score <signed-review.json> <score.json>')
}

function normalize(value) {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  return JSON.stringify(value)
}
function excerpt(doc, selector) {
  if (!selector || !/^[#.[a-z]/i.test(selector) || selector.includes(':') && !selector.includes('[')) return null
  try {
    const el = doc.querySelector(selector)
    return el?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? null
  } catch { return null }
}

if (command === 'prepare') {
  const report = JSON.parse(await readFile(inputPath, 'utf8'))
  if (report.source?.dirty || !report.source?.commit) throw new Error('field review requires a clean source SHA')
  const entries = []
  for (const record of report.records ?? []) {
    if (record.outcome?.status !== 'success') continue
    const rawPath = record.snapshot?.artifacts?.[0]
    if (!rawPath || !record.snapshot?.rawBodySha256) throw new Error(`missing raw HTML snapshot for ${record.asin}`)
    const raw = await readFile(rawPath)
    const hash = createHash('sha256').update(raw).digest('hex')
    if (hash !== record.snapshot.rawBodySha256) throw new Error(`raw HTML hash mismatch for ${record.asin}`)
    const { document } = parseHTML(raw.toString('utf8'))
    const data = record.structured?.data ?? {}
    const evidence = new Map((record.structured?.evidence ?? []).map(item => [item.path.slice(1), item]))
    entries.push({
      round: record.round, asin: record.asin, requestedUrl: record.url,
      capturedAt: record.snapshot.capturedAt, rawBodySha256: hash, rawPath,
      fields: Object.fromEntries(FIELDS.map(name => {
        const source = evidence.get(name)
        return [name, {
          output: data[name] ?? null,
          outputEvidence: source ?? null,
          sourceExcerpt: excerpt(document, source?.evidencePath),
          // Human review must be made from the raw page and evidence location.
          humanTruth: { applicable: null, visible: null, value: null, location: null, note: null },
        }]
      })),
      recommendationLeak: { checked: null, found: null, note: null },
    })
  }
  const review = {
    source: report.source, baselineStartedAt: report.startedAt, baselineEndedAt: report.endedAt,
    schemaSha256: report.source.schemaSha256, manifestSha256: report.source.manifestSha256,
    entries, signoff: { reviewer: null, signedAt: null },
  }
  await writeFile(outputPath, JSON.stringify(review, null, 2))
  console.log(JSON.stringify({ outputPath, entryCount: entries.length, signed: false }))
} else {
  const review = JSON.parse(await readFile(inputPath, 'utf8'))
  if (review.signoff?.reviewer !== 'Howard' || !Number.isFinite(Date.parse(review.signoff?.signedAt ?? ''))) {
    throw new Error('Howard signoff and a valid signedAt timestamp are required')
  }
  let visibleApplicable = 0; let visibleApplicableOutput = 0
  let emitted = 0; let correctEmitted = 0
  const findings = []
  for (const entry of review.entries ?? []) {
    if (entry.recommendationLeak?.checked !== true || entry.recommendationLeak?.found !== false) {
      findings.push({ asin: entry.asin, issue: 'recommendation_leak_unreviewed_or_found' })
    }
    for (const name of FIELDS) {
      const field = entry.fields?.[name]
      const truth = field?.humanTruth
      if (typeof truth?.applicable !== 'boolean' || typeof truth.visible !== 'boolean'
        || (truth.visible && truth.applicable && !truth.location)) {
        findings.push({ asin: entry.asin, field: name, issue: 'truth_incomplete' })
        continue
      }
      const outputPresent = field.output !== null && field.output !== undefined
      if (truth.applicable && truth.visible) {
        visibleApplicable++
        if (outputPresent) visibleApplicableOutput++
      }
      if (outputPresent) {
        emitted++
        const correct = truth.applicable && truth.visible && normalize(field.output) === normalize(truth.value)
        if (correct) correctEmitted++
        else findings.push({ asin: entry.asin, field: name, issue: 'output_mismatch', output: field.output, truth: truth.value })
      }
    }
    if (entry.fields?.asin?.output !== entry.asin) findings.push({ asin: entry.asin, issue: 'subject_asin_mismatch' })
  }
  const accuracy = emitted > 0 ? correctEmitted / emitted : 0
  const coverage = visibleApplicable > 0 ? visibleApplicableOutput / visibleApplicable : 0
  const score = { source: review.source, reviewer: review.signoff,
    accuracy: { correct: correctEmitted, emitted, rate: accuracy },
    coverage: { output: visibleApplicableOutput, visibleApplicable, rate: coverage },
    findings,
    passed: findings.length === 0 && accuracy >= 0.98 && coverage >= 0.98 && (review.entries?.length ?? 0) >= 20,
  }
  await writeFile(outputPath, JSON.stringify(score, null, 2))
  console.log(JSON.stringify({ outputPath, passed: score.passed, accuracy, coverage, findings: findings.length }))
  if (!score.passed) process.exitCode = 1
}
