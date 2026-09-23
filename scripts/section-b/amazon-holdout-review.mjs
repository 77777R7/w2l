// Score a frozen Amazon holdout against the same-capture raw HTML, without
// reusing the production product extractor. This is a review aid, not a human
// sign-off or permission to replace a failed URL in the frozen cohort.
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'

const reportFlag = process.argv.indexOf('--report')
const reportPath = reportFlag < 0 ? '.w2l/amazon-baseline/latest.json' : process.argv[reportFlag + 1]
if (!reportPath) throw new Error('--report requires a JSON path')
const report = JSON.parse(await readFile(reportPath, 'utf8'))
if (!report.source?.manifest?.includes('holdout-100') || report.records?.length !== 100) {
  throw new Error('expected exactly 100 frozen holdout captures')
}
const outputRoot = report.source.manifest.includes('-sg.') ? '.w2l/amazon-holdout-sg' : '.w2l/amazon-holdout'
const fields = ['asin', 'title', 'price', 'currency', 'seller']
function clean(value) {
  return typeof value === 'string' ? value.replace(/[\u200c-\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim() || null : value ?? null
}
function firstText(doc, selectors) {
  for (const selector of selectors) for (const element of doc.querySelectorAll(selector)) {
    const value = clean(element.textContent)
    if (value) return { value, selector }
  }
  return null
}
function priceWitness(doc) {
  const hit = firstText(doc, [
    '#corePrice_feature_div .a-price .a-offscreen',
    '#apex_desktop .a-price .a-offscreen',
    '#buybox .a-price .a-offscreen',
    '#rightCol .priceToPay .a-offscreen',
    '.apexPriceToPay .a-offscreen',
    '.priceToPay .a-offscreen',
    '#priceblock_ourprice', '#priceblock_dealprice',
  ])
  if (!hit) return null
  const amount = Number(hit.value.replace(/\b(?:SGD|USD|EUR|GBP|CAD|AUD)\b/gi, '').replace(/(?:S|US|C|A)?\$/g, '').replace(/[₹€£,\s]/g, ''))
  if (!Number.isFinite(amount)) return null
  const currency = /\bSGD\b|S\$/i.test(hit.value) ? 'SGD'
    : /\bUSD\b|US\$/i.test(hit.value) ? 'USD'
      : /\bEUR\b|€/i.test(hit.value) ? 'EUR'
        : /\bGBP\b|£/i.test(hit.value) ? 'GBP'
          : /\bCAD\b|C\$/i.test(hit.value) ? 'CAD'
            : /\bAUD\b|A\$/i.test(hit.value) ? 'AUD' : null
  return { ...hit, amount, currency }
}
function equal(field, output, witness) {
  if (field === 'price') return Number.isFinite(output) && Math.abs(output - witness) < 0.005
  return clean(output) === clean(witness)
}
function recommendationIds(doc) {
  const ids = new Set()
  const images = new Set()
  let regions = 0
  for (const region of doc.querySelectorAll('[id^="sims-"], [id*="sims-container"], [id*="similarities"], [id*="sponsored"], [id*="recommend"], #sp_detail')) {
    regions++
    for (const link of region.querySelectorAll('a[href]')) {
      const id = link.getAttribute('href')?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]
      if (id) ids.add(id.toUpperCase())
    }
    for (const image of region.querySelectorAll('img[src]')) images.add(image.getAttribute('src'))
  }
  return { ids, images, regions }
}

const rows = []
for (const capture of report.records) {
  const artifact = capture.snapshot?.artifacts?.[0]
  if (!artifact) throw new Error(`capture ${capture.index} has no raw artifact`)
  const raw = await readFile(artifact)
  const hash = createHash('sha256').update(raw).digest('hex')
  if (hash !== capture.snapshot.rawBodySha256) throw new Error(`capture ${capture.index} raw hash mismatch`)
  const doc = parseHTML(raw.toString()).document
  const selectedAsin = clean(doc.querySelector('input[name="ASIN"], #ASIN')?.getAttribute('value'))?.toUpperCase() ?? null
  const title = firstText(doc, ['#productTitle', '#title'])
  const price = priceWitness(doc)
  const seller = firstText(doc, ['#sellerProfileTriggerId', '#merchant-info', '.tabular-buybox-text[tabular-attribute-name="Sold by"]', '#merchantInfoFeature_feature_div .offer-display-feature-text-message'])
  const region = firstText(doc, ['#glow-ingress-line2', '#contextualIngressPtLabel_deliveryShortLine'])
  const witness = { asin: selectedAsin, title: title?.value ?? null, price: price?.amount ?? null, currency: price?.currency ?? null, seller: seller?.value ?? null }
  const output = capture.structured?.data ?? {}
  const checks = Object.fromEntries(fields.map(field => [field, {
    visible: witness[field] !== null,
    emitted: output[field] !== null && output[field] !== undefined,
    match: witness[field] !== null && output[field] !== null && output[field] !== undefined ? equal(field, output[field], witness[field]) : null,
  }]))
  const recommended = recommendationIds(doc)
  const serialized = JSON.stringify(output)
  const recommendationAsinLeaks = [...recommended.ids].filter(id => id !== selectedAsin && serialized.includes(id))
  const recommendationImageLeaks = [...recommended.images].filter(url => url && (output.images ?? []).includes(url))
  const subjectOfferAmounts = new Set()
  for (const selector of [
    '#corePrice_feature_div .a-price .a-offscreen', '#apex_desktop .a-price .a-offscreen',
    '#buybox .a-price .a-offscreen', '#rightCol .priceToPay .a-offscreen',
    '.apexPriceToPay .a-offscreen', '.priceToPay .a-offscreen',
    '#priceblock_ourprice', '#priceblock_dealprice', '#aod-offer-list .a-price .a-offscreen',
  ]) for (const element of doc.querySelectorAll(selector)) {
    const amount = Number((element.textContent ?? '').replace(/[^0-9.]/g, ''))
    if (Number.isFinite(amount) && amount > 0) subjectOfferAmounts.add(amount)
  }
  const unwitnessedPriceOffers = (output.prices ?? []).filter(offer => !subjectOfferAmounts.has(offer.amount))
  const subjectImages = new Set()
  for (const element of doc.querySelectorAll('#landingImage, #imgTagWrapperId img, #main-image-container img')) {
    for (const name of ['data-old-hires', 'src']) {
      const url = element.getAttribute(name)
      if (url) subjectImages.add(url)
    }
  }
  const unwitnessedImages = (output.images ?? []).filter(url => !subjectImages.has(url))
  rows.push({
    index: capture.index, requestedAsin: capture.asin, selectedAsin, finalUrl: capture.finalUrl,
    status: capture.outcome?.status, structuredStatus: capture.structured?.status,
    issues: capture.structured?.issues ?? [], capturedAt: capture.snapshot?.capturedAt,
    rawBodySha256: hash, artifact, witness,
    witnessPaths: { asin: 'input[name="ASIN"]', title: title?.selector ?? null, price: price?.selector ?? null, currency: price?.selector ?? null, seller: seller?.selector ?? null, region: region?.selector ?? null },
    rawPriceText: price?.value ?? null, rawRegionText: region?.value ?? null,
    output: Object.fromEntries(fields.map(field => [field, output[field] ?? null])),
    outputRegion: output.deliveryLocation ?? null, checks,
    requestedMatchesSelected: capture.asin === selectedAsin,
    regionSingapore: /\bSingapore\b/i.test(region?.value ?? ''),
    postcodeVisible: /\b238823\b/.test(region?.value ?? ''),
    recommendationAsinLeaks, recommendationImageLeaks,
    recommendationRegions: recommended.regions,
    recommendationAsinCandidates: recommended.ids.size,
    outputPriceOffers: output.prices?.length ?? 0, unwitnessedPriceOffers,
    outputImages: output.images?.length ?? 0, unwitnessedImages,
  })
}

const scores = Object.fromEntries(fields.map(field => {
  const visible = rows.filter(row => row.checks[field].visible)
  const emitted = rows.filter(row => row.checks[field].emitted)
  const matched = emitted.filter(row => row.checks[field].match === true)
  const unverifiedEmitted = emitted.filter(row => row.checks[field].match === null)
  return [field, {
    visibleApplicable: visible.length,
    emitted: emitted.length,
    matched: matched.length,
    accuracy: unverifiedEmitted.length === 0 && emitted.length > 0 ? matched.length / emitted.length : null,
    visibleCoverage: visible.length > 0 ? matched.length / visible.length : null,
    unverifiedEmitted: unverifiedEmitted.map(row => row.index),
    mismatch: emitted.filter(row => row.checks[field].match === false).map(row => row.index),
    missingVisible: visible.filter(row => !row.checks[field].emitted).map(row => row.index),
  }]
}))
const score = {
  testKind: 'amazon-holdout-raw-html-witness-review',
  capturedReport: reportPath,
  source: report.source,
  records: rows.length,
  rawHashesVerified: rows.length,
  requestSuccesses: rows.filter(row => row.status === 'success').length,
  structuredComplete: rows.filter(row => row.structuredStatus === 'complete').length,
  requestedMatchesSelected: rows.filter(row => row.requestedMatchesSelected).length,
  selectedSubjectWronglyEmitted: rows.filter(row => row.checks.asin.emitted && row.checks.asin.match === false).length,
  regionSingaporeVisible: rows.filter(row => row.regionSingapore).length,
  postcodeVisible: rows.filter(row => row.postcodeVisible).length,
  recommendationAsinLeakRows: rows.filter(row => row.recommendationAsinLeaks.length).map(row => row.index),
  recommendationImageLeakRows: rows.filter(row => row.recommendationImageLeaks.length).map(row => row.index),
  recommendationRegionPages: rows.filter(row => row.recommendationRegions > 0).length,
  recommendationAsinCandidatePages: rows.filter(row => row.recommendationAsinCandidates > 0).length,
  priceOffersSubjectWitnessed: rows.reduce((sum, row) => sum + row.outputPriceOffers - row.unwitnessedPriceOffers.length, 0),
  priceOffersEmitted: rows.reduce((sum, row) => sum + row.outputPriceOffers, 0),
  imagesSubjectWitnessed: rows.reduce((sum, row) => sum + row.outputImages - row.unwitnessedImages.length, 0),
  imagesEmitted: rows.reduce((sum, row) => sum + row.outputImages, 0),
  unwitnessedPriceOfferRows: rows.filter(row => row.unwitnessedPriceOffers.length).map(row => row.index),
  unwitnessedImageRows: rows.filter(row => row.unwitnessedImages.length).map(row => row.index),
  fields: scores,
  humanReviewPending: true,
  strictSubjectGatePassed: rows.every(row => row.requestedMatchesSelected && row.structuredStatus === 'complete'),
  rows,
}
await mkdir(outputRoot, { recursive: true })
const jsonPath = `${outputRoot}/field-review.json`
const markdownPath = `${outputRoot}/field-review.md`
await writeFile(jsonPath, JSON.stringify(score, null, 2))
const header = '# Amazon 100-product raw-HTML review\n\nThis packet is machine-assisted and **not a human sign-off**. Every row binds the captured raw HTML hash, visible witness, and emitted JSON. Keep failed and incomplete rows in the denominator.\n\n'
const summary = `- Captured source: ${report.source.commit} (dirty: ${report.source.dirty})\n- Manifest/schema/state SHA256: ${report.source.manifestSha256} / ${report.source.schemaSha256} / ${report.source.anonymousStateSha256}\n- Requests: ${score.requestSuccesses}/100; structured complete: ${score.structuredComplete}/100; requested ASIN equals selected page ASIN: ${score.requestedMatchesSelected}/100\n- Raw hashes verified: ${score.rawHashesVerified}/100; Singapore visible: ${score.regionSingaporeVisible}/100; postcode visible: ${score.postcodeVisible}/100\n- Recognized recommendation regions/foreign ASIN candidates: ${score.recommendationRegionPages}/${score.recommendationAsinCandidatePages} pages; ASIN/image leak candidates: ${score.recommendationAsinLeakRows.length}/${score.recommendationImageLeakRows.length}\n- Emitted offer prices witnessed in subject buy box or offer list: ${score.priceOffersSubjectWitnessed}/${score.priceOffersEmitted}; images witnessed in subject gallery: ${score.imagesSubjectWitnessed}/${score.imagesEmitted}\n\n`
const table = '| # | Requested | Selected | JSON | ASIN | Title | Price | Currency | Seller | Region | Raw HTML |\n|---:|---|---|---|---|---|---|---|---|---|---|\n'
  + rows.map(row => `| ${row.index} | ${row.requestedAsin} | ${row.selectedAsin ?? '—'} | ${row.structuredStatus ?? '—'} | ${row.checks.asin.match === true ? '✓' : '—'} | ${row.checks.title.match === true ? '✓' : row.checks.title.visible ? '—' : 'n/a'} | ${row.checks.price.match === true ? '✓' : row.checks.price.visible ? '—' : 'n/a'} | ${row.checks.currency.match === true ? '✓' : row.checks.currency.visible ? '—' : 'n/a'} | ${row.checks.seller.match === true ? '✓' : row.checks.seller.visible ? '—' : 'n/a'} | ${row.regionSingapore ? 'SG' : '—'} | [HTML](${resolve(row.artifact)}) |`).join('\n') + '\n'
await writeFile(markdownPath, header + summary + table)
console.log(JSON.stringify({ jsonPath, markdownPath, summary: { requests: score.requestSuccesses, structuredComplete: score.structuredComplete, requestedMatchesSelected: score.requestedMatchesSelected, regionSingaporeVisible: score.regionSingaporeVisible, postcodeVisible: score.postcodeVisible, recommendationRegionPages: score.recommendationRegionPages, recommendationAsinCandidatePages: score.recommendationAsinCandidatePages, recommendationAsinLeakRows: score.recommendationAsinLeakRows, recommendationImageLeakRows: score.recommendationImageLeakRows, priceOffersSubjectWitnessed: score.priceOffersSubjectWitnessed, priceOffersEmitted: score.priceOffersEmitted, imagesSubjectWitnessed: score.imagesSubjectWitnessed, imagesEmitted: score.imagesEmitted, fields: score.fields, strictSubjectGatePassed: score.strictSubjectGatePassed, humanReviewPending: true } }, null, 2))
