import { mkdir, readFile, writeFile } from 'node:fs/promises'

const hosts = [
  ['developer.mozilla.org', 'ai_knowledge', [
    'en-US/docs/Web/API/AbortController', 'en-US/docs/Web/API/AbortSignal', 'en-US/docs/Web/API/Fetch_API', 'en-US/docs/Web/API/WebSocket', 'en-US/docs/Web/API/Window/fetch', 'en-US/docs/Web/HTTP/Reference/Status', 'en-US/docs/Web/HTTP/Reference/Methods', 'en-US/docs/Web/HTTP/Reference/Headers', 'en-US/docs/Web/HTTP/Guides/Conditional_requests', 'en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all',
  ]],
  ['playwright.dev', 'ai_knowledge', ['docs/library', 'docs/locators', 'docs/network', 'docs/browser-contexts', 'docs/api/class-page', 'docs/api/class-browser', 'docs/test-assertions', 'docs/auth', 'docs/test-timeouts', 'docs/ci-intro']],
  ['docs.github.com', 'ai_knowledge', ['en/rest', 'en/rest/using-the-rest-api', 'en/rest/overview/resources-in-the-rest-api', 'en/rest/authentication/authenticating-to-the-rest-api', 'en/rest/using-the-rest-api/rate-limits-for-the-rest-api', 'en/rest/pulls/pulls', 'en/rest/issues/issues', 'en/rest/repos/repos', 'en/rest/actions/workflows', 'en/rest/webhooks']],
  ['nodejs.org', 'ai_knowledge', ['api/globals.html#fetch', 'api/globals.html#class-abortcontroller', 'api/http.html', 'api/https.html', 'api/streams.html', 'api/url.html', 'api/events.html', 'api/process.html', 'api/fs.html', 'api/cli.html']],
  ['www.typescriptlang.org', 'ai_knowledge', ['docs/handbook/intro.html', 'docs/handbook/2/everyday-types.html', 'docs/handbook/2/functions.html', 'docs/handbook/2/objects.html', 'docs/handbook/2/classes.html', 'docs/handbook/2/generics.html', 'docs/handbook/2/narrowing.html', 'docs/handbook/2/modules.html', 'docs/handbook/2/type-manipulation/conditional-types.html', 'docs/handbook/project-references.html']],
  ['docs.crawl4ai.com', 'ai_knowledge', ['core/quickstart/', 'core/simple-crawling/', 'core/crawler-result/', 'core/browser-crawler-config/', 'core/markdown-generation/', 'advanced/multi-url-crawling/', 'advanced/crawl-dispatcher/', 'advanced/hooks-auth/', 'extraction/no-llm-strategies/', 'api/async-webcrawler/']],
  ['docs.steel.dev', 'product_info', ['overview/intro-to-steel', 'overview/sessions-api/overview', 'overview/sessions-api/quickstart', 'overview/profiles-api/overview', 'overview/credentials-api/overview', 'overview/files-api/overview', 'overview/extensions-api/overview', 'overview/self-hosting/docker', 'cookbook/playwright', 'overview/pricinglimits']],
  ['docs.firecrawl.dev', 'product_info', ['contributing/self-host', 'features/interact', 'features/monitor', 'features/map', 'api-reference/introduction', 'sdks/cli', 'mcp-server/local', 'contributing/open-source-or-cloud', 'features/scrape', 'features/crawl']],
  ['www.browserbase.com', 'product_info', ['pricing', 'browsers', 'fetch', 'search', 'runtime', 'identity', 'models', 'observability', 'solutions/accessing-web-data', 'industry/supply-chain']],
  ['www.firecrawl.dev', 'product_info', ['pricing', 'blog/firecrawl-monitoring-launch', 'blog', 'developers', 'enterprise', 'about', 'security', 'terms', 'contact', 'changelog']],
]

const qualitySubset = new Map([
  ['https://developer.mozilla.org/en-US/docs/Web/API/AbortController', [
    { field: 'title', mustContain: ['AbortController'] },
    { field: 'main_content', required: true, mustContain: ['AbortSignal', 'abort'] },
    { field: 'source_url', sourceUrl: 'https://developer.mozilla.org' },
  ]],
  ['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', [
    { field: 'title', mustContain: ['Fetch API'] },
    { field: 'main_content', required: true, mustContain: ['fetch()', 'HTTP'] },
    { field: 'source_url', sourceUrl: 'https://developer.mozilla.org' },
  ]],
  ['https://playwright.dev/docs/locators', [
    { field: 'title', mustContain: ['Locators'] },
    { field: 'main_content', required: true, mustContain: ['getByRole'] },
    { field: 'source_url', sourceUrl: 'https://playwright.dev' },
  ]],
  ['https://www.firecrawl.dev/pricing', [
    { field: 'product_name', mustContain: ['Firecrawl'] },
    { field: 'pricing', required: true, mustContain: ['credits'] },
    { field: 'source_url', sourceUrl: 'https://www.firecrawl.dev' },
  ]],
  ['https://www.browserbase.com/pricing', [
    { field: 'product_name', mustContain: ['Browserbase'] },
    { field: 'pricing', required: true, mustContain: ['Developer Plan', '$20/mo'] },
    { field: 'source_url', sourceUrl: 'https://www.browserbase.com' },
  ]],
  ['https://docs.steel.dev/overview/sessions-api/overview', [
    { field: 'specification', mustContain: ['session'] },
    { field: 'source_url', sourceUrl: 'https://docs.steel.dev' },
  ]],
  ['https://docs.firecrawl.dev/contributing/self-host', [
    { field: 'product_name', mustContain: ['Firecrawl'] },
    { field: 'specification', mustContain: ['Docker', 'Self-host'] },
    { field: 'source_url', sourceUrl: 'https://docs.firecrawl.dev' },
  ]],
  ['https://playwright.dev/docs/library', [
    { field: 'title', mustContain: ['Library'] },
    { field: 'main_content', required: true, mustContain: ['chromium.launch', 'browser.close'] },
    { field: 'source_url', sourceUrl: 'https://playwright.dev' },
  ]],
])

const a5 = JSON.parse(await readFile('research/phase4_real_tasks.json', 'utf8'))
const a5Urls = new Set(a5.tasks.map((task) => task.url))
const a5TunedUrls = new Set(a5.tasks.filter((task) => task.evaluationSet === 'development').map((task) => task.url))

const tasks = []
let index = 0
for (const [host, kind, paths] of hosts) {
  for (const path of paths) {
    index++
    const url = `https://${host}/${path}`
    const quality = qualitySubset.get(url)
    const tuned = a5TunedUrls.has(url)
    const seen = a5Urls.has(url)
    const sampleRole = tuned ? 'development' : seen ? 'regression' : 'independent_holdout'
    tasks.push({
      id: `a6-${String(index).padStart(3, '0')}-${host.replaceAll('.', '-')}`,
      kind,
      url,
      source: `${host} official page`,
      evaluationSet: sampleRole === 'independent_holdout' ? 'holdout' : 'development',
      sampleRole,
      qualitySubset: quality !== undefined,
      repeats: 1,
      assertions: quality ?? [
        { field: 'source_url', sourceUrl: `https://${host}` },
        { field: 'main_content', required: true },
      ],
    })
  }
}

const manifest = {
  version: 'phase4-a6-v0.2-2026-09-21',
  policy: {
    sources: 'public official pages',
    allowedActions: ['GET scrape'],
    login: false,
    formSubmission: false,
    captchaHandling: false,
    holdoutRule: 'independent_holdout pages were not used to tune extraction or assertions; labeled holdout in A6 v0.1 is not treated as independent',
  },
  target: {
    pages: tasks.length,
    domains: hosts.length,
    developmentPages: tasks.filter((task) => task.sampleRole === 'development').length,
    regressionPages: tasks.filter((task) => task.sampleRole === 'regression').length,
    independentHoldoutPages: tasks.filter((task) => task.sampleRole === 'independent_holdout').length,
    qualitySubsetPages: tasks.filter((task) => task.qualitySubset === true).length,
  },
  tasks,
}
await mkdir('research', { recursive: true })
await writeFile('research/phase4_a6_real_tasks.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest.target))
