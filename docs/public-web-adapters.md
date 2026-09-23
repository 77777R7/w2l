# Public Web Adapters

W2L remains a public-web capture product. Amazon, Reddit, X, and later site adapters do not call official platform APIs and do not require platform API keys. Official API documentation may be used to understand field and pagination models or to compare results, but it is not on the runtime success path.

The capture order is ordinary HTTP, embedded JSON-LD/microdata/hydration data, content loaded by a normal public browser session, then DOM parsing. A user-authorized session may read pages that user can already view. W2L does not replay protected private endpoints, copy access tokens, bypass login, or solve CAPTCHA. A login wall or challenge is a blocked result, not partial success.

## Contract

Adapters implement URL/page matching and return the shared entity types `product`, `post`, `thread`, `comment`, `profile`, `community`, `video`, or `article`. Fields include the observed value, normalized value, evidence source, page location, and confirmation status. Evidence sources are `jsonld`, `microdata`, `meta`, `hydration`, and `dom`.

The registry currently contains:

| Adapter | Status | Current coverage |
|---|---|---|
| `amazon-product@1.0.0` | beta adapter | `/dp` and `/gp/product` identity, physical/subscription offers, seller, stock, delivery context, variants, ratings, specifications and subject images; recommendation regions excluded |
| `reddit-public@1.0.0` | beta adapter | public post/thread, comment parent graph, Subreddit identity and public profile identity |
| `x-public@1.0.0` | beta adapter | public status/thread and public profile; search, history timelines and large reply discovery remain out of scope |
| `generic@1.0.0` | generic | main-content Markdown with honest empty/block failures |

Beta means the adapter has deterministic snapshot and contract coverage but has not passed its full real-site promotion gate. Amazon is promoted only after the fixed 10 URLs, 100 holdout products and 1000-page reliability run pass. Reddit needs 20 fixed and 100 holdout pages. X remains beta unless 20 public URLs reach the stated accessibility gate without false success.

## MCP formats and subject validation

`scrape.formats` accepts `markdown`, `links`, canonical `json`, or a caller-supplied JSON Schema object (`{type:"json",schema,...}`). `includeLinks` also controls links. With no explicit format, the compact MCP request returns canonical JSON for a verified adapter entity and Markdown for a generic page. `debug` defaults to false. Explicit formats always take precedence.

Canonical consumers read `json.data.entities[]`, including `type`, `id`, `fields`, and `relationships`. The adapter checks target identity before structured publication: when the requested X status or Reddit post is absent, `json.status` is `incomplete` with `subject_unverified` issues. A URL alone is not page-content proof. Reddit comments must have a parent chain ending at the target post. `debug: true` exposes the full route, attempts, and timing for diagnosis.

REST/SDK calls that omit both `formats` and `debug` keep their previous full Markdown-and-links response. The MCP still exposes its five durable batch tools.

## Reproducible Amazon gates

The repository includes the fixed ten-URL manifest, an anonymous public preference setup, and a runner that invokes W2L through stdio MCP → local API → public browser capture:

```bash
node scripts/section-b/amazon-public-state.mjs
npm run baseline:amazon -- --concurrency 1
npm run baseline:amazon -- --concurrency 2
```

Concurrency 4 is attempted only after 1 and 2 show comparable regions/currencies and no abnormal blocks. The setup uses a fresh, unsigned-in browser to select Singapore 238823 and SGD on Amazon's public page. It writes Amazon-only state to the ignored `.w2l/amazon-baseline/anonymous-public-state.json`; the report records its hash, never cookie values. Only the benchmark API loads this state; ordinary `standard` requests keep their existing session rules. The benchmark uses one public browser channel so its requests all receive the same anonymous preference, and labels that route in its report. The fixed Amazon.com URLs, Schema hash, language, egress label and identity are recorded. Blocks, retries and mismatches remain in the raw report and prevent acceptance.

The [earlier dirty-tree run](../research/amazon-product-baseline-2026-09-23.md) is historical failure evidence, not the integrated branch's baseline. The ten-product field gate requires separate visible-field coverage and accuracy of at least 98%, all target ASINs correct, no recommendation leakage, and Howard's review signature. Amazon remains beta even if ten products pass; 100 unseen products and 1000-page reliability are later promotion gates.

The [frozen integration run](evidence/amazon-adapter-integration-2026-09-23.md) has comparable three-round 10-product results and meets the speed/compact-response engineering gates at limited concurrency. Its raw-HTML field comparison is an unsigned candidate; the human field gate remains open.

The 10 and 100 runs assess subject identity and field accuracy. The 1000 run assesses throughput, rate limits, cancellation, retry and recovery. A large run cannot compensate for wrong subject boundaries or recommendation leakage.

## Next adapters

After Amazon, Reddit and X pass their own gates, candidates are scored monthly by demand, repeat value, cross-site reuse, public accessibility, maintenance cost and verifiability. The current research order is YouTube, Shopify, Google Search/Maps, Walmart and Indeed. LinkedIn, Instagram and TikTok stay in the later validation pool because public access and maintenance costs are less predictable.
