import { chromium } from 'playwright'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { validateAmazonPublicState } from '../../packages/mcp/dist/amazonState.js'

const file = process.env.W2L_AMAZON_PUBLIC_STATE_FILE
if (!file) throw new Error('W2L_AMAZON_PUBLIC_STATE_FILE is required')
const freshOnly = process.argv.includes('--fresh-only')
try {
  const existing = await readFile(file, 'utf8')
  if (freshOnly) throw new Error('public bootstrap requires a new state file; refusing to reuse an existing browser state')
  console.log(JSON.stringify({state:'reused',sha256:validateAmazonPublicState(existing)}))
  process.exit(0)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

// Fresh, unsigned-in browser: only public shipping/currency preferences are
// saved. This bootstrap never opens a customer account or imports local state.
const browser = await chromium.launch({headless:true})
try {
  const context = await browser.newContext({locale:'en-US'})
  const page = await context.newPage()
  await page.goto('https://www.amazon.sg/dp/B000VW9PIK', {waitUntil:'domcontentloaded',timeout:30_000})
  if (new URL(page.url()).hostname !== 'www.amazon.sg') throw new Error('Amazon.sg product page was not reached')
  await page.locator('#nav-global-location-popover-link').click({timeout:10_000})
  await page.locator('#GLUXZipUpdateInput').fill('238823',{timeout:10_000})
  await page.locator('#GLUXZipUpdate').click({timeout:10_000})
  await page.waitForTimeout(3_000)
  if (await page.locator('#GLUXZipError').isVisible() || await page.locator('#GLUXZipServerError').isVisible()) {
    throw new Error('Amazon.sg did not accept Singapore 238823')
  }
  if (await page.locator('#GLUXConfirmClose').isVisible()) await page.locator('#GLUXConfirmClose').click()
  await page.reload({waitUntil:'domcontentloaded',timeout:30_000})
  const location = (await page.locator('#glow-ingress-line2').innerText()).trim()
  if (!location.includes('Singapore 238823')) throw new Error('Singapore delivery context was not retained')
  const state = await context.storageState()
  const cookies = state.cookies.filter(cookie => /(^|\.)amazon\.sg$/i.test(cookie.domain))
  // Delivery and currency survive in the anonymous cookies. Amazon's local
  // storage contains large transient telemetry and is not needed for either
  // preference; omit it so the state fits in one Secret Manager version.
  const serialized = JSON.stringify({cookies,origins:[]})
  const sha256 = validateAmazonPublicState(serialized)
  await mkdir(dirname(file),{recursive:true})
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary,serialized,{mode:0o600,flag:'wx'})
  await chmod(temporary,0o600)
  await rename(temporary,file)
  console.log(JSON.stringify({state:'created',sha256,cookieCount:cookies.length,location:'Singapore 238823',currency:'SGD',signedIn:false}))
} finally {
  await browser.close()
}
