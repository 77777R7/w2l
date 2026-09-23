import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const manifest = JSON.parse(await readFile('research/amazon-product-baseline.v1.json', 'utf8'))
const postcode = manifest.expectedPostalCode
if (!/^\d{6}$/.test(postcode) || manifest.expectedRegion !== 'Singapore') {
  throw new Error('baseline manifest must specify an explicit Singapore postal code')
}
const output = '.w2l/amazon-baseline/anonymous-public-state.json'
const browser = await chromium.launch({ headless: true })
try {
  // A new context guarantees these are public site preferences, not copied
  // account cookies. The state is never used by ordinary standard requests.
  const context = await browser.newContext({ locale: manifest.language })
  const page = await context.newPage()
  const asin = manifest.urls[0]?.match(/\/dp\/([A-Z0-9]{10})/i)?.[1]
  if (!asin) throw new Error('the fixed first URL has no ASIN')
  await page.goto(`https://www.amazon.sg/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  if (!/\.amazon\.sg$/i.test(new URL(page.url()).hostname)) throw new Error('expected public Singapore marketplace')
  await page.locator('#nav-global-location-popover-link').click()
  await page.locator('#GLUXZipUpdateInput').fill(postcode)
  await page.locator('#GLUXZipUpdate').click()
  await page.waitForTimeout(3_000)
  if (await page.locator('#GLUXZipError').isVisible() || await page.locator('#GLUXZipServerError').isVisible()) {
    throw new Error('Amazon did not accept the public Singapore postcode')
  }
  if (await page.locator('#GLUXConfirmClose').isVisible()) await page.locator('#GLUXConfirmClose').click()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 25_000 })
  const location = (await page.locator('#glow-ingress-line2').innerText()).trim()
  if (!location.includes(`Singapore ${postcode}`)) throw new Error(`delivery location was not retained: ${location}`)
  const state = await context.storageState()
  const cookies = state.cookies.filter(cookie => /(^|\.)amazon\.(com|sg)$/i.test(cookie.domain))
  if (!cookies.some(cookie => cookie.name === 'i18n-prefs' && cookie.value === 'SGD')) {
    throw new Error('public SGD currency preference was not retained')
  }
  const serialized = JSON.stringify({ cookies, origins: state.origins.filter(origin => /(^|\.)amazon\.(com|sg)$/i.test(new URL(origin.origin).hostname)) })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, serialized, { mode: 0o600 })
  await chmod(output, 0o600)
  console.log(JSON.stringify({
    statePath: output,
    stateSha256: createHash('sha256').update(serialized).digest('hex'),
    deliveryLocation: `Singapore ${postcode}`,
    currency: 'SGD',
    cookieCount: cookies.length,
    accountSignIn: false,
  }))
} finally {
  await browser.close()
}
