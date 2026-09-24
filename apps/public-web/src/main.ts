import './styles.css'
import { mountHeroAscii } from './ascii'
import { mountHeroClickSpark } from './clickSpark'

type PreviewStatus = 'success' | 'incomplete' | 'blocked' | 'failed' | 'timeout' | 'invalid_url' | 'quota_exceeded'
type ProductPreview = {
  status: 'complete' | 'incomplete' | 'invalid'
  asin: string | null
  region: string | null
  currency: string | null
  data: Record<string, unknown> | null
  issues: Array<{ code: string; message: string }>
}
type PreviewResponse = {
  status: PreviewStatus
  requestedUrl: string
  finalUrl: string | null
  title: string | null
  markdown: string | null
  totalMs: number
  reason: string | null
  diagnostic?: { code: string; stage: string; evidence: 'observed' | 'unobserved' }
  product?: ProductPreview
}
type CapabilityResponse = { requestedUrl: string; capability: { task: string; support: string; captureMode: 'http' | 'browser_local'; limitation: string } }
type OutputFormat = 'markdown' | 'json'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="page-shell">
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-backdrop" aria-hidden="true"></div>
      <div class="hero-octopus-static" aria-hidden="true"></div>
      <div class="hero-ascii-accent" id="hero-ascii" aria-hidden="true"></div>
      <div class="hero-shade" aria-hidden="true"></div>
      <div class="hero-click-spark" id="hero-click-spark" aria-hidden="true"></div>

      <header class="site-header layout-width">
        <a class="brand" href="#top" aria-label="W2L home">
          <img class="brand-mark" src="/assets/octopus-original.webp" alt="" width="50" height="50" />
          <span class="brand-name">W2L<span class="brand-dot">.</span></span>
        </a>
        <nav class="site-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works <span aria-hidden="true">↗</span></a>
          <a href="/docs/">Docs <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <main class="hero-main layout-width">
        <div class="hero-copy">
          <h1 id="hero-title">One link.<br /><em>Web data, ready.</em></h1>
          <p class="hero-description">Paste a public URL. Get readable content and verifiable fields where supported.</p>
        </div>

        <form class="url-form" id="preview-form" novalidate>
          <label class="visually-hidden" for="url-input">Public web page URL</label>
          <div class="url-entry">
            <span class="url-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5a4.5 4.5 0 0 0 6.36 0l3.18-3.18a4.5 4.5 0 0 0-6.36-6.36L11.5 5.64"/><path d="M14 10.5a4.5 4.5 0 0 0-6.36 0l-3.18 3.18a4.5 4.5 0 0 0 6.36 6.36l1.68-1.68"/></svg>
            </span>
            <input id="url-input" name="url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://docs.firecrawl.dev/introduction" aria-describedby="url-help capability-message form-message" required />
            <button class="submit-button" id="submit-button" type="submit"><span id="submit-label">Extract page</span><span class="button-arrow" aria-hidden="true">→</span></button>
          </div>
          <div class="form-meta">
            <p id="url-help">3 free previews per browser, daily · Public pages only</p>
            <button class="example-button" id="example-button" type="button">Try an example <span aria-hidden="true">↗</span></button>
          </div>
          <p class="capability-message" id="capability-message" role="status" aria-live="polite"></p>
          <div class="format-choice">
            <label for="output-format">Format</label>
            <select id="output-format" aria-describedby="format-help">
              <option value="markdown">Readable Markdown</option>
              <option value="json">Result JSON</option>
            </select>
            <span class="visually-hidden" id="format-help">Switch formats after extraction without another request.</span>
          </div>
          <p class="form-message" id="form-message" role="status" aria-live="polite"></p>
        </form>
      </main>
    </section>

    <section class="result-section layout-width" id="result-section" aria-labelledby="result-heading" hidden>
      <div class="section-kicker"><span class="kicker-square"></span> YOUR RESULT / 01</div>
      <div class="result-head">
        <div><h2 id="result-heading">Your result</h2><p id="result-subtitle">Reading the page…</p></div>
        <span class="result-badge" id="result-badge">Extracting</span>
      </div>
      <div id="result-content" aria-live="polite" aria-atomic="false"></div>
    </section>

    <section class="how-section" id="how-it-works" aria-labelledby="how-title">
      <div class="layout-width how-grid">
        <div><p class="section-kicker"><span class="kicker-square"></span> HOW IT WORKS</p><h2 id="how-title">From web page<br />to usable content.</h2></div>
        <div class="how-steps">
          <div class="how-step"><span class="step-number">01</span><div><h3>Paste a public URL</h3><p>No install or command line. One web address is enough to try it.</p></div></div>
          <div class="how-step"><span class="step-number">02</span><div><h3>Read the result</h3><p>See the content, final URL, status, and total time. Failures come with a reason.</p></div></div>
          <div class="how-step"><span class="step-number">03</span><div><h3>Check product fields</h3><p>For supported Amazon.sg pages, we also verify the product, region, and currency.</p></div></div>
        </div>
      </div>
    </section>

    <footer class="site-footer"><div class="layout-width footer-inner"><div class="footer-brand"><img src="/assets/octopus-original.webp" alt="" width="34" height="34" /><strong>W2L.</strong></div><span>Single-page public web preview</span><a href="/docs/">Documentation ↗</a><a href="#top">Back to top ↑</a></div></footer>
  </div>
`

const hero = document.querySelector<HTMLElement>('.hero')!
mountHeroAscii(document.querySelector<HTMLElement>('#hero-ascii')!, hero)
mountHeroClickSpark(document.querySelector<HTMLElement>('#hero-click-spark')!, hero)

const form = document.querySelector<HTMLFormElement>('#preview-form')!
const input = document.querySelector<HTMLInputElement>('#url-input')!
const message = document.querySelector<HTMLElement>('#form-message')!
const submit = document.querySelector<HTMLButtonElement>('#submit-button')!
const submitLabel = document.querySelector<HTMLElement>('#submit-label')!
const section = document.querySelector<HTMLElement>('#result-section')!
const subtitle = document.querySelector<HTMLElement>('#result-subtitle')!
const badge = document.querySelector<HTMLElement>('#result-badge')!
const content = document.querySelector<HTMLElement>('#result-content')!
const formatSelect = document.querySelector<HTMLSelectElement>('#output-format')!
const capabilityMessage = document.querySelector<HTMLElement>('#capability-message')!
let latestResult: PreviewResponse | null = null
let capabilityTimer: number | undefined
let capabilityRequest: AbortController | undefined

function downloadFile(content: string, name: string, type: string): void {
  const objectUrl = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function resultFilename(result: PreviewResponse, extension: 'md' | 'json'): string {
  let name = 'page'
  try {
    const url = new URL(result.finalUrl ?? result.requestedUrl)
    const lastSegment = url.pathname.split('/').filter(Boolean).at(-1) ?? 'page'
    name = `${url.hostname.replace(/^www\./, '')}-${lastSegment}`
  } catch { /* An unsuccessful request may not have a parseable URL. */ }
  const safe = name.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'page'
  return `w2l-${safe}.${extension}`
}

formatSelect.addEventListener('change', () => {
  if (latestResult) renderOutputPanel(latestResult)
})

document.querySelector<HTMLButtonElement>('#example-button')!.addEventListener('click', () => {
  input.value = 'https://docs.firecrawl.dev/introduction'
  input.focus()
  message.textContent = 'Example URL added. Select “Extract page” to begin.'
  message.className = 'form-message'
  scheduleCapability()
})

function normalizeUrl(value: string): string {
  const raw = value.trim()
  if (!raw) throw new Error('Enter a web page URL to begin.')
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try { url = new URL(withProtocol) } catch { throw new Error('Enter a valid web page URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port) {
    throw new Error('Use a public HTTP or HTTPS URL without credentials or a custom port.')
  }
  url.hash = ''
  if (url.toString().length > 2048) throw new Error('The URL is too long. Keep it under 2,048 characters.')
  return url.toString()
}

function scheduleCapability(): void {
  window.clearTimeout(capabilityTimer)
  capabilityRequest?.abort()
  const entered = input.value.trim()
  capabilityMessage.textContent = ''
  if (!entered) return
  let url: string
  try { url = normalizeUrl(entered) }
  catch { return }
  capabilityTimer = window.setTimeout(async () => {
    const request = new AbortController()
    capabilityRequest = request
    try {
      const response = await fetch(`/api/capability?url=${encodeURIComponent(url)}`, { signal: request.signal, credentials: 'same-origin' })
      if (!response.ok) return
      const result = await response.json() as CapabilityResponse
      if (request.signal.aborted || normalizeUrl(input.value) !== url) return
      const route = result.capability.captureMode === 'browser_local' ? 'a limited browser route' : 'restricted HTTP'
      const task = result.capability.task === 'amazon_sg_product' ? 'Amazon.sg product beta' : result.capability.task === 'x_public_post' ? 'X post' : result.capability.task === 'reddit_public_post' ? 'Reddit post' : 'Public page'
      const limit = result.capability.task === 'amazon_sg_product'
        ? 'Subject or quote may be unverified; the product gate remains open.'
        : result.capability.task === 'x_public_post' || result.capability.task === 'reddit_public_post'
          ? 'Site policy, login, or rendering may block capture.'
          : 'Site policy or rendering may limit content.'
      capabilityMessage.textContent = `${task} · Planned route: ${route}. ${limit}`
    } catch { /* A hint failure must not prevent extraction. */ }
  }, 300)
}

input.addEventListener('input', scheduleCapability)

function setBusy(busy: boolean): void {
  submit.disabled = busy
  input.disabled = busy
  submitLabel.textContent = busy ? 'Extracting' : 'Extract page'
  submit.classList.toggle('is-busy', busy)
  form.setAttribute('aria-busy', String(busy))
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.textContent = text
  if (className) element.className = className
  return element
}

function safeWebUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch { return null }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

function statusText(status: PreviewStatus, product?: ProductPreview, diagnostic?: PreviewResponse['diagnostic']): string {
  if (diagnostic?.code === 'subject_mismatch') return 'Different product selected'
  if (diagnostic?.code === 'quote_unverified') return 'Quote not verified'
  if (diagnostic?.code === 'robots_disallowed') return 'Site policy blocks preview'
  if (diagnostic?.code === 'login_required') return 'Login required'
  if (diagnostic?.code === 'challenge') return 'Verification page'
  if (status === 'success' && product?.status === 'incomplete') return 'Page read · Product fields need review'
  if (status === 'success' && product?.status === 'invalid') return 'Page read · Product fields invalid'
  return ({ success: 'Extraction complete', incomplete: 'Partial result', blocked: 'Blocked by site', failed: 'Extraction failed', timeout: 'Timed out', invalid_url: 'Invalid URL', quota_exceeded: 'Daily limit reached' })[status]
}

function statusDetail(status: PreviewStatus, reason: string | null): string {
  if (reason) return reason
  return ({ success: 'The page content is ready.', incomplete: 'We read the page, but could not verify every field.', blocked: 'The site blocked this request.', failed: 'We could not read this page. Please try again later.', timeout: 'The page took too long to respond.', invalid_url: 'Check the URL and try again.', quota_exceeded: 'The public preview limit resets tomorrow.' })[status]
}

function appendInline(target: HTMLElement, source: string): void {
  const tokens = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g
  let cursor = 0
  for (const match of source.matchAll(tokens)) {
    const index = match.index ?? 0
    if (index > cursor) target.append(document.createTextNode(source.slice(cursor, index)))
    if (match[2] && match[3]) {
      const href = safeWebUrl(match[3])
      if (href) {
        const link = textElement('a', match[2])
        link.href = href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        target.append(link)
      } else target.append(document.createTextNode(match[0]))
    } else if (match[4]) target.append(textElement('strong', match[4]))
    else if (match[5]) target.append(textElement('code', match[5]))
    cursor = index + match[0].length
  }
  if (cursor < source.length) target.append(document.createTextNode(source.slice(cursor)))
}

/** Render a small, safe Markdown subset; raw page HTML is never inserted into the DOM. */
function renderMarkdown(markdown: string): HTMLElement {
  const body = document.createElement('div')
  body.className = 'readable-content'
  const lines = markdown.slice(0, 150_000).replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: HTMLUListElement | HTMLOListElement | null = null
  let code: string[] | null = null
  const flushParagraph = () => {
    if (!paragraph.length) return
    const p = document.createElement('p')
    appendInline(p, paragraph.join(' '))
    body.append(p)
    paragraph = []
  }
  const flushList = () => { list = null }
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph(); flushList()
      if (code) {
        const pre = document.createElement('pre')
        pre.append(textElement('code', code.join('\n')))
        body.append(pre)
        code = null
      } else code = []
      continue
    }
    if (code) { code.push(line); continue }
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph(); flushList()
      const level = Math.min(4, heading[1].length + 1) as 2 | 3 | 4
      const node = document.createElement(`h${level}`)
      // Documentation sites often prefix headings with a zero-width anchor.
      // Keep the heading text readable without displaying its Markdown syntax.
      appendInline(node, heading[2].replace(/^\[[\u200b\u200c\u200d\uFEFF]*\]\(#[^)]+\)\s*/, ''))
      body.append(node)
      continue
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const tag = bullet ? 'ul' : 'ol'
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag)
        body.append(list)
      }
      const item = document.createElement('li')
      appendInline(item, (bullet ?? numbered)![1])
      list.append(item)
      continue
    }
    const quote = /^>\s*(.*)$/.exec(line)
    if (quote) {
      flushParagraph(); flushList()
      const blockquote = document.createElement('blockquote')
      appendInline(blockquote, quote[1])
      body.append(blockquote)
      continue
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) { flushParagraph(); flushList(); body.append(document.createElement('hr')); continue }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  if (code) { const pre = document.createElement('pre'); pre.append(textElement('code', code.join('\n'))); body.append(pre) }
  if (markdown.length > 150_000) body.append(textElement('p', 'This page is long, so the preview shows the first 150,000 characters. Copy content still copies the full returned text.', 'content-note'))
  return body
}

function productField(label: string, value: unknown, missing = 'Not verified'): HTMLElement {
  const field = document.createElement('div')
  field.className = 'product-field'
  field.append(textElement('dt', label))
  const dd = textElement('dd', value === null || value === undefined || value === '' ? missing : String(value))
  if (value === null || value === undefined || value === '') dd.className = 'value-missing'
  field.append(dd)
  return field
}

function renderProduct(product: ProductPreview): HTMLElement {
  const section = document.createElement('section')
  section.className = 'product-panel'
  section.setAttribute('aria-labelledby', 'product-title')
  const top = document.createElement('div')
  top.className = 'product-top'
  const heading = document.createElement('div')
  heading.append(textElement('p', 'AMAZON.SG / PRODUCT SIGNALS', 'panel-kicker'))
  const h3 = textElement('h3', 'Product fields')
  h3.id = 'product-title'
  heading.append(h3)
  top.append(heading)
  const state = textElement('span', product.status === 'complete' ? 'Product and region verified' : 'Fields need review', 'product-state')
  if (product.status !== 'complete') state.classList.add('is-incomplete')
  top.append(state)
  section.append(top)

  const data = product.data ?? {}
  const grid = document.createElement('dl')
  grid.className = 'product-grid'
  grid.append(productField('Product ASIN', product.asin ?? data.asin, 'Product not verified'))
  grid.append(productField('Title', data.title))
  grid.append(productField('Delivery region', product.region ?? data.deliveryLocation, 'Region not verified'))
  grid.append(productField('Currency', product.currency ?? data.currency, 'Currency not verified'))
  const price = product.status === 'complete' && product.asin && product.region && product.currency ? data.price : null
  grid.append(productField('Price', price, 'Price not verified'))
  grid.append(productField('Seller', data.seller))
  section.append(grid)

  if (product.issues.length) {
    const issues = document.createElement('div')
    issues.className = 'product-issues'
    issues.append(textElement('h4', 'What to check'))
    const list = document.createElement('ul')
    for (const issue of product.issues.slice(0, 8)) list.append(textElement('li', issue.message || issue.code))
    issues.append(list)
    section.append(issues)
  }
  const details = document.createElement('details')
  details.className = 'json-details'
  details.append(textElement('summary', 'View structured JSON'))
  details.append(textElement('pre', JSON.stringify(data, null, 2)))
  section.append(details)
  return section
}

function renderOutputPanel(result: PreviewResponse): void {
  content.querySelector('.output-panel')?.remove()
  const format = formatSelect.value as OutputFormat
  const isJson = format === 'json'
  const output = document.createElement('section')
  output.className = 'output-panel'
  output.setAttribute('aria-labelledby', 'content-title')
  const header = document.createElement('div')
  header.className = 'output-head'
  const title = document.createElement('div')
  title.append(textElement('p', isJson ? 'EXTRACTED RESULT / JSON' : 'EXTRACTED CONTENT / MARKDOWN', 'panel-kicker'))
  const h3 = textElement('h3', isJson ? 'Result JSON' : 'Readable content')
  h3.id = 'content-title'
  title.append(h3)
  header.append(title)

  const actions = document.createElement('div')
  actions.className = 'output-actions'
  const viewLabel = textElement('label', 'View', 'output-view-label')
  const viewSelect = document.createElement('select')
  viewSelect.className = 'output-view-select'
  viewSelect.setAttribute('aria-label', 'View output format')
  viewSelect.append(new Option('Markdown', 'markdown'), new Option('JSON', 'json'))
  viewSelect.value = format
  viewSelect.addEventListener('change', () => {
    formatSelect.value = viewSelect.value
    renderOutputPanel(result)
    content.querySelector<HTMLSelectElement>('.output-view-select')?.focus()
  })
  viewLabel.append(viewSelect)
  actions.append(viewLabel)
  const payload = isJson ? `${JSON.stringify(result, null, 2)}\n` : result.markdown ?? ''
  const copy = textElement('button', isJson ? 'Copy JSON' : 'Copy content', 'copy-button')
  copy.type = 'button'
  copy.disabled = !payload
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(payload)
      copy.textContent = 'Copied ✓'
      window.setTimeout(() => { copy.textContent = isJson ? 'Copy JSON' : 'Copy content' }, 2200)
    } catch { copy.textContent = 'Copy failed. Select the text manually.' }
  })
  actions.append(copy)
  const download = textElement('button', isJson ? '↓ Download JSON' : '↓ Download Markdown', 'download-button')
  download.type = 'button'
  download.disabled = !payload
  download.addEventListener('click', () => downloadFile(payload, resultFilename(result, isJson ? 'json' : 'md'), isJson ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'))
  actions.append(download)
  header.append(actions)
  output.append(header)
  if (isJson) {
    output.append(textElement('p', 'This is the sanitized server response. Its totalMs measures server processing; the page total above includes browser network time. Verified Amazon.sg product fields appear under “product” when available.', 'output-explanation'))
    output.append(textElement('pre', payload, 'json-output'))
  } else if (payload.trim()) output.append(renderMarkdown(payload))
  else output.append(textElement('p', 'No readable Markdown was returned. Switch to Result JSON to inspect the status and reason.', 'empty-content'))
  content.append(output)
}

function renderResult(result: PreviewResponse, clientMs: number, started: number): void {
  latestResult = result
  section.hidden = false
  content.replaceChildren()
  const isPageRead = result.status === 'success' || result.status === 'incomplete'
  subtitle.textContent = result.title || (isPageRead ? 'Page content' : 'No readable content returned')
  badge.textContent = statusText(result.status, result.product, result.diagnostic)
  badge.className = `result-badge status-${result.status}`
  if (result.product?.status !== 'complete' && result.product) badge.classList.add('status-partial')

  const facts = document.createElement('div')
  facts.className = 'result-facts'
  const statusFact = document.createElement('div')
  statusFact.className = 'result-fact'
  statusFact.append(textElement('span', 'Status', 'fact-label'), textElement('strong', statusText(result.status, result.product, result.diagnostic)))
  facts.append(statusFact)
  const timeFact = document.createElement('div')
  timeFact.className = 'result-fact'
  timeFact.append(textElement('span', 'Total time · including network', 'fact-label'), textElement('strong', formatDuration(clientMs), 'elapsed-value'))
  facts.append(timeFact)
  const urlFact = document.createElement('div')
  urlFact.className = 'result-fact result-url-fact'
  urlFact.append(textElement('span', 'Final URL', 'fact-label'))
  const href = safeWebUrl(result.finalUrl)
  if (href) {
    const link = textElement('a', href)
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    urlFact.append(link)
  } else urlFact.append(textElement('strong', 'Not available'))
  facts.append(urlFact)
  content.append(facts)

  if (result.reason || !isPageRead || result.product?.status !== 'complete' && result.product) {
    const detail = result.reason ?? (result.product && result.product.status !== 'complete'
      ? 'We read the page, but some product fields still need verification. See the notes below.'
      : statusDetail(result.status, null))
    const note = textElement('p', detail, 'result-note')
    if (!isPageRead) note.classList.add('is-error')
    content.append(note)
  }
  if (result.product) content.append(renderProduct(result.product))
  renderOutputPanel(result)

  // The browser measurement includes network and synchronous result rendering.
  requestAnimationFrame(() => {
    const elapsed = content.querySelector<HTMLElement>('.elapsed-value')
    if (elapsed) elapsed.textContent = formatDuration(Math.max(clientMs, performance.now() - started))
  })
  section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

function renderLoading(): void {
  latestResult = null
  section.hidden = false
  subtitle.textContent = 'Reading the page…'
  badge.textContent = 'Extracting'
  badge.className = 'result-badge status-loading'
  content.replaceChildren()
  const box = document.createElement('div')
  box.className = 'loading-panel'
  box.setAttribute('role', 'status')
  box.append(textElement('span', '', 'loading-spinner'))
  box.append(textElement('p', 'Reading the page and preparing its content. This usually takes a few seconds.'))
  content.append(box)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (submit.disabled) return
  let url: string
  try { url = normalizeUrl(input.value) }
  catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Enter a valid URL.'
    message.className = 'form-message is-error'
    input.focus()
    return
  }
  input.value = url
  message.textContent = 'Extracting. This temporary result will not be saved.'
  message.className = 'form-message'
  setBusy(true)
  renderLoading()
  const started = performance.now()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 55_000)
  try {
    const response = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
      credentials: 'same-origin',
    })
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('status' in value)) throw new Error('The service returned an unrecognized result.')
    const result = value as PreviewResponse
    if (!result.requestedUrl || !Number.isFinite(result.totalMs)) throw new Error('The service returned an incomplete result.')
    renderResult(result, performance.now() - started, started)
    message.textContent = result.status === 'success' || result.status === 'incomplete' ? 'Your result is below.' : statusDetail(result.status, result.reason)
    message.className = `form-message${result.status === 'success' || result.status === 'incomplete' ? '' : ' is-error'}`
  } catch (error) {
    const aborted = controller.signal.aborted
    const result: PreviewResponse = {
      status: aborted ? 'timeout' : 'failed',
      requestedUrl: url,
      finalUrl: null,
      title: null,
      markdown: null,
      totalMs: performance.now() - started,
      reason: aborted ? 'The browser timed out. The server may still be processing; try again later.' : 'The service could not return a result. Please try again later.',
    }
    renderResult(result, performance.now() - started, started)
    message.textContent = result.reason
    message.className = 'form-message is-error'
  } finally {
    clearTimeout(timeout)
    setBusy(false)
  }
})
