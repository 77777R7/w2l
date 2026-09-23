import './styles.css'
import { mountHeroAscii } from './ascii'

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
  product?: ProductPreview
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="page-shell">
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero-backdrop" aria-hidden="true"></div>
      <canvas class="hero-ascii" id="hero-ascii" aria-hidden="true"></canvas>
      <div class="hero-shade" aria-hidden="true"></div>

      <header class="site-header layout-width">
        <a class="brand" href="#top" aria-label="W2L 首页">
          <img class="brand-mark" src="/assets/octopus-original.webp" alt="" width="50" height="50" />
          <span class="brand-name">W2L<span class="brand-dot">.</span></span>
        </a>
        <nav class="site-nav" aria-label="主导航">
          <span class="nav-preview"><span class="online-dot"></span> 公开预览</span>
          <a href="#how-it-works">如何使用 <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <main class="hero-main layout-width">
        <div class="hero-copy">
          <p class="eyebrow"><span class="eyebrow-line"></span> WEB TO LIVING DATA <span class="eyebrow-line"></span></p>
          <h1 id="hero-title">一个链接，<br /><em>读懂网页。</em></h1>
          <p class="hero-description">粘贴公开网页地址，得到清晰可读的内容。<br class="desktop-break" />支持的商品页还能看到可核对的结构化字段。</p>
        </div>

        <form class="url-form" id="preview-form" novalidate>
          <label for="url-input">从这个网页开始</label>
          <div class="url-entry">
            <span class="url-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5a4.5 4.5 0 0 0 6.36 0l3.18-3.18a4.5 4.5 0 0 0-6.36-6.36L11.5 5.64"/><path d="M14 10.5a4.5 4.5 0 0 0-6.36 0l-3.18 3.18a4.5 4.5 0 0 0 6.36 6.36l1.68-1.68"/></svg>
            </span>
            <input id="url-input" name="url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://docs.firecrawl.dev/introduction" aria-describedby="url-help form-message" required />
            <button class="submit-button" id="submit-button" type="submit"><span id="submit-label">提取网页</span><span class="button-arrow" aria-hidden="true">→</span></button>
          </div>
          <div class="form-meta">
            <p id="url-help">免安装试用 · 每个浏览器每天 3 次 · 仅公开网页</p>
            <button class="example-button" id="example-button" type="button">试试示例链接 <span aria-hidden="true">↗</span></button>
          </div>
          <p class="form-message" id="form-message" role="status" aria-live="polite"></p>
        </form>
      </main>
      <div class="hero-bottom layout-width" aria-hidden="true"><span>[ INPUT → OUTPUT ]</span><span>SCROLL TO EXPLORE ↓</span></div>
    </section>

    <section class="result-section layout-width" id="result-section" aria-labelledby="result-heading" hidden>
      <div class="section-kicker"><span class="kicker-square"></span> YOUR RESULT / 01</div>
      <div class="result-head">
        <div><h2 id="result-heading">提取结果</h2><p id="result-subtitle">正在读取网页…</p></div>
        <span class="result-badge" id="result-badge">正在提取</span>
      </div>
      <div id="result-content" aria-live="polite" aria-atomic="false"></div>
    </section>

    <section class="how-section" id="how-it-works" aria-labelledby="how-title">
      <div class="layout-width how-grid">
        <div><p class="section-kicker"><span class="kicker-square"></span> HOW IT WORKS</p><h2 id="how-title">网页数据，<br />从此更好用。</h2></div>
        <div class="how-steps">
          <div class="how-step"><span class="step-number">01</span><div><h3>贴上公开链接</h3><p>无需安装或命令行。首次试用只需要一个网页地址。</p></div></div>
          <div class="how-step"><span class="step-number">02</span><div><h3>查看可读内容</h3><p>结果会给出最终地址、状态与总耗时；遇到阻断也会说明原因。</p></div></div>
          <div class="how-step"><span class="step-number">03</span><div><h3>核对专用字段</h3><p>对已支持的 Amazon.sg 商品页，额外核对主体、地区和币种。</p></div></div>
        </div>
      </div>
    </section>

    <footer class="site-footer"><div class="layout-width footer-inner"><div class="footer-brand"><img src="/assets/octopus-original.webp" alt="" width="34" height="34" /><strong>W2L.</strong></div><span>公开网页单页提取预览</span><a href="#top">返回顶部 ↑</a></div></footer>
  </div>
`

const hero = document.querySelector<HTMLElement>('.hero')!
mountHeroAscii(document.querySelector<HTMLCanvasElement>('#hero-ascii')!, hero)

const form = document.querySelector<HTMLFormElement>('#preview-form')!
const input = document.querySelector<HTMLInputElement>('#url-input')!
const message = document.querySelector<HTMLElement>('#form-message')!
const submit = document.querySelector<HTMLButtonElement>('#submit-button')!
const submitLabel = document.querySelector<HTMLElement>('#submit-label')!
const section = document.querySelector<HTMLElement>('#result-section')!
const subtitle = document.querySelector<HTMLElement>('#result-subtitle')!
const badge = document.querySelector<HTMLElement>('#result-badge')!
const content = document.querySelector<HTMLElement>('#result-content')!

document.querySelector<HTMLButtonElement>('#example-button')!.addEventListener('click', () => {
  input.value = 'https://docs.firecrawl.dev/introduction'
  input.focus()
  message.textContent = '示例链接已填入，点击“提取网页”开始。'
  message.className = 'form-message'
})

function normalizeUrl(value: string): string {
  const raw = value.trim()
  if (!raw) throw new Error('请先输入一个网页链接。')
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try { url = new URL(withProtocol) } catch { throw new Error('链接格式不正确，请输入完整的网页地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port) {
    throw new Error('请输入不含账号密码或自定义端口的公开 HTTP/HTTPS 链接。')
  }
  url.hash = ''
  if (url.toString().length > 2048) throw new Error('链接过长，请输入不超过 2048 字符的地址。')
  return url.toString()
}

function setBusy(busy: boolean): void {
  submit.disabled = busy
  input.disabled = busy
  submitLabel.textContent = busy ? '正在提取' : '提取网页'
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
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} 秒`
}

function statusText(status: PreviewStatus, product?: ProductPreview): string {
  if (status === 'success' && product?.status === 'incomplete') return '页面已读取 · 商品字段待核对'
  if (status === 'success' && product?.status === 'invalid') return '页面已读取 · 商品字段无效'
  return ({ success: '提取完成', incomplete: '内容不完整', blocked: '网站阻止了抓取', failed: '提取失败', timeout: '读取超时', invalid_url: '链接无效', quota_exceeded: '今日额度已用完' })[status]
}

function statusDetail(status: PreviewStatus, reason: string | null): string {
  if (reason) return reason
  return ({ success: '网页内容已准备好。', incomplete: '页面已读取，但部分内容无法确认。', blocked: '目标网站暂时不允许本次公开抓取。', failed: '暂时无法读取此网页，请稍后重试。', timeout: '网页响应时间过长，请稍后重试。', invalid_url: '请检查链接并重试。', quota_exceeded: '公开试用额度会在明天恢复。' })[status]
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
  if (markdown.length > 150_000) body.append(textElement('p', '页面内容较长，这里显示前 150,000 个字符。复制按钮仍可复制返回的完整内容。', 'content-note'))
  return body
}

function productField(label: string, value: unknown, missing = '未确认'): HTMLElement {
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
  const h3 = textElement('h3', '商品字段')
  h3.id = 'product-title'
  heading.append(h3)
  top.append(heading)
  const state = textElement('span', product.status === 'complete' ? '主体与地区已匹配' : '字段待确认', 'product-state')
  if (product.status !== 'complete') state.classList.add('is-incomplete')
  top.append(state)
  section.append(top)

  const data = product.data ?? {}
  const grid = document.createElement('dl')
  grid.className = 'product-grid'
  grid.append(productField('主体 ASIN', product.asin ?? data.asin, '主体未确认'))
  grid.append(productField('标题', data.title))
  grid.append(productField('配送地区', product.region ?? data.deliveryLocation, '地区未确认'))
  grid.append(productField('币种', product.currency ?? data.currency, '币种未确认'))
  const price = product.status === 'complete' && product.asin && product.region && product.currency ? data.price : null
  grid.append(productField('价格', price, '价格未确认'))
  grid.append(productField('卖家', data.seller))
  section.append(grid)

  if (product.issues.length) {
    const issues = document.createElement('div')
    issues.className = 'product-issues'
    issues.append(textElement('h4', '需要留意'))
    const list = document.createElement('ul')
    for (const issue of product.issues.slice(0, 8)) list.append(textElement('li', issue.message || issue.code))
    issues.append(list)
    section.append(issues)
  }
  const details = document.createElement('details')
  details.className = 'json-details'
  details.append(textElement('summary', '查看结构化 JSON'))
  details.append(textElement('pre', JSON.stringify(data, null, 2)))
  section.append(details)
  return section
}

function renderResult(result: PreviewResponse, clientMs: number, started: number): void {
  section.hidden = false
  content.replaceChildren()
  const hasReadable = Boolean(result.markdown?.trim())
  const isPageRead = result.status === 'success' || result.status === 'incomplete'
  subtitle.textContent = result.title || (isPageRead ? '网页内容' : '本次未取得可读内容')
  badge.textContent = statusText(result.status, result.product)
  badge.className = `result-badge status-${result.status}`
  if (result.product?.status !== 'complete' && result.product) badge.classList.add('status-partial')

  const facts = document.createElement('div')
  facts.className = 'result-facts'
  const statusFact = document.createElement('div')
  statusFact.className = 'result-fact'
  statusFact.append(textElement('span', '状态', 'fact-label'), textElement('strong', statusText(result.status, result.product)))
  facts.append(statusFact)
  const timeFact = document.createElement('div')
  timeFact.className = 'result-fact'
  timeFact.append(textElement('span', '总耗时（含网络）', 'fact-label'), textElement('strong', formatDuration(clientMs), 'elapsed-value'))
  facts.append(timeFact)
  const urlFact = document.createElement('div')
  urlFact.className = 'result-fact result-url-fact'
  urlFact.append(textElement('span', '最终 URL', 'fact-label'))
  const href = safeWebUrl(result.finalUrl)
  if (href) {
    const link = textElement('a', href)
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    urlFact.append(link)
  } else urlFact.append(textElement('strong', '未取得'))
  facts.append(urlFact)
  content.append(facts)

  if (result.reason || !isPageRead || result.product?.status !== 'complete' && result.product) {
    const detail = result.reason ?? (result.product && result.product.status !== 'complete'
      ? '网页正文已取得，但商品字段仍有未确认项；请查看下方的核对说明。'
      : statusDetail(result.status, null))
    const note = textElement('p', detail, 'result-note')
    if (!isPageRead) note.classList.add('is-error')
    content.append(note)
  }
  if (result.product) content.append(renderProduct(result.product))
  if (hasReadable) {
    const output = document.createElement('section')
    output.className = 'output-panel'
    output.setAttribute('aria-labelledby', 'content-title')
    const header = document.createElement('div')
    header.className = 'output-head'
    const title = document.createElement('div')
    title.append(textElement('p', 'EXTRACTED CONTENT / MARKDOWN', 'panel-kicker'))
    const h3 = textElement('h3', '可读内容')
    h3.id = 'content-title'
    title.append(h3)
    header.append(title)
    const copy = textElement('button', '复制内容', 'copy-button')
    copy.type = 'button'
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(result.markdown!)
        copy.textContent = '已复制 ✓'
        window.setTimeout(() => { copy.textContent = '复制内容' }, 2200)
      } catch {
        copy.textContent = '复制失败，请手动选择内容'
      }
    })
    header.append(copy)
    output.append(header, renderMarkdown(result.markdown!))
    content.append(output)
  } else if (isPageRead) content.append(textElement('p', '页面已处理，但没有可展示的正文。', 'empty-content'))

  // The browser measurement includes network and synchronous result rendering.
  requestAnimationFrame(() => {
    const elapsed = content.querySelector<HTMLElement>('.elapsed-value')
    if (elapsed) elapsed.textContent = formatDuration(Math.max(clientMs, performance.now() - started))
  })
  section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

function renderLoading(): void {
  section.hidden = false
  subtitle.textContent = '正在读取网页…'
  badge.textContent = '正在提取'
  badge.className = 'result-badge status-loading'
  content.replaceChildren()
  const box = document.createElement('div')
  box.className = 'loading-panel'
  box.setAttribute('role', 'status')
  box.append(textElement('span', '', 'loading-spinner'))
  box.append(textElement('p', '正在读取页面并整理内容，通常只需几秒。'))
  content.append(box)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (submit.disabled) return
  let url: string
  try { url = normalizeUrl(input.value) }
  catch (error) {
    message.textContent = error instanceof Error ? error.message : '请输入有效链接。'
    message.className = 'form-message is-error'
    input.focus()
    return
  }
  input.value = url
  message.textContent = '正在提取。关闭页面后将无法查看本次临时结果。'
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
    if (!value || typeof value !== 'object' || !('status' in value)) throw new Error('服务返回了无法识别的结果。')
    const result = value as PreviewResponse
    if (!result.requestedUrl || !Number.isFinite(result.totalMs)) throw new Error('服务返回了不完整的结果。')
    renderResult(result, performance.now() - started, started)
    message.textContent = result.status === 'success' || result.status === 'incomplete' ? '结果已显示在下方。' : statusDetail(result.status, result.reason)
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
      reason: aborted ? '浏览器等待超时。服务端可能仍在处理，请稍后再试。' : '服务暂时无法返回结果，请稍后重试。',
    }
    renderResult(result, performance.now() - started, started)
    message.textContent = result.reason
    message.className = 'form-message is-error'
  } finally {
    clearTimeout(timeout)
    setBusy(false)
  }
})
