/** Describes this deployed preview route, not a promise that a remote site will respond. */
export type PreviewSupport = 'beta' | 'conditional' | 'unsupported'
export type PreviewTask = 'readable_page' | 'amazon_sg_product' | 'x_public_post' | 'reddit_public_post'
export type PreviewCaptureMode = 'http' | 'browser_local'

export interface PreviewCapability {
  task: PreviewTask
  support: PreviewSupport
  captureMode: PreviewCaptureMode
  access: 'anonymous_public_page'
  environment: 'cloud_run_public_preview'
  fields: readonly string[]
  limitation: string
  lastValidatedSourceCommit: string | null
}

const PUBLIC_PREVIEW_COMMIT = 'bb32cbf306251de4855b1249416079dc06d2631d'

export function resolvePreviewCapability(target: { url: string; amazonAsin: string | null }): PreviewCapability {
  if (target.amazonAsin !== null) return {
    task: 'amazon_sg_product', support: 'beta', captureMode: 'browser_local',
    access: 'anonymous_public_page', environment: 'cloud_run_public_preview',
    fields: ['readable summary', 'selected ASIN', 'Singapore delivery context', 'SGD quote when verified', 'seller when verified'],
    limitation: 'Only Amazon.sg /dp/{ASIN} is routed to a browser. A selected quote or matching subject is not guaranteed; the 100-product correctness gate remains open.',
    lastValidatedSourceCommit: PUBLIC_PREVIEW_COMMIT,
  }
  const parsed = new URL(target.url)
  const host = parsed.hostname.toLowerCase()
  if ((host === 'x.com' || host === 'www.x.com' || host === 'twitter.com' || host === 'www.twitter.com')
    && /^\/[^/]+\/status\/\d+(?:\/)?$/.test(parsed.pathname)) return {
    task: 'x_public_post', support: 'conditional', captureMode: 'http',
    access: 'anonymous_public_page', environment: 'cloud_run_public_preview',
    fields: ['post text and author only when the requested post is verified'],
    limitation: 'The public preview uses restricted HTTP only. Site policy, login, rendering, or challenges may prevent a post result; a local adapter is not a verified hosted capture path.',
    lastValidatedSourceCommit: null,
  }
  if ((host === 'reddit.com' || host === 'www.reddit.com' || host === 'old.reddit.com')
    && /^\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(parsed.pathname)) return {
    task: 'reddit_public_post', support: 'conditional', captureMode: 'http',
    access: 'anonymous_public_page', environment: 'cloud_run_public_preview',
    fields: ['post and visible comments only when the requested thread is verified'],
    limitation: 'The public preview uses restricted HTTP only. Site policy, login, rendering, or challenges may prevent a result; complete comment pagination is not promised.',
    lastValidatedSourceCommit: null,
  }
  return {
    task: 'readable_page', support: 'conditional', captureMode: 'http',
    access: 'anonymous_public_page', environment: 'cloud_run_public_preview',
    fields: ['readable Markdown', 'final URL', 'status', 'elapsed time'],
    limitation: 'This route uses restricted HTTP without browser rendering. Access and readable content are checked only during extraction; private targets and redirects are blocked.',
    lastValidatedSourceCommit: PUBLIC_PREVIEW_COMMIT,
  }
}
