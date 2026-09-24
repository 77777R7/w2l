import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'dist', 'docs')
const assetRoot = join(root, 'public', 'docs-assets')
const assetVersions = Object.fromEntries(await Promise.all(['docs.css', 'docs-mobile.css', 'docs.js'].map(async name => [
  name,
  createHash('sha256').update(await readFile(join(assetRoot, name))).digest('hex').slice(0, 12),
])))
const pages = [
  { slug: '', file: 'introduction.md', title: 'Introduction', description: 'Try W2L with one public URL and learn what a verified result looks like.', group: 'Get started' },
  { slug: 'connect-mcp', file: 'connect-mcp.md', title: 'Connect MCP', description: 'Choose an MCP client, copy its local W2L setup, and run a first task.', group: 'Get started' },
  { slug: 'guides/extract-page', file: 'extract-page.md', title: 'Extract a public page', description: 'Get readable Markdown, a final URL, status, and elapsed time from a public web page.', group: 'Guides' },
  { slug: 'guides/amazon-product', file: 'amazon-product.md', title: 'Amazon.sg product JSON', description: 'Check a product ASIN, Singapore delivery region, currency, and missing fields.', group: 'Guides' },
  { slug: 'guides/monitor-webhook', file: 'monitor-webhook.md', title: 'Monitor to HTTPS Webhook', description: 'Create a document Monitor and verify durable delivery by eventId.', group: 'Guides' },
  { slug: 'guides/batch-results', file: 'batch-results.md', title: 'Page through batch results', description: 'Queue a durable URL batch and inspect every result through pagination.', group: 'Guides' },
  { slug: 'limits', file: 'limits.md', title: 'Limits and result states', description: 'Understand preview quotas, supported sites, incomplete fields, blocks, and timeouts.', group: 'Reference' },
  { slug: 'reference', file: 'reference.md', title: 'Advanced reference', description: 'Find REST, SDK, and self-hosted entry points after your first W2L result.', group: 'Reference' },
]

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
const escape = md.utils.escapeHtml
const pathFor = page => page.slug ? `/docs/${page.slug}/` : '/docs/'
const slug = value => value.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-') || 'section'

md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0] || 'text'
  return `<div class="doc-code"><div class="doc-code-head"><span>${escape(language)}</span><button type="button" class="copy-code" aria-label="Copy ${escape(language)} example">Copy</button></div><pre><code>${escape(token.content)}</code></pre></div>`
}
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const href = token.attrGet('href') ?? ''
  if (/^https?:\/\//i.test(href)) token.attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, index, options)
}

function renderMarkdown(source) {
  const tokens = md.parse(source, {})
  const used = new Set()
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== 'heading_open') continue
    const value = tokens[index + 1]?.children?.map(child => child.content).join('') ?? ''
    const base = slug(value)
    let id = base
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`
    used.add(id)
    tokens[index].attrSet('id', id)
  }
  return md.renderer.render(tokens, md.options, {})
}

const mcpClients = [
  {
    id: 'codex', name: 'Codex', mode: 'Run in terminal', status: 'Verified locally',
    icon: 'codex.svg',
    intro: 'The macOS first-use setup normally adds this entry automatically. Use this command if it did not.',
    code: 'codex mcp add w2l-local --url http://127.0.0.1:8791/mcp', language: 'bash',
    verify: 'Run codex mcp list, open a new Codex task, then use /mcp to check that preview_monitor is available.',
    source: 'https://developers.openai.com/learn/docs-mcp',
  },
  {
    id: 'claude', name: 'Claude Code', mode: 'Run in terminal', status: 'Client task check pending',
    icon: 'claude-code.svg',
    intro: 'Add the local HTTP server to Claude Code in the current project. Run this in the checkout where you use Claude Code.',
    code: 'claude mcp add --transport http --scope local w2l-local http://127.0.0.1:8791/mcp', language: 'bash',
    verify: 'Run claude mcp list. In Claude Code, use /mcp to check the connection and tools before sending the first task.',
    source: 'https://code.claude.com/docs/en/mcp',
  },
  {
    id: 'cursor', name: 'Cursor', mode: 'Copy config', status: 'Client task check pending',
    icon: 'cursor.svg',
    intro: 'Merge this server into your project .cursor/mcp.json (or your user-level ~/.cursor/mcp.json). Keep existing servers.',
    code: '{\n  "mcpServers": {\n    "w2l-local": {\n      "url": "http://127.0.0.1:8791/mcp"\n    }\n  }\n}', language: 'json',
    verify: 'Reload Cursor, then check MCP tools in its settings. In Cursor CLI, cursor-agent mcp list-tools w2l-local lists tools.',
    source: 'https://prod.cursor.com/help/customization/mcp',
  },
  {
    id: 'opencode', name: 'OpenCode', mode: 'Copy config', status: 'Client task check pending',
    icon: 'opencode.svg',
    intro: 'For OpenCode 1.x, merge this entry into the mcp object in opencode.json. Keep your existing settings and servers.',
    code: '{\n  "mcp": {\n    "w2l-local": {\n      "type": "remote",\n      "url": "http://127.0.0.1:8791/mcp",\n      "enabled": true\n    }\n  }\n}', language: 'json',
    verify: 'Run opencode mcp list and confirm w2l-local is connected, then ask for the sample task below.',
    source: 'https://opencode.ai/docs/mcp-servers',
  },
]

function mcpClientPicker() {
  const tabs = mcpClients.map((client, index) => `<button type="button" class="mcp-client-tab" role="tab" id="mcp-tab-${client.id}" aria-controls="mcp-panel-${client.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}"><img src="/docs-assets/agent-clients/${escape(client.icon)}" width="48" height="48" alt="" /><strong>${escape(client.name)}</strong><small>${escape(client.mode)}</small></button>`).join('')
  const panels = mcpClients.map((client, index) => `<section class="mcp-client-panel" role="tabpanel" id="mcp-panel-${client.id}" aria-labelledby="mcp-tab-${client.id}"${index === 0 ? '' : ' hidden'}><p class="mcp-client-intro">${escape(client.intro)}</p><div class="doc-code mcp-command-row${client.language === 'json' ? ' is-json' : ''}"><span class="mcp-command-prefix" aria-hidden="true">${client.language === 'bash' ? '$' : '{}'}</span><pre><code>${escape(client.code)}</code></pre><button type="button" class="copy-code" aria-label="Copy ${escape(client.name)} setup">Copy</button></div><p class="mcp-client-verify">${escape(client.verify)}</p><div class="mcp-client-panel-meta"><span class="mcp-client-status${index === 0 ? ' is-verified' : ''}">${escape(client.status)}</span><a href="${escape(client.source)}" rel="noopener noreferrer" target="_blank">${escape(client.name)} setup docs ↗</a></div></section>`).join('')
  return `<div class="mcp-picker"><div class="mcp-picker-head"><div><h2>Set up W2L MCP</h2><p>Connect to the local W2L service on this computer.</p></div><a href="#start-w2l-on-your-computer">Start local service <span aria-hidden="true">→</span></a></div><div class="mcp-client-tabs" role="tablist" aria-label="Choose an MCP client">${tabs}</div>${panels}<div class="mcp-picker-foot"><p>Using another MCP client? Point it at:</p><div class="doc-code mcp-command-row"><pre><code>http://127.0.0.1:8791/mcp</code></pre><button type="button" class="copy-code" aria-label="Copy local MCP endpoint">Copy</button></div><small>Hosted HTTPS and browser login are coming soon.</small></div></div>`
}

function renderPageContent(page, source) {
  if (page.slug !== 'connect-mcp') return renderMarkdown(source)
  const marker = '{{MCP_CLIENT_PICKER}}'
  const parts = source.split(marker)
  if (parts.length !== 2) throw new Error('Connect MCP page must include exactly one client picker marker')
  return renderMarkdown(parts[0]) + mcpClientPicker() + renderMarkdown(parts[1])
}

function nav(active) {
  let group = ''
  return pages.map(page => {
    const heading = group === page.group ? '' : `<p class="doc-nav-heading">${escape(page.group)}</p>`
    group = page.group
    return `${heading}<a href="${pathFor(page)}"${page.slug === active.slug ? ' aria-current="page"' : ''}>${escape(page.title)}</a>`
  }).join('')
}

function documentHtml(page, content, index) {
  const previous = pages[index - 1]
  const next = pages[index + 1]
  const adjacent = `<nav class="doc-adjacent" aria-label="Next and previous pages">${previous ? `<a href="${pathFor(previous)}"><small>Previous</small>${escape(previous.title)}</a>` : '<span></span>'}${next ? `<a href="${pathFor(next)}"><small>Next</small>${escape(next.title)} →</a>` : '<span></span>'}</nav>`
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="theme-color" content="#071b4f" /><meta name="description" content="${escape(page.description)}" /><link rel="icon" type="image/webp" href="/assets/octopus-original.webp" /><link rel="stylesheet" href="/docs-assets/docs.css?v=${assetVersions['docs.css']}" /><link rel="stylesheet" href="/docs-assets/docs-mobile.css?v=${assetVersions['docs-mobile.css']}" /><title>${escape(page.title)} | W2L Docs</title></head>
<body><a class="skip-link" href="#main-content">Skip to content</a><header class="doc-header"><div class="doc-header-inner"><a class="doc-brand" href="/" aria-label="W2L home"><img src="/assets/octopus-original.webp" width="34" height="34" alt="" /><span>W2L<span class="brand-dot">.</span></span></a><nav aria-label="Top navigation"><a href="/docs/" aria-current="page">Docs</a><a class="try-link" href="/">Try W2L <span aria-hidden="true">↗</span></a></nav></div></header>
<div class="doc-layout"><aside class="doc-sidebar"><nav aria-label="Documentation pages">${nav(page)}</nav></aside><details class="doc-mobile-pages"><summary>Browse docs: ${escape(page.title)}</summary><nav aria-label="Documentation pages on mobile">${nav(page)}</nav></details><main id="main-content" class="doc-main"><p class="doc-eyebrow">W2L / ${escape(page.group)}</p><article class="doc-article">${content}</article>${adjacent}<footer class="doc-footer"><span>The page preview runs at this site's URL. MCP setup is local; hosted MCP is pending validation.</span><a href="/">Try a page ↗</a></footer></main></div><div id="copy-announcement" class="sr-only" role="status" aria-live="polite"></div><script defer src="/docs-assets/docs.js?v=${assetVersions['docs.js']}"></script></body></html>`
}

await mkdir(output, { recursive: true })
for (const [index, page] of pages.entries()) {
  const source = await readFile(join(root, 'content', page.file), 'utf8')
  const target = join(output, page.slug, 'index.html')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, documentHtml(page, renderPageContent(page, source), index))
}
console.log(`Built ${pages.length} W2L documentation pages in ${output}`)
