import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asinFromProductUrl, asinsInText, buildExclusionLedger, isListingUrl, selectUnseenHundred } from './unseen-cohort.mjs'

test('listing-only discovery accepts Amazon.sg category sources, never detail-page sources', () => {
  assert.equal(isListingUrl('https://www.amazon.sg/gp/bestsellers/electronics'), true)
  assert.equal(isListingUrl('https://www.amazon.sg/dp/B000000001'), false)
  assert.equal(isListingUrl('https://evil.example/gp/bestsellers/electronics'), false)
  assert.equal(asinFromProductUrl('https://www.amazon.sg/dp/B000000001?ref=abc'), 'B000000001')
  assert.equal(asinFromProductUrl('https://www.amazon.sg/Example-Product/dp/B000000002/ref=zg_bs'), 'B000000002')
  assert.equal(asinFromProductUrl('https://www.amazon.com/dp/B000000001'), null)
  assert.deepEqual([...asinsInText('background B000000001')], ['B000000001'])
})

test('exclusion ledger includes tracked manifests, review notes, ignored reports, and archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'w2l-unseen-ledger-'))
  const archive = await mkdtemp(join(tmpdir(), 'w2l-unseen-archive-'))
  try {
    await mkdir(join(root, 'research'))
    await mkdir(join(root, 'docs/evidence'), { recursive: true })
    await mkdir(join(root, '.w2l/old-run'), { recursive: true })
    await writeFile(join(root, 'research/manifest.json'), JSON.stringify({ urls: ['https://www.amazon.sg/dp/B000000001'] }))
    await writeFile(join(root, 'docs/evidence/review.md'), 'Previously reviewed ASIN B000000002.')
    await writeFile(join(root, '.w2l/old-run/report.json'), JSON.stringify({ requestedAsin: 'B000000003' }))
    await writeFile(join(archive, 'historical.json'), JSON.stringify({ asin: 'B000000004' }))
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['add', 'research/manifest.json', 'docs/evidence/review.md'], { cwd: root })
    const ledger = await buildExclusionLedger(root, [archive])
    assert.deepEqual(ledger.excludedAsins, ['B000000001', 'B000000002', 'B000000003', 'B000000004'])
    assert.equal(ledger.sources.length, 4)
    assert.equal(ledger.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)), true)
    assert.equal((await readFile(join(root, 'research/manifest.json'), 'utf8')).includes('B000000001'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(archive, { recursive: true, force: true })
  }
})

test('round-robin freezes exactly 100 distinct unseen listing links without substitution', () => {
  const ids = Array.from({ length: 150 }, (_, i) => `B${String(i).padStart(9, '0')}`)
  const rows = [
    { seed: 'https://www.amazon.sg/gp/bestsellers/a', status: 'success', links: ids.slice(0, 75).map(id => `https://www.amazon.sg/dp/${id}`) },
    { seed: 'https://www.amazon.sg/gp/bestsellers/b', status: 'success', links: ids.slice(50).map(id => `https://www.amazon.sg/dp/${id}`) },
    { seed: 'https://www.amazon.sg/gp/bestsellers/c', status: 'blocked', links: [`https://www.amazon.sg/dp/B999999999`] },
  ]
  const selected = selectUnseenHundred(rows, ids.slice(0, 10))
  assert.equal(selected.length, 100)
  assert.equal(new Set(selected.map(item => item.asin)).size, 100)
  assert.equal(selected.some(item => ids.slice(0, 10).includes(item.asin)), false)
  assert.equal(selected.some(item => item.asin === 'B999999999'), false)
  assert.equal(selected.every(item => item.url === `https://www.amazon.sg/dp/${item.asin}`), true)
})
