import { mkdir, writeFile } from 'node:fs/promises'

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

const tasks = []
let index = 0
for (const [host, kind, paths] of hosts) {
  for (const path of paths) {
    index++
    const id = `a6-${String(index).padStart(3, '0')}-${host.replaceAll('.', '-')}`
    const holdout = index % 5 === 0
    tasks.push({
      id,
      kind,
      url: `https://${host}/${path}`,
      source: `${host} official page`,
      evaluationSet: holdout ? 'holdout' : 'development',
      repeats: 1,
      assertions: [
        { field: 'source_url', sourceUrl: `https://${host}` },
        { field: 'main_content', required: true },
      ],
    })
  }
}

const manifest = {
  version: 'phase4-a6-v0.1-2026-09-20',
  policy: { sources: 'public official pages', allowedActions: ['GET scrape'], login: false, formSubmission: false, captchaHandling: false, holdoutRule: 'holdout pages are evaluation-only' },
  target: { pages: tasks.length, domains: hosts.length, holdoutPages: tasks.filter((task) => task.evaluationSet === 'holdout').length },
  tasks,
}
await mkdir('research', { recursive: true })
await writeFile('research/phase4_a6_real_tasks.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest.target))
