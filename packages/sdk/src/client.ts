import type {
  CrawlAccepted,
  CrawlReport,
  CrawlStartRequest,
  FetchResult,
  ScrapeRequest,
} from '@w2l/contracts'

export interface W2LOptions {
  baseUrl: string
  token?: string
  fetch?: typeof fetch
}

export class W2L {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: W2LOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
  }

  async scrape(url: string, opts: Omit<ScrapeRequest, 'url'> = {}): Promise<FetchResult> {
    return this.post<FetchResult>('/v1/scrape', { ...opts, url })
  }

  async crawl(url: string, opts: Omit<CrawlStartRequest, 'url'> = {}): Promise<CrawlAccepted> {
    return this.post<CrawlAccepted>('/v1/crawl', { ...opts, url }, 202)
  }

  async getCrawl(id: string): Promise<CrawlReport> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/crawl/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    })
    if (res.status === 404) throw new Error(`crawl not found: ${id}`)
    if (!res.ok) throw new Error(`GET /v1/crawl/${id} failed: ${res.status}`)
    return (await res.json()) as CrawlReport
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token === undefined || this.token.length === 0
      ? extra
      : { ...extra, authorization: `Bearer ${this.token}` }
  }

  private async post<T>(path: string, body: unknown, ok = 200): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (res.status !== ok) {
      const text = await res.text()
      throw new Error(`POST ${path} failed: ${res.status} ${text}`)
    }
    return (await res.json()) as T
  }
}
