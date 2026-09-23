import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseHTML } from 'linkedom'

const FIELDS = ['asin', 'title', 'kind', 'brand', 'price', 'currency', 'seller', 'availability',
  'deliveryLocation', 'rating', 'reviewCount', 'images', 'prices', 'variants', 'specifications']
const SCORED_FIELDS = ['asin', 'title', 'price', 'currency', 'seller']
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

// These are raw-page witnesses for a reviewer, never labels or assertions of
// correctness. They do not read the adapter output or its evidence map.
function rawWitness(doc, name) {
  if (name === 'title') {
    const plan = [...doc.querySelectorAll('[data-cy="twister-plus-label-container"]')]
      .find(node => /^Plan:\s*Blink\b/i.test(node.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
    if (plan) return { location: '[data-cy="twister-plus-label-container"]:Plan', rawValue: plan.textContent.replace(/\s+/g, ' ').trim() }
  }
  if (name === 'asin') {
    const bodyAsin = doc.querySelector('input#ASIN')?.getAttribute('value')
    if (bodyAsin) return { location: 'input#ASIN', rawValue: bodyAsin }
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
    const value = canonical?.match(/\/dp\/([A-Z0-9]{10})/i)?.[1]
    if (value) return { location: 'link[rel="canonical"] (requires subject corroboration)', rawValue: value }
  }
  if (name === 'price' || name === 'currency') {
    const selected = doc.querySelector('[data-cy="subs-buy-box-container"], #subs-buy-box-container')
    const value = selected?.textContent?.replace(/\s+/g, ' ').match(/[$€£]\s*\d[\d,]*(?:\.\d{1,2})?/)?.[0]
    if (value) return { location: '[data-cy="subs-buy-box-container"]', rawValue: value }
  }
  const selectors = {
    asin: ['input#ASIN'],
    title: ['#productTitle', 'h1#title', '#device-subs-buy-box [data-cy="twister-plus-label-text"]', 'title'],
    brand: ['#bylineInfo'],
    price: ['#corePrice_feature_div .apex-pricetopay-value .a-offscreen', '#corePrice_feature_div .a-price .a-offscreen', '#subscriptionPrice', '#subs-buy-box-container .sc-iXGltN'],
    currency: ['#corePrice_feature_div .apex-pricetopay-value .a-offscreen', '#corePrice_feature_div .a-price .a-offscreen', '#subscriptionPrice', '#subs-buy-box-container .sc-iXGltN'],
    seller: ['#sellerProfileTriggerId', '#merchantInfoFeature_feature_div .offer-display-feature-text-message', '#merchant-info', '[data-cy="sold-by-value"]'],
    availability: ['#availability span', '#availability', '#outOfStock'],
    deliveryLocation: ['#glow-ingress-line2', '#contextualIngressPtLabel_deliveryShortLine'],
    rating: ['#acrPopover'],
    reviewCount: ['#acrCustomerReviewText'],
    images: ['#landingImage', 'meta[property="og:image"]'],
  }[name] ?? []
  for (const selector of selectors) {
    const node = doc.querySelector(selector)
    if (!node) continue
    const copy = node.cloneNode(true)
    for (const noise of copy.querySelectorAll?.('script,style,noscript,template') ?? []) noise.remove()
    const value = (name === 'asin' ? node.getAttribute('value')
      : name === 'images' ? node.getAttribute('data-old-hires') ?? node.getAttribute('src') ?? node.getAttribute('content')
        : name === 'rating' ? node.getAttribute('title') ?? copy.textContent
          : copy.textContent)?.replace(/\s+/g, ' ').trim()
    if (value) return { location: selector, rawValue: value.slice(0, 500) }
  }
  if (['title', 'price', 'currency', 'seller'].includes(name)) {
    const body = doc.body?.cloneNode(true)
    for (const noise of body?.querySelectorAll?.('script,style,noscript,template') ?? []) noise.remove()
    const visibleText = body?.textContent?.replace(/\s+/g, ' ') ?? ''
    const pattern = name === 'title' ? /\bPlan:\s*Blink\s+(?:AI\s+)?(?:basic|plus)\b/i
      : name === 'seller' ? /\bSold\s+by\s*Blink\b/i
        : /\bBilling:\s*(?:Monthly|Annual)[^$]{0,100}\$\s*\d+(?:\.\d{2})?/i
    const match = visibleText.match(pattern)
    if (match) return { location: 'body:visible subscription text', rawValue: match[0] }
  }
  return null
}

function present(value) {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 140)
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
          rawHtmlWitness: rawWitness(document, name),
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
    scoredFields: SCORED_FIELDS,
    expectedEntries: report.records?.length ?? 0,
    entries, signoff: { reviewer: null, signedAt: null },
  }
  const markdownPath = /\.json$/i.test(outputPath) ? outputPath.replace(/\.json$/i, '.md') : `${outputPath}.md`
  const markdown = [
    '# Amazon field review — unsigned',
    '',
    `- Source: ${review.source.commit}; capture: ${review.baselineStartedAt} to ${review.baselineEndedAt}`,
    `- Schema / manifest / anonymous-state SHA256: ${review.schemaSha256} / ${review.manifestSha256} / ${review.source.anonymousStateSha256}`,
    `- Scored fields: ${SCORED_FIELDS.join(', ')}. Output accuracy and visible-field coverage are separate denominators.`,
    '- HTML witnesses below are review aids, not verified truth. Inspect each linked raw page and JSON evidence path, fill the five humanTruth labels and recommendationLeak check for every capture, then sign the JSON as Howard.',
    '',
  ]
  for (const asin of [...new Set(entries.map(entry => entry.asin))]) {
    markdown.push(`## ${asin}`, '', '| Round | Captured (UTC) | Raw HTML | Title output | Price / currency output | Seller output | Raw price witness | Raw seller witness |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const entry of entries.filter(item => item.asin === asin).sort((a, b) => a.round - b.round)) {
      const field = entry.fields
      const rawLink = `[${entry.rawBodySha256.slice(0, 12)}](raw/${basename(entry.rawPath)})`
      markdown.push(`| ${entry.round} | ${cell(entry.capturedAt)} | ${rawLink} | ${cell(field.title.output)} | ${cell(field.price.output)} / ${cell(field.currency.output)} | ${cell(field.seller.output)} | ${cell(field.price.rawHtmlWitness?.rawValue)} | ${cell(field.seller.rawHtmlWitness?.rawValue)} |`)
    }
    markdown.push('')
  }
  await Promise.all([writeFile(outputPath, JSON.stringify(review, null, 2)), writeFile(markdownPath, markdown.join('\n'))])
  console.log(JSON.stringify({ outputPath, markdownPath, entryCount: entries.length, signed: false }))
} else {
  const review = JSON.parse(await readFile(inputPath, 'utf8'))
  if (review.signoff?.reviewer !== 'Howard' || !Number.isFinite(Date.parse(review.signoff?.signedAt ?? ''))) {
    throw new Error('Howard signoff and a valid signedAt timestamp are required')
  }
  let visibleApplicable = 0; let visibleApplicableOutput = 0
  let emitted = 0; let correctEmitted = 0
  const findings = []
  const fatalFindings = []
  for (const entry of review.entries ?? []) {
    if (entry.recommendationLeak?.checked !== true || entry.recommendationLeak?.found !== false) {
      const finding = { asin: entry.asin, issue: 'recommendation_leak_unreviewed_or_found' }
      findings.push(finding); fatalFindings.push(finding)
    }
    for (const name of SCORED_FIELDS) {
      const field = entry.fields?.[name]
      const truth = field?.humanTruth
      if (typeof truth?.applicable !== 'boolean' || typeof truth.visible !== 'boolean'
        || (truth.visible && truth.applicable && !truth.location)) {
        const finding = { asin: entry.asin, field: name, issue: 'truth_incomplete' }
        findings.push(finding); fatalFindings.push(finding)
        continue
      }
      const outputPresent = present(field.output)
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
    if (entry.fields?.asin?.output !== entry.asin) {
      const finding = { asin: entry.asin, issue: 'subject_asin_mismatch' }
      findings.push(finding); fatalFindings.push(finding)
    }
  }
  const accuracy = emitted > 0 ? correctEmitted / emitted : 0
  const coverage = visibleApplicable > 0 ? visibleApplicableOutput / visibleApplicable : 0
  const score = { source: review.source, reviewer: review.signoff,
    scoredFields: SCORED_FIELDS,
    accuracy: { correct: correctEmitted, emitted, rate: accuracy },
    coverage: { output: visibleApplicableOutput, visibleApplicable, rate: coverage },
    findings,
    passed: fatalFindings.length === 0 && accuracy >= 0.98 && coverage >= 0.98
      && review.expectedEntries === 30 && (review.entries?.length ?? 0) === review.expectedEntries,
  }
  await writeFile(outputPath, JSON.stringify(score, null, 2))
  console.log(JSON.stringify({ outputPath, passed: score.passed, accuracy, coverage, findings: findings.length }))
  if (!score.passed) process.exitCode = 1
}
