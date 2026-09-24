#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseHTML } from 'linkedom'

const evidenceRoot = process.argv[2]
if (!evidenceRoot) throw new Error('Usage: node scripts/public-preview/r0-audit.mjs <private-public-preview-dir>')
const root = resolve(evidenceRoot)
const output = 'docs/evidence/amazon-public-r0-failure-ledger-2026-09-24.json'
const sample = JSON.parse(readFileSync('docs/evidence/amazon-public-r0-success-controls-2026-09-24.json'))
const cohorts = {
  fixed: '2026-09-24T12-17-04-782Z',
  unseen: '2026-09-24T12-40-09-956Z',
}
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

function visibleText(node) {
  if (!node) return ''
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return ''
  return [...node.childNodes].map(visibleText).join(' ').replace(/\s+/g, ' ').trim()
}

function observe(record, document) {
  const selected = document.querySelector('input[name="ASIN"], #ASIN')?.getAttribute('value')?.trim().toUpperCase() ?? null
  const buybox = visibleText(document.querySelector('#buybox'))
  const availability = visibleText(document.querySelector('#availability'))
  const subjectPrice = ['#corePrice_feature_div .a-price .a-offscreen', '#apex_desktop .a-price .a-offscreen', '#buybox .a-price .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice']
    .map(selector => ({ selector, value: visibleText(document.querySelector(selector)) }))
    .find(item => item.value && /\d/.test(item.value)) ?? null
  const location = visibleText(document.querySelector('#glow-ingress-line2')) || buybox
  const regionVisible = /\bSingapore\s*238823\b/i.test(location)
  let classification, observation, evidenceSelectors
  if (selected !== record.asin) {
    classification = 'selected_subject_mismatch'
    observation = 'The captured selected ASIN differs from the requested ASIN; substitute product data was withheld.'
    evidenceSelectors = ['input[name="ASIN"], #ASIN']
  } else if (/Currently unavailable/i.test(availability) || /Currently unavailable/i.test(buybox)) {
    classification = 'unavailable_in_captured_context'
    observation = 'The selected product buy box says Currently unavailable; no selected quote was verified in this capture.'
    evidenceSelectors = ['#availability', '#buybox']
  } else if (/See All Buying Options/i.test(buybox) && !subjectPrice) {
    classification = 'purchase_options_only_in_capture'
    observation = 'The selected product buy box offers See All Buying Options but contains no selected quote in this capture; unopened options were not assessed.'
    evidenceSelectors = ['#buybox']
  } else if (record.outcome.status === 'success' && subjectPrice) {
    classification = 'complete_control_subject_quote_visible'
    observation = 'A selected-subject quote is visible in the captured page; this is a preselected success control, not independent field sign-off.'
    evidenceSelectors = ['input[name="ASIN"], #ASIN', subjectPrice.selector]
  } else {
    classification = 'unresolved_capture_observation'
    observation = 'The captured buy box does not establish why the required selected quote was not verified.'
    evidenceSelectors = ['#buybox', '#availability']
  }
  return { selected, subjectPrice, regionVisible, classification, observation, evidenceSelectors }
}

const ledger = { version: 1, sourceCommit: sample.sourceCommit, sourceEvidence: 'Private .w2l/public-preview/final-100 directories in the w2l-public-preview worktree', reviewStatus: 'machine_assisted_pending_independent_review', historicalRedirectChain: 'not_recorded', historicalScreenshot: 'not_recorded', cohorts: {}, failures: [], successControls: [] }
for (const [cohort, runId] of Object.entries(cohorts)) {
  const reportPath = join(root, 'final-100', runId, 'report.json')
  const reportBuffer = readFileSync(reportPath)
  const report = JSON.parse(reportBuffer)
  const audit = JSON.parse(readFileSync(`docs/evidence/amazon-public-${cohort}-100-audit-2026-09-24.json`))
  if (sha256(reportBuffer) !== audit.sourceReportSha256 || report.records.length !== 100 || report.source.commit !== sample.sourceCommit) throw new Error(`${cohort}: source report mismatch`)
  const manifestPath = cohort === 'fixed' ? 'research/amazon-product-holdout-100-sg.v1.json' : 'docs/evidence/amazon-public-unseen-100-manifest-2026-09-24.json'
  const manifestBuffer = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBuffer)
  if (sha256(manifestBuffer) !== audit.manifestSha256 || manifest.urls.length !== 100 ||
    manifest.urls.some((url, index) => url !== report.records[index]?.url)) throw new Error(`${cohort}: frozen URL manifest mismatch`)
  const expectedControlIndices = audit.records.filter(item => item.status === 'success')
    .map(item => ({ index: item.index, sortKey: sha256(Buffer.from(`r0-success-v1:${cohort}:${item.index}:${item.requestedAsin}`)) }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey)).slice(0, 10).map(item => item.index)
  const controls = new Map(sample.cohorts[cohort].map(item => [item.index, item]))
  if (controls.size !== 10 || expectedControlIndices.some((index, position) => sample.cohorts[cohort][position]?.index !== index)
    || [...controls.values()].some(item => audit.records[item.index - 1]?.status !== 'success')) throw new Error(`${cohort}: control sample changed`)
  let verified = 0
  for (const record of report.records) {
    const expected = audit.records[record.index - 1]
    const rawPath = join(root, 'final-100', runId, 'raw', basename(record.snapshot.artifacts[0]))
    const raw = readFileSync(rawPath)
    const hash = sha256(raw)
    if (hash !== record.snapshot.rawBodySha256 || hash !== expected.sameCaptureHtmlSha256 || record.asin !== expected.requestedAsin) throw new Error(`${cohort}/${record.index}: raw witness mismatch`)
    verified++
    if (record.outcome.status === 'success' && !controls.has(record.index)) continue
    const document = parseHTML(raw.toString('utf8')).document
    const observation = observe(record, document)
    if (observation.selected !== expected.selectedAsin) throw new Error(`${cohort}/${record.index}: selected subject mismatch with frozen audit`)
    const entry = {
      cohort, index: record.index, requestedAsin: record.asin, selectedAsin: observation.selected,
      capturedAt: record.capturedAt, deployedSourceCommit: report.source.commit,
      finalUrl: record.finalUrl, redirectChain: 'not_recorded', screenshot: 'not_recorded',
      resultStatus: record.outcome.status, jsonStatus: record.structured.status,
      region: { rawSingapore238823Visible: observation.regionVisible, outputVerified: expected.regionVerified },
      currency: { selectedQuoteExplicitSgdVisible: !!observation.subjectPrice && /S\$|SGD/i.test(observation.subjectPrice.value), outputVerified: expected.currencyVerified },
      selectedQuote: { visible: !!observation.subjectPrice, belongsToRequestedAsin: observation.selected === record.asin && !!observation.subjectPrice, selector: observation.subjectPrice?.selector ?? null },
      classification: observation.classification, observation: observation.observation,
      causeCertainty: observation.classification === 'selected_subject_mismatch' ? 'observed_subject_mismatch' : 'capture_observation_only',
      timingsMs: { client: record.clientMs, server: record.serverTotalMs, browser: record.usage.browserMs, retryWait: record.usage.retryWaitMs },
      witness: { htmlSha256: hash, privateRelativePath: `final-100/${runId}/raw/${basename(rawPath)}`, selectors: observation.evidenceSelectors },
      reviewStatus: 'machine_assisted_pending_independent_review',
    }
    if (record.outcome.status === 'success') {
      if (controls.get(record.index).rawSha256 !== hash) throw new Error(`${cohort}/${record.index}: control hash mismatch`)
      ledger.successControls.push(entry)
    } else ledger.failures.push(entry)
  }
  ledger.cohorts[cohort] = { runId, reportSha256: audit.sourceReportSha256, attempted: 100, rawHashesVerified: verified, success: report.summary.requestSuccesses, incomplete: report.records.filter(item => item.outcome.status !== 'success').length }
}
if (ledger.failures.length !== 29 || ledger.successControls.length !== 20 || ledger.failures.some(item => item.classification === 'complete_control_subject_quote_visible')) throw new Error('R0 cohort counts or classification changed')
writeFileSync(output, JSON.stringify(ledger, null, 2) + '\n')
const failureClasses = ledger.failures.reduce((counts, item) => { counts[item.classification] = (counts[item.classification] ?? 0) + 1; return counts }, {})
console.log(JSON.stringify({ output, counts: ledger.cohorts, failureClasses, controlsNeedingReview: ledger.successControls.filter(item => item.classification !== 'complete_control_subject_quote_visible').map(item => `${item.cohort}/${item.index}`) }, null, 2))
