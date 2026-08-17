import type { GroundTruth } from '@w2l/contracts'
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import { ALL_BOILERPLATE, htmlPage, prose } from './chrome.js'

export interface FixtureResponse {
  status?: number
  headers?: Record<string, string>
  body?: string | Buffer
  /** Delay before responding, to exercise deadlines. */
  delayMs?: number
  /** Take over the response entirely (streaming, never-ending bodies). */
  handler?: (req: IncomingMessage, res: ServerResponse) => void
}

export interface Fixture {
  /** Ground truth for this case. `target` is the server-relative path. */
  truth: GroundTruth
  respond: (req: IncomingMessage) => FixtureResponse
}

const B = ALL_BOILERPLATE as readonly string[]

const budget = (maxTokens: number, maxWallMs = 10_000, maxAttempts = 2) => ({
  maxTokens,
  maxWallMs,
  maxAttempts,
})

function html(body: string, extra: Partial<FixtureResponse> = {}): FixtureResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Static extraction
// ---------------------------------------------------------------------------

const ARTICLE_FACT = 'The kiln reached 1240 degrees before the glaze vitrified.'
const ARTICLE_FACT_2 = 'Sediment cores from the estuary date to 1873.'

const staticArticle: Fixture = {
  truth: {
    id: 'static-article',
    target: '/static/article',
    kind: 'fixture',
    category: 'static',
    mustContain: [ARTICLE_FACT, ARTICLE_FACT_2],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 260, max: 900 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Baseline: clean semantic article surrounded by full page chrome.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Kiln temperatures and glaze vitrification',
        bodyHtml: `<article>
<h1>Kiln temperatures and glaze vitrification</h1>
<p>${ARTICLE_FACT}</p>
${prose(6, 11)}
<h2>Estuary sediment</h2>
<p>${ARTICLE_FACT_2}</p>
${prose(5, 23)}
</article>`,
      }),
    ),
}

const CJK_FACT = '窑温达到一千二百四十度后釉面开始玻化。'

const staticCjk: Fixture = {
  truth: {
    id: 'static-cjk',
    target: '/static/cjk',
    kind: 'fixture',
    category: 'static',
    mustContain: [CJK_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 60, max: 400 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Guards the CJK path of the token estimator and of content extraction.',
  },
  respond: () =>
    html(
      htmlPage({
        title: '窑温与釉面玻化',
        bodyHtml: `<article>
<h1>窑温与釉面玻化</h1>
<p>${CJK_FACT}</p>
<p>河口沉积物取样显示，最早的一层可追溯到一八七三年。研究者用罗盘和测温计记录了每一次开窑的读数，并把结果抄录在年鉴里。</p>
<p>后续的实验重复了同样的步骤，温度曲线与第一次记录基本一致，误差不超过十五度。</p>
</article>`,
      }),
    ),
}

const TABLE_FACT = 'Tributary flow peaked at 41 cubic metres per second'

const staticTable: Fixture = {
  truth: {
    id: 'static-table',
    target: '/static/table',
    kind: 'fixture',
    category: 'static',
    mustContain: [TABLE_FACT, 'Meridian', '41'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 60, max: 500 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Table content must survive markdown conversion, not be dropped.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Gauging station readings',
        bodyHtml: `<article>
<h1>Gauging station readings</h1>
<p>${TABLE_FACT} during the spring melt.</p>
<table>
<thead><tr><th>Station</th><th>Flow</th><th>Recorded</th></tr></thead>
<tbody>
<tr><td>Meridian</td><td>41</td><td>1873-04-02</td></tr>
<tr><td>Quarry</td><td>28</td><td>1873-04-03</td></tr>
<tr><td>Estuary</td><td>17</td><td>1873-04-05</td></tr>
</tbody>
</table>
${prose(2, 31)}
</article>`,
      }),
    ),
}

const LONG_FACT_HEAD = 'Chapter one begins at the granite plinth.'
const LONG_FACT_TAIL = 'Chapter twelve closes at the bellows house.'

const staticLong: Fixture = {
  truth: {
    id: 'static-long',
    target: '/static/long',
    kind: 'fixture',
    category: 'long_content',
    mustContain: [LONG_FACT_HEAD, LONG_FACT_TAIL],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 3000, max: 20_000 },
    budget: budget(30_000),
    expectedStatus: 'success',
    notes:
      'Tail fact guards against silent truncation: extractors that cut long pages ' +
      'without setting truncatedAt fail check 5.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'A long survey of the works',
        bodyHtml: `<article>
<h1>A long survey of the works</h1>
<p>${LONG_FACT_HEAD}</p>
${prose(60, 41)}
<p>${LONG_FACT_TAIL}</p>
</article>`,
      }),
    ),
}

const LIST_ITEM = 'Cistern maintenance log 07'

const staticList: Fixture = {
  truth: {
    id: 'static-list',
    target: '/static/list',
    kind: 'fixture',
    category: 'listing',
    mustContain: [LIST_ITEM, 'Cistern maintenance log 01'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 40, max: 600 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Index pages have little prose; readability-style extractors often drop them.',
  },
  respond: () => {
    const items = Array.from(
      { length: 12 },
      (_, i) =>
        `<li><a href="/static/log/${i + 1}">Cistern maintenance log ${String(i + 1).padStart(2, '0')}</a> — inspected</li>`,
    ).join('\n')
    return html(
      htmlPage({
        title: 'Maintenance logs',
        bodyHtml: `<main><h1>Maintenance logs</h1><ul>${items}</ul></main>`,
      }),
    )
  },
}

const malformed: Fixture = {
  truth: {
    id: 'static-malformed',
    target: '/static/malformed',
    kind: 'fixture',
    category: 'static',
    mustContain: ['The valve seized in the second winter.'],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 20, max: 400 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Unclosed tags and stray markup must not crash the parser.',
  },
  respond: () =>
    html(`<!doctype html><html><head><title>Broken markup<body>
<div class=unquoted><p>The valve seized in the second winter.
<p>Another paragraph with <b>unclosed bold
<ul><li>one<li>two
<p>Trailing text after a stray </div></span>
`),
}

// ---------------------------------------------------------------------------
// Client-side rendering
// ---------------------------------------------------------------------------

const SPA_FACT = 'Rendered client-side: the almanac lists nine tributaries.'

const spaShell: Fixture = {
  truth: {
    id: 'spa-shell',
    target: '/spa/shell',
    kind: 'fixture',
    category: 'spa',
    mustContain: [SPA_FACT],
    mustNotContain: B,
    expectedLane: 'browser_local',
    emptyIsLegit: false,
    expectedMainTokens: { min: 10, max: 300 },
    budget: budget(2000, 20_000),
    expectedStatus: 'success',
    notes:
      'HTTP lane yields an empty shell; correct behaviour is to escalate to the ' +
      'browser lane. An HTTP-only subject should register failed/empty here, not success.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Almanac viewer',
        bodyHtml: `<div id="root"></div>
<noscript>This application requires JavaScript.</noscript>
<script>
  document.getElementById('root').innerHTML =
    '<article><h1>Almanac viewer</h1><p>${SPA_FACT}</p><p>Nine tributaries feed the estuary basin.</p></article>'
</script>`,
      }),
    ),
}

const SPA_DELAYED_FACT = 'Loaded after a deliberate delay: the ravine gauge reads 12.'

const spaDelayed: Fixture = {
  truth: {
    id: 'spa-delayed',
    target: '/spa/delayed',
    kind: 'fixture',
    category: 'spa',
    mustContain: [SPA_DELAYED_FACT],
    mustNotContain: B,
    expectedLane: 'browser_local',
    emptyIsLegit: false,
    expectedMainTokens: { min: 10, max: 300 },
    budget: budget(2000, 20_000),
    expectedStatus: 'success',
    notes: 'Content appears ~600ms after load; guards premature snapshotting.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Ravine gauge',
        bodyHtml: `<div id="root">Loading…</div>
<script>
  setTimeout(function () {
    document.getElementById('root').innerHTML =
      '<article><h1>Ravine gauge</h1><p>${SPA_DELAYED_FACT}</p></article>'
  }, 600)
</script>`,
      }),
    ),
}

// ---------------------------------------------------------------------------
// Emptiness
// ---------------------------------------------------------------------------

const emptyLegit: Fixture = {
  truth: {
    id: 'empty-legit',
    target: '/empty/legit',
    kind: 'fixture',
    category: 'empty',
    mustContain: [],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: true,
    expectedMainTokens: { min: 0, max: 25 },
    budget: budget(500),
    expectedStatus: 'empty_verified',
    notes:
      'A page that genuinely has no article body. Correct answer is empty_verified, ' +
      'NOT failed — this is the case that separates proven emptiness from suspected.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Section index',
        bodyHtml: `<main><h1>Section index</h1></main>`,
      }),
    ),
}

const emptyBody: Fixture = {
  truth: {
    id: 'empty-body',
    target: '/empty/body',
    kind: 'fixture',
    category: 'empty',
    mustContain: [],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: true,
    expectedMainTokens: { min: 0, max: 5 },
    budget: budget(500),
    expectedStatus: 'empty_verified',
    notes: 'Zero-byte 200 response. Must not be reported as success with empty markdown.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '',
  }),
}

// ---------------------------------------------------------------------------
// Blocking and challenges
// ---------------------------------------------------------------------------

const CHALLENGE_TEXT = 'Just a moment...'

const blockChallenge: Fixture = {
  truth: {
    id: 'block-challenge',
    target: '/block/challenge',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: [CHALLENGE_TEXT, 'Enable JavaScript and cookies to continue'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'blocked',
    notes:
      'The canonical false-success trap: HTTP 403 carrying an interstitial. Returning ' +
      'this text as article content trips check 2 (challenge_text_returned).',
  },
  respond: () => ({
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cf-mitigated': 'challenge' },
    body: `<!doctype html><html><head><title>${CHALLENGE_TEXT}</title></head><body>
<div class="cf-wrapper"><h1>${CHALLENGE_TEXT}</h1>
<p>Enable JavaScript and cookies to continue.</p>
<p>Verifying you are human. This may take a few seconds.</p></div></body></html>`,
  }),
}

const blockChallenge200: Fixture = {
  truth: {
    id: 'block-challenge-200',
    target: '/block/challenge-200',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: [CHALLENGE_TEXT],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'blocked',
    notes:
      'Same interstitial served with HTTP 200 — status-code-only detection fails here. ' +
      'This is where most crawlers report a confident false success.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><title>${CHALLENGE_TEXT}</title></head><body>
<h1>${CHALLENGE_TEXT}</h1><p>Checking your browser before accessing the site.</p>
<p>Enable JavaScript and cookies to continue.</p></body></html>`,
  }),
}

const blockRateLimit: Fixture = {
  truth: {
    id: 'block-rate-limit',
    target: '/block/rate-limit',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: ['Too Many Requests'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 2),
    expectedStatus: 'blocked',
    notes: 'Retry-After must be honoured rather than hammered.',
  },
  respond: () => ({
    status: 429,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '2' },
    body: '<!doctype html><html><body><h1>Too Many Requests</h1></body></html>',
  }),
}

const blockLoginWall: Fixture = {
  truth: {
    id: 'block-login-wall',
    target: '/block/login-wall',
    kind: 'fixture',
    category: 'blocked',
    mustContain: [],
    mustNotContain: ['Sign in to continue reading'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'blocked',
    notes:
      'Tier 1b (user-supplied session) is the correct escalation target; the public ' +
      'canary suite never exercises it.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><title>Sign in</title></head><body>
<h1>Sign in to continue reading</h1>
<form method="post" action="/login"><input name="email"><input name="password" type="password"><button>Sign in</button></form>
</body></html>`,
  }),
}

// ---------------------------------------------------------------------------
// Wrong-page content
// ---------------------------------------------------------------------------

const SOFT404_TEXT = 'We could not find that page'

const soft404: Fixture = {
  truth: {
    id: 'soft-404',
    target: '/wrong/soft-404',
    kind: 'fixture',
    category: 'wrong_page',
    mustContain: [],
    mustNotContain: [SOFT404_TEXT],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'failed',
    notes:
      'HTTP 200 error page. Trips check 4 (wrong_page_content) if returned as success. ' +
      'The random-path probe detects this without annotation.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Not found',
        bodyHtml: `<main><h1>${SOFT404_TEXT}</h1><p>Try searching instead.</p></main>`,
      }),
    ),
}

/** Serves the soft-404 body for any unrouted path, so the probe has something to compare. */
export const SOFT_404_BODY = htmlPage({
  title: 'Not found',
  bodyHtml: `<main><h1>${SOFT404_TEXT}</h1><p>Try searching instead.</p></main>`,
})

const redirectToHome: Fixture = {
  truth: {
    id: 'redirect-to-home',
    target: '/wrong/redirect-home',
    kind: 'fixture',
    category: 'wrong_page',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'failed',
    notes:
      'Requested article silently redirects to the homepage. Content is real but belongs ' +
      'to another URL — check 4 must catch it via the redirect chain.',
  },
  respond: () => ({
    status: 302,
    headers: { location: '/home' },
    body: '',
  }),
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

const REDIRECT_FACT = 'Arrived after three hops.'

const redirectChain: Fixture = {
  truth: {
    id: 'redirect-chain',
    target: '/redirect/chain/3',
    kind: 'fixture',
    category: 'redirect',
    mustContain: [REDIRECT_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 5, max: 200 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Three hops is within the default limit of five.',
  },
  respond: (req) => {
    const n = Number(new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() ?? '0')
    if (n > 0) return { status: 302, headers: { location: `/redirect/chain/${n - 1}` }, body: '' }
    return html(
      htmlPage({
        title: 'Destination',
        bodyHtml: `<article><h1>Destination</h1><p>${REDIRECT_FACT}</p></article>`,
      }),
    )
  },
}

const redirectLoop: Fixture = {
  truth: {
    id: 'redirect-loop',
    target: '/redirect/loop/a',
    kind: 'fixture',
    category: 'redirect',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 1),
    expectedStatus: 'failed',
    notes: 'Must terminate with redirect_loop/redirect_limit, never spin.',
  },
  respond: (req) => {
    const last = (req.url ?? '').endsWith('/a') ? 'b' : 'a'
    return { status: 302, headers: { location: `/redirect/loop/${last}` }, body: '' }
  },
}

// ---------------------------------------------------------------------------
// Timeouts and cancellation
// ---------------------------------------------------------------------------

const slowHeaders: Fixture = {
  truth: {
    id: 'timeout-headers',
    target: '/timeout/headers',
    kind: 'fixture',
    category: 'timeout',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 2000, 1),
    expectedStatus: 'failed',
    notes: 'Never sends headers. Verifies the deadline actually cancels the socket.',
  },
  respond: () => ({
    handler: () => {
      // Deliberately never respond; the client deadline must fire.
    },
  }),
}

const slowBody: Fixture = {
  truth: {
    id: 'timeout-body',
    target: '/timeout/body',
    kind: 'fixture',
    category: 'timeout',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 2000, 1),
    expectedStatus: 'failed',
    notes:
      'Headers arrive immediately, body dribbles forever. Header-only timeouts miss this.',
  },
  respond: () => ({
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.write('<!doctype html><html><body><article><p>start')
      const timer = setInterval(() => res.write('.'), 300)
      res.on('close', () => clearInterval(timer))
    },
  }),
}

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

let zipBombPayload: Buffer | null = null
let hugeBodyPayload: Buffer | null = null

const zipBomb: Fixture = {
  truth: {
    id: 'limit-zip-bomb',
    target: '/limit/zip-bomb',
    kind: 'fixture',
    category: 'resource_limit',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 15_000, 1),
    expectedStatus: 'failed',
    notes:
      'Small gzip payload expanding to ~200MB. Must abort with decompressed_too_large ' +
      'rather than buffering it.',
  },
  respond: () => {
    const body = (zipBombPayload ??= gzipSync(Buffer.alloc(200 * 1024 * 1024, 0x41)))
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-encoding': 'gzip',
      },
      body,
    }
  },
}

const hugeBody: Fixture = {
  truth: {
    id: 'limit-huge-body',
    target: '/limit/huge-body',
    kind: 'fixture',
    category: 'resource_limit',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 15_000, 1),
    expectedStatus: 'failed',
    notes: 'Uncompressed 30MB body exceeds the 10MB default wire cap.',
  },
  respond: () => {
    const body = (hugeBodyPayload ??= Buffer.from(
      '<!doctype html><html><body><p>' + 'x'.repeat(30 * 1024 * 1024) + '</p></body></html>',
      'utf8',
    ))
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body,
    }
  },
}

const nonHtml: Fixture = {
  truth: {
    id: 'limit-non-html',
    target: '/limit/binary',
    kind: 'fixture',
    category: 'resource_limit',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500),
    expectedStatus: 'failed',
    notes: 'A PNG served where HTML was expected must be rejected, not parsed as text.',
  },
  respond: () => ({
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  }),
}

// ---------------------------------------------------------------------------
// Duplicate content (crawl-level dedupe)
// ---------------------------------------------------------------------------

const DUP_FACT = 'This body is served at three distinct URLs.'
const dupBody = htmlPage({
  title: 'Duplicated page',
  bodyHtml: `<article><h1>Duplicated page</h1><p>${DUP_FACT}</p>${prose(3, 71)}</article>`,
})

const duplicateA: Fixture = {
  truth: {
    id: 'duplicate-a',
    target: '/duplicate/a',
    kind: 'fixture',
    category: 'duplicate',
    mustContain: [DUP_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 100, max: 600 },
    budget: budget(2000),
    expectedStatus: 'success',
    notes: 'Identical body to duplicate-b and duplicate-c; content hash must match.',
  },
  respond: () => html(dupBody),
}

const duplicateB: Fixture = {
  ...duplicateA,
  truth: { ...duplicateA.truth, id: 'duplicate-b', target: '/duplicate/b' },
}

const duplicateC: Fixture = {
  ...duplicateA,
  truth: { ...duplicateA.truth, id: 'duplicate-c', target: '/duplicate/c?utm_source=x' },
}

// ---------------------------------------------------------------------------
// HTTP errors
// ---------------------------------------------------------------------------

const http500: Fixture = {
  truth: {
    id: 'error-500',
    target: '/error/500',
    kind: 'fixture',
    category: 'http_error',
    mustContain: [],
    mustNotContain: ['Internal Server Error'],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 2),
    expectedStatus: 'failed',
    notes: 'Retryable server error; body must not be returned as content.',
  },
  respond: () => ({
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><body><h1>Internal Server Error</h1></body></html>',
  }),
}

const http404: Fixture = {
  truth: {
    id: 'error-404',
    target: '/error/404',
    kind: 'fixture',
    category: 'http_error',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(500, 10_000, 1),
    expectedStatus: 'failed',
    notes: 'Honest 404 must not be retried.',
  },
  respond: () => ({
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><body><h1>Not Found</h1></body></html>',
  }),
}

// ---------------------------------------------------------------------------
// Flaky (retry behaviour)
// ---------------------------------------------------------------------------

const FLAKY_FACT = 'Succeeded on the second attempt.'

/**
 * Attempt counter for the flaky fixture. It is global mutable state by necessity —
 * the case exists to test retry behaviour — so anything that fetches it must call
 * `resetFixtureState()` first, or it will observe another caller's attempt number.
 */
let flakyHits = 0

const flaky: Fixture = {
  truth: {
    id: 'flaky-once',
    target: '/flaky/once',
    kind: 'fixture',
    category: 'retry',
    mustContain: [FLAKY_FACT],
    mustNotContain: B,
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 5, max: 200 },
    budget: budget(1000, 10_000, 2),
    expectedStatus: 'success',
    notes:
      'Fails once with 503 then succeeds. Subjects without retry will record failed. ' +
      'Stateful: reset the server between subjects so each starts on attempt 1.',
  },
  respond: () => {
    flakyHits++
    if (flakyHits === 1) {
      return {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!doctype html><html><body><h1>Service Unavailable</h1></body></html>',
      }
    }
    return html(
      htmlPage({
        title: 'Recovered',
        bodyHtml: `<article><h1>Recovered</h1><p>${FLAKY_FACT}</p></article>`,
      }),
    )
  },
}

/** Fixture ids whose response depends on how many times they have already been fetched. */
export const STATEFUL_FIXTURE_IDS: readonly string[] = ['flaky-once']

export function resetFixtureState(): void {
  flakyHits = 0
}

// ---------------------------------------------------------------------------
// Supporting page (redirect target)
// ---------------------------------------------------------------------------

const homePage: Fixture = {
  truth: {
    id: 'home',
    target: '/home',
    kind: 'fixture',
    category: 'support',
    mustContain: ['Welcome to the fixture site'],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: { min: 10, max: 300 },
    budget: budget(1000),
    expectedStatus: 'success',
    notes: 'Redirect target for redirect-to-home. Its own annotation lets check 4 compare.',
  },
  respond: () =>
    html(
      htmlPage({
        title: 'Fixture site',
        bodyHtml: `<main><h1>Welcome to the fixture site</h1><p>Browse the sections to begin.</p></main>`,
      }),
    ),
}

export const FIXTURES: readonly Fixture[] = [
  staticArticle,
  staticCjk,
  staticTable,
  staticLong,
  staticList,
  malformed,
  spaShell,
  spaDelayed,
  emptyLegit,
  emptyBody,
  blockChallenge,
  blockChallenge200,
  blockRateLimit,
  blockLoginWall,
  soft404,
  redirectToHome,
  redirectChain,
  redirectLoop,
  slowHeaders,
  slowBody,
  zipBomb,
  hugeBody,
  nonHtml,
  duplicateA,
  duplicateB,
  duplicateC,
  http500,
  http404,
  flaky,
  homePage,
]

export const SUITE_META = {
  name: 'fixtures',
  version: '0.1.0',
  curatedAt: '2026-08-17',
} as const
