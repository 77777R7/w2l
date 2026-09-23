import { describe, expect, it } from 'vitest'
import { BUILT_IN_PAGE_ADAPTERS, extractTf } from '../src/index.js'

describe('public site adapter registry', () => {
  it('registers ordered matcher, extractor and validator contracts with generic last', () => {
    expect(BUILT_IN_PAGE_ADAPTERS.map(adapter => adapter.descriptor.id)).toEqual([
      'amazon-product', 'reddit-public', 'x-public', 'generic',
    ])
    expect(BUILT_IN_PAGE_ADAPTERS.every(adapter => typeof adapter.matches === 'function'
      && typeof adapter.extract === 'function'
      && typeof adapter.validate === 'function')).toBe(true)
  })

  it('emits canonical Amazon product fields without recommendation contamination', () => {
    const html = `<!doctype html><html><head><link rel="canonical" href="https://www.amazon.com/dp/B012345678"></head><body>
      <div id="dp-container"><h1 id="productTitle">Subject camera</h1>
      <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$499.00</span></span></div>
      <a id="sellerProfileTriggerId">Camera Shop</a><div id="availability"><span>In Stock</span></div>
      <p id="feature-bullets">The subject camera and its main product description.</p></div>
      <section class="related-products"><a href="/dp/REC0000001">Recommended camera</a><span class="a-price">$29.00</span></section>
    </body></html>`
    const out = extractTf.extract(html, { url: 'https://www.amazon.com/dp/B012345678' })
    expect(out.adapter).toEqual({ id: 'amazon-product', version: '1.0.0', status: 'beta adapter' })
    expect(out.entities).toHaveLength(1)
    expect(out.entities[0]?.type).toBe('product')
    expect(out.entities[0]?.id).toBe('B012345678')
    expect(out.entities[0]?.fields.price?.normalized).toBe('499.00')
    expect(out.adapterValidation?.valid).toBe(true)
    expect(JSON.stringify(out.entities)).not.toContain('29.00')
  })

  it('keeps an Amazon URL-only product identity unverified', () => {
    const out = extractTf.extract('<html><body><div id="dp-container"><h1 id="productTitle">Uncorroborated product</h1></div></body></html>', {
      url: 'https://www.amazon.com/dp/B012345678',
    })
    expect(out.adapterValidation?.valid).toBe(false)
    expect(out.adapterValidation?.issues).toContain('subject_id_unverified')
  })

  it('accepts a selected Amazon variant when canonical names its parent listing', () => {
    const out = extractTf.extract(`<!doctype html><html><head><link rel="canonical" href="https://www.amazon.sg/Parent/dp/B000000002"></head><body>
      <div id="dp-container"><input name="ASIN" value="B000000001"><h1 id="productTitle">Selected blue variant</h1>
      <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">S$15.70</span></span></div>
      <div id="glow-ingress-line2">Singapore 238823</div></div></body></html>`, {
      url: 'https://www.amazon.sg/dp/B000000001',
    })
    expect(out.adapterValidation).toEqual({ valid: true, issues: [] })
    expect(out.entities[0]?.id).toBe('B000000001')
  })

  it('rejects an Amazon page whose selected ASIN conflicts with its URL', () => {
    const out = extractTf.extract(`<!doctype html><html><head><link rel="canonical" href="https://www.amazon.sg/dp/B000000001"></head><body>
      <div id="dp-container"><input name="ASIN" value="B000000002"><h1 id="productTitle">Different selected product</h1></div></body></html>`, {
      url: 'https://www.amazon.sg/dp/B000000001',
    })
    expect(out.adapterValidation?.valid).toBe(false)
    expect(out.adapterValidation?.issues).toContain('asin_mismatch')
  })

  it('extracts a Reddit post and comment parent graph from public hydration', () => {
    const html = `<!doctype html><html><head><title>Example thread</title>
      <script type="application/json">{"post":{"id":"abc123","title":"Adapter design","selftext":"Public post body","author":"alice","score":42,"num_comments":2},"comments":[{"id":"c1","parent_id":"t3_abc123","body":"First","author":"bob","score":3},{"id":"c2","parent_id":"t1_c1","body":"Reply","author":"carol","score":1}]}</script>
      </head><body><main><h1>Adapter design</h1><p>Public post body with enough text for the generic content selector.</p></main></body></html>`
    const out = extractTf.extract(html, { url: 'https://www.reddit.com/r/webscraping/comments/abc123/adapter_design/' })
    expect(out.adapter.id).toBe('reddit-public')
    const post = out.entities.find(entity => entity.type === 'post')
    const thread = out.entities.find(entity => entity.type === 'thread')
    const comments = out.entities.filter(entity => entity.type === 'comment')
    expect(post?.fields.title?.normalized).toBe('Adapter design')
    expect(post?.relationships.community).toBe('webscraping')
    expect(thread?.relationships.comments).toEqual(['c1', 'c2'])
    expect(comments.find(comment => comment.id === 'c2')?.relationships.parent).toBe('c1')
    expect(comments.every(comment => comment.fields.body?.source === 'hydration')).toBe(true)
  })

  it('extracts Reddit community and profile identities from public URLs', () => {
    const community = extractTf.extract('<html><body><main><h1>Web scraping</h1><p>Public community listing with visible posts and descriptions.</p></main></body></html>', { url: 'https://www.reddit.com/r/webscraping/' })
    const profile = extractTf.extract('<html><body><main><h1>alice</h1><p>Public profile content and recent activity.</p></main></body></html>', { url: 'https://www.reddit.com/user/alice/' })
    expect(community.entities).toContainEqual(expect.objectContaining({ type: 'community', id: 'webscraping' }))
    expect(profile.entities).toContainEqual(expect.objectContaining({ type: 'profile', id: 'alice' }))
  })

  it('binds an X post to the status URL and ignores other hydration records', () => {
    const html = `<!doctype html><html><head><title>Public post</title>
      <script id="__NEXT_DATA__" type="application/json">{"tweets":[{"rest_id":"111","legacy":{"full_text":"Wrong recommended post"}},{"rest_id":"222","legacy":{"full_text":"The subject public post"}}]}</script>
      </head><body><main><article data-testid="tweet"><a href="/alice/status/222"><time datetime="2026-09-22T10:00:00Z"></time></a><div data-testid="tweetText">The subject public post</div></article></main></body></html>`
    const out = extractTf.extract(html, { url: 'https://x.com/alice/status/222' })
    expect(out.adapter.id).toBe('x-public')
    const post = out.entities.find(entity => entity.type === 'post')
    expect(post?.id).toBe('222')
    expect(post?.fields.text?.normalized).toBe('The subject public post')
    expect(post?.fields.text?.source).toBe('hydration')
    expect(JSON.stringify(post)).not.toContain('Wrong recommended post')
  })

  it('does not substitute another X post when the requested status is absent', () => {
    const html = `<html><head><script type="application/json">{"tweets":[{"rest_id":"111","legacy":{"full_text":"Wrong"}}]}</script></head>
      <body><article data-testid="tweet"><a href="/alice/status/111">Wrong</a><div data-testid="tweetText">Wrong</div></article></body></html>`
    const out = extractTf.extract(html, { url: 'https://x.com/alice/status/222' })
    expect(out.entities).toEqual([])
    expect(out.adapterValidation).toEqual({ valid: false, issues: ['missing_post', 'missing_thread'] })
  })

  it('excludes cross-post and orphan Reddit comments, including transitive descendants', () => {
    const html = `<html><head><script type="application/json">{"post":{"id":"abc123","title":"Target","selftext":"Target body"},
      "comments":[{"id":"c1","parent_id":"t3_abc123","body":"On target"},
      {"id":"c2","parent_id":"t1_c1","body":"Reply on target"},
      {"id":"other","parent_id":"t3_xyz999","body":"Other post"},
      {"id":"otherReply","parent_id":"t1_other","body":"Other reply"},
      {"id":"orphan","parent_id":"t1_missing","body":"Orphan"}]}</script></head>
      <body><main><h1>Target</h1></main></body></html>`
    const out = extractTf.extract(html, { url: 'https://www.reddit.com/r/webscraping/comments/abc123/target/' })
    expect(out.entities.filter(entity => entity.type === 'comment').map(entity => entity.id)).toEqual(['c1', 'c2'])
    expect(out.entities.find(entity => entity.type === 'thread')?.relationships.comments).toEqual(['c1', 'c2'])
    expect(JSON.stringify(out.entities)).not.toMatch(/Other post|Other reply|Orphan/)
  })

  it('does not invent a Reddit post from the URL when the target page is absent', () => {
    const out = extractTf.extract('<html><body><h1>Unavailable</h1><shreddit-post post-id="other"><h1>Other</h1></shreddit-post></body></html>', {
      url: 'https://www.reddit.com/r/webscraping/comments/abc123/target/',
    })
    expect(out.entities).toEqual([])
    expect(out.adapterValidation?.valid).toBe(false)
  })
})
