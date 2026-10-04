import { describe, expect, it, vi } from 'vitest'
import { extractTf, htmlToMarkdown, wholePageBody, withoutLayoutMarkers } from '../src/index.js'

const ARTICLE = `<!doctype html><html><head><title>Kiln temperatures and glaze vitrification</title></head>
<body>
<div id="cookie-consent" role="dialog"><p>We use cookies to personalise content.</p><button>Accept all</button></div>
<nav class="site-nav"><a href="/">Home</a> <a href="/pricing">Pricing</a></nav>
<article>
<h1>Kiln temperatures and glaze vitrification</h1>
<p>The kiln reached 1240 degrees before the glaze vitrified. Every reading was logged in the ledger kept by the harbour office.</p>
<p>Sediment cores from the estuary date to 1873. Researchers compared them against the almanac kept at the plinth house.</p>
<p>Later experiments repeated the same steps, and the temperature curve matched the first recording within fifteen degrees.</p>
</article>
<aside class="sidebar"><h3>Trending</h3><ul><li><a href="/a">Unrelated link A</a></li></ul></aside>
<footer><p>Copyright 2026 Synthetic Fixture Co. All rights reserved.</p></footer>
</body></html>`

describe('extractTf', () => {
  it('extracts the article, its title, and none of the boilerplate', () => {
    const out = extractTf.extract(ARTICLE)
    expect(out.title).toBe('Kiln temperatures and glaze vitrification')
    expect(out.mainHtml).toContain('The kiln reached 1240 degrees')
    expect(out.mainHtml).toContain('Sediment cores from the estuary date to 1873.')
    expect(out.mainHtml).not.toContain('We use cookies')
    expect(out.mainHtml).not.toContain('Pricing')
    expect(out.mainHtml).not.toContain('Copyright 2026')
    expect(out.mainHtml).not.toContain('Trending')
    expect(out.escalate).toBe(false)
    expect(out.confidence).toBeGreaterThan(0.5)
  })

  it('handles CJK prose without requiring sentence-final punctuation', () => {
    const html = `<!doctype html><html><body><article>
<h1>窑温与釉面玻化</h1>
<p>窑温达到一千二百四十度后釉面开始玻化。研究者用罗盘和测温计记录了每一次开窑的读数，并把结果抄录在年鉴里。</p>
<p>后续的实验重复了同样的步骤，温度曲线与第一次记录基本一致，误差不超过十五度。</p>
</article></body></html>`
    const out = extractTf.extract(html)
    expect(out.title).toBe('窑温与釉面玻化')
    expect(out.mainHtml).toContain('窑温达到一千二百四十度')
    expect(out.escalate).toBe(false)
  })

  it('survives malformed markup and still finds the fact', () => {
    const html = `<!doctype html><html><head><title>Broken</title></head><body>
<div class=unquoted><p>The valve seized in the second winter.
<p>Another paragraph with <b>unclosed bold
<ul><li>one<li>two
<p>Trailing text after a stray </div></span>
</body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('The valve seized in the second winter.')
  })

  it('prunes cookie banners by id even when they precede content', () => {
    const html = `<!doctype html><html><body>
<div id="onetrust-banner-sdk"><p>Manage your privacy settings</p></div>
<article><h1>Report</h1><p>The survey covers forty villages and three hundred households in the upper valley.</p></article>
</body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('The survey covers forty villages')
    expect(out.mainHtml).not.toContain('Manage your privacy')
  })

  it('escalates on a page with no prose at all', () => {
    const out = extractTf.extract('<!doctype html><html><body><div id="root"></div></body></html>')
    expect(out.escalate).toBe(true)
    expect(out.mainHtml).toBe('')
  })

  it('keeps a card listing whose short texts the article cascade cannot see', () => {
    // books.toscrape.com's Art category: eight cards of title link, price and
    // stock, no pager, and a category name too short to be a block.
    const card = (slug: string, title: string, price: string) => `<li class="col-xs-6 col-sm-4 col-md-3 col-lg-3"><article class="product_pod">
<div class="image_container"><a href="../../../${slug}/index.html"><img src="../../../../media/cache/${slug}.jpg" alt="${title}" class="thumbnail"></a></div>
<p class="star-rating Four"><i class="icon-star"></i><i class="icon-star"></i></p>
<h3><a href="../../../${slug}/index.html" title="${title}">${title}</a></h3>
<div class="product_price"><p class="price_color">${price}</p><p class="instock availability"><i class="icon-ok"></i> In stock</p>
<form><button type="submit" class="btn btn-primary btn-block">Add to basket</button></form></div>
</article></li>`
    const html = `<!doctype html><html><head><title>Art | Books to Scrape - Sandbox</title></head><body>
<header class="header container-fluid"><div class="row"><div class="col-sm-8 h1"><a href="../../../../index.html">Books to Scrape</a><small> We love being scraped!</small></div></div></header>
<div class="container-fluid page"><div class="page_inner">
<ul class="breadcrumb"><li><a href="../../../../index.html">Home</a></li><li><a href="../../books_1/index.html">Books</a></li><li class="active">Art</li></ul>
<div class="row">
<aside class="sidebar col-sm-4 col-md-3"><ul class="nav nav-list"><li><a href="../travel_2/index.html">Travel</a></li><li><a href="../mystery_3/index.html">Mystery</a></li></ul></aside>
<div class="col-sm-8 col-md-9">
<div class="page-header action"><h1>Art</h1></div>
<form method="get" class="form-horizontal"><strong>8</strong> results.</form>
<section><div class="alert alert-warning" role="alert"><strong>Warning!</strong> This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.</div>
<div><ol class="row">
${card('wall-and-piece_971', 'Wall and Piece', '£44.18')}
${card('history-of-beauty_521', 'History of Beauty', '£10.29')}
${card('the-story-of-art_500', 'The Story of Art', '£41.14')}
${card('ways-of-seeing_94', 'Ways of Seeing', '£44.46')}
</ol></div></section>
</div></div></div></div>
<footer class="footer container-fluid"></footer>
</body></html>`
    const out = extractTf.extract(html, { url: 'https://books.toscrape.com/catalogue/category/books/art_25/index.html' })
    expect(out.escalate).toBe(false)
    expect(out.strategy).toBe('list')
    expect(out.mainHtml).toContain('<h1>Art</h1>')
    expect(out.mainHtml).toContain('This is a demo website')
    expect(out.mainHtml).toContain('Wall and Piece')
    expect(out.mainHtml).toContain('£44.46')
    expect(out.mainHtml).not.toContain('Mystery')
    expect(out.mainHtml).not.toContain('We love being scraped')
  })

  it('keeps a home page of linked cards with short descriptions', () => {
    // data.gov.uk's home page: headings, card links and descriptions without
    // sentence punctuation, so not one block qualifies as prose.
    const item = (slug: string, name: string, about: string) => `<div class="datagovuk-home-collections__item">
<img src="/assets/images/collections/badge-${slug}.png" width="108" height="108" alt="" class="datagovuk-home-collections__item-image" />
<div class="datagovuk-home-collections__item-content"><h3 class="govuk-body"><a href="/collections/${slug}" class="govuk-link">${name}</a></h3>
<p class="govuk-body datagovuk-!-colour-grey">${about}</p></div></div>`
    const html = `<!doctype html><html lang="en"><head><title>National Data Library - The home of UK public data - data.gov.uk</title></head><body>
<header role="banner" class="datagovuk-header"><div class="govuk-width-container">
<a class="datagovuk-header__logo-link" href="/"><img src="/assets/images/logo-ndl.svg" alt="Home" /></a>
<div class="datagovuk-menu" id="datagovuk-menu-data-manual"><h2 class="datagovuk-menu__heading">Data manual</h2><div class="datagovuk-menu__items">
<a href="/data-manual/who-this-manual-is-for/" class="govuk-link">Who this manual is for</a><a href="/data-manual/data-management/" class="govuk-link">Data management</a><a href="/data-manual/data-standards/" class="govuk-link">Data standards</a>
</div></div></div></header>
<main id="main" class="datagovuk-main"><div class="govuk-width-container">
<div class="datagovuk-home-hero"><h1 class="govuk-heading-xl">The home of UK public data to inform decisions and build services</h1>
<p class="govuk-body"><a href="/roadmap/" class="govuk-link">Find out more about the National Data Library</a></p></div>
<div class="datagovuk-home-collections"><h2 class="govuk-heading-l">Collections</h2>
<p class="govuk-body">Curated collections of high-quality, accessible data</p>
<div class="datagovuk-home-collections__items">
${item('business-and-economy', 'Business and economy', 'Company information, prices, trade, economic indicators')}
${item('environment', 'Environment', 'Nature, climate, floods, mapping')}
${item('people', 'People', 'Population, health, immigration, social mobility')}
${item('transport', 'Transport', 'Roads, driving, public transport, shipping')}
</div></div>
<div class="datagovuk-home-publications"><h2 class="govuk-heading-l">Updates</h2><div class="datagovuk-home-publications__items">
<div class="govuk-body datagovuk-home-publications__item"><a href="https://dataingovernment.blog.gov.uk/2026/03/25/whats-changing-on-data-gov-uk-and-why/" class="govuk-link">What's changing on data.gov.uk and why</a><p class="govuk-body">25 March 2026</p></div>
</div></div>
</div></main>
<footer class="govuk-footer"><a href="/accessibility">Accessibility</a></footer>
</body></html>`
    const out = extractTf.extract(html, { url: 'https://www.data.gov.uk/' })
    expect(out.escalate).toBe(false)
    expect(out.mainHtml).toContain('The home of UK public data')
    expect(out.mainHtml).toContain('Company information, prices, trade, economic indicators')
    expect(out.mainHtml).toContain('25 March 2026')
    expect(out.mainHtml).not.toContain('Who this manual is for')
  })

  it('still escalates a shell whose only list is a link-only menu', () => {
    // Menu items carry nothing but their link: navigation, not a listing.
    const menu = ['Products', 'Pricing', 'Customers', 'Careers', 'Contact'].map((name) => `<li><a href="/${name.toLowerCase()}">${name}</a></li>`).join('')
    for (const body of [
      `<div class="menu"><ul>${menu}</ul></div><div id="root"></div>`,
      `<div class="page"><h1>Dashboard</h1><div class="menu"><ul>${menu}</ul></div><div id="root">Loading…</div></div>`,
    ]) {
      const out = extractTf.extract(`<!doctype html><html><head><title>App</title></head><body>${body}</body></html>`)
      expect(out.escalate).toBe(true)
      expect(out.mainHtml).toBe('')
    }
  })

  it('keeps a page whose only paragraph sits directly in <body>', () => {
    // example.com's markup as served on 2026-09-29.
    const html = `<!doctype html><html lang=en><head><title>Example Domain</title></head><body><p>This domain is for use in documentation examples without needing permission. This is not a service, avoid relying on it for testing and monitoring purposes.</p><a href=https://iana.org/help/example-domains>Learn more</a></body></html>`
    const out = extractTf.extract(html)
    expect(out.escalate).toBe(false)
    expect(out.mainHtml).toContain('This domain is for use in documentation examples')
  })

  it('keeps a release held in one long <pre> inside nested wrappers', () => {
    const release = Array.from({ length: 12 }, (_, i) =>
      `Line ${i + 1}: Total nonfarm payroll employment increased by 162,000 in August, and the rate held at 4.1 percent.`).join('\n')
    const html = `<!doctype html><html><head><title>Employment Situation Summary</title></head><body>
<div class="helpFormSection"><p>Are you a survey respondent and need help submitting your data?</p></div>
<div class="helpFormSection"><p>Do you have questions about the monthly estimates?</p></div>
<div id="wrapper"><div id="main-content"><div id="bodytext"><div class="normalnews"><figure><pre>${release}</pre></figure></div></div></div></div>
</body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('Line 12: Total nonfarm payroll employment')
    expect(out.mainHtml).not.toContain('survey respondent')
  })

  it('keeps the text of a filing laid out as divs around its tables, without its hidden XBRL header', () => {
    // An SEC EDGAR inline XBRL filing's shape (IREN's 10-Q, parity case A36):
    // XBRL facts in a hidden <div>, then the document as sibling <div>s of the
    // body, with no <p>, heading or list, tables with spacer cells, and notes
    // wrapped in inline ix: elements.
    const div = (text: string) => `<div style="margin-bottom:12pt;text-align:justify"><span style="font-size:10pt">${text}</span></div>`
    const table = (rows: string[][]) => `<div><table style="border-collapse:collapse;width:100%"><tr>${rows[0]!.map(() => '<td style="width:1%"></td>').join('')}</tr>` +
      rows.map((row) => `<tr>${row.map((cell) => `<td>${cell && `<span>${cell}</span>`}</td>`).join('')}</tr>`).join('') + '</table></div>'
    const html = `<?xml version='1.0' encoding='ASCII'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance"><head><title>hkl-20251231</title></head><body>
<div style="display:none"><ix:header><ix:hidden><ix:nonNumeric name="dei:EntityCentralIndexKey" contextRef="c-1">0009990001</ix:nonNumeric></ix:hidden>
<ix:resources><xbrli:context id="c-1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0009990001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context></ix:resources></ix:header></div>
<div style="text-align:center"><span style="font-weight:700">FORM <ix:nonNumeric name="dei:DocumentType" contextRef="c-1">10-Q</ix:nonNumeric></span></div>
<div style="text-align:center"><span style="font-weight:700"><ix:nonNumeric name="dei:EntityRegistrantName" contextRef="c-1">Harbour Kiln Limited</ix:nonNumeric></span></div>
${table([['x', 'QUARTERLY REPORT PURSUANT TO SECTION 13 OR 15(d)']])}
${div('Item 2. Management’s discussion and analysis of financial condition and results of operations.')}
${div('Revenue rose in the quarter because the second kiln line reached full output in October. The harbour office recorded every firing in its ledger.')}
${div('Operating costs rose less than revenue, as clay and fuel were bought under the contracts signed in the previous year.')}
${div('The Group expects to fund the third kiln line from cash on hand and from the credit facility described in Note 5.')}
${table([['', 'Three months ended', '', 'Six months ended'], ['', '2025', '2024', '2025', '2024'], ['Revenue', '1,204', '987', '2,318', '1,902'], ['Cost of revenue', '(611)', '(540)', '(1,190)', '(1,061)'], ['Net income', '402', '301', '768', '577']])}
<hr style="page-break-after:always"/>
<ix:nonNumeric name="us-gaap:SignificantAccountingPoliciesTextBlock" contextRef="c-1" escape="true">${div('Note 2. Summary of significant accounting policies')}
${div('The condensed financial statements were prepared on the same basis as the annual statements, and all normal recurring adjustments were made.')}
${div('Kiln equipment is depreciated on a straight-line basis over its useful life of twelve years.')}</ix:nonNumeric>
<div style="text-align:center"><span>7</span></div>
</body></html>`
    const out = extractTf.extract(html, { url: 'https://www.sec.gov/Archives/edgar/data/9990001/000999000126000001/hkl-20251231.htm' })
    const md = htmlToMarkdown(out.mainHtml, { baseUrl: out.baseUrl })
    for (const text of [
      'Harbour Kiln Limited',
      'Revenue rose in the quarter because the second kiln line reached full output in October.',
      'the credit facility described in Note 5.',
      'Note 2. Summary of significant accounting policies',
      'useful life of twelve years.',
      '| Net income | 402 | 301 | 768 | 577 |',
    ]) expect(md).toContain(text)
    expect(md).not.toContain('0009990001')
    expect(md).not.toContain('2025-07-01')
    expect(out.mainHtml).not.toContain('0009990001')
    expect(out.strategy).toBe('article')
  })

  it('keeps a data table that a table viewer wraps in its form', () => {
    const rows = ['Canada', 'Ontario', 'Quebec', 'British Columbia'].map((geo, i) =>
      `<tr><th>${geo}</th><td>${(41_000_000 - i * 9_000_000).toLocaleString('en-US')}</td></tr>`).join('')
    const html = `<!doctype html><html><body><main>
<h1>Population estimates, quarterly</h1>
<form id="viewForm"><label for="ref">Reference period</label><select id="ref"><option>2026</option></select><button>Apply</button>
<div id="viewHtml"><table><thead><tr><th>Geography</th><th>July 1, 2026</th></tr></thead><tbody>${rows}</tbody></table></div>
</form></main></body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('British Columbia')
    expect(out.mainHtml).toContain('14,000,000')
    expect(out.mainHtml).not.toContain('Apply')
  })

  it('still drops a short comment form', () => {
    const html = `<!doctype html><html><body><article>
<h1>Kiln temperatures</h1>
<p>The kiln reached 1240 degrees before the glaze vitrified. Every reading was logged in the ledger kept by the harbour office.</p>
<form class="comment-form"><p>Leave a reply. Your email address will not be published.</p><textarea></textarea><button>Post comment</button></form>
</article></body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('The kiln reached 1240 degrees')
    expect(out.mainHtml).not.toContain('Leave a reply')
  })

  it('reads label/value pairs from two-cell rows and definition lists in the main content', () => {
    const html = `<!doctype html><html><body>
<aside><table><tr><th>Sidebar label</th><td>not main content</td></tr></table></aside>
<article><h1>A Light in the Attic</h1>
<p>A collection of poems and line drawings for readers of every age, reissued as an anniversary edition.</p>
<table class="table table-striped">
<tr><th>UPC</th><td>a897fe39b1053632</td></tr>
<tr><th>Price (excl. tax)</th><td>£51.77</td></tr>
<tr><th>Availability</th>
<td>In stock
  (22 available)</td></tr>
</table>
<table><tr><th>Year</th><th>Copies</th></tr><tr><th>2023</th><td>12</td><td>14</td></tr><tr><td>Reprint</td><td>yes</td></tr></table>
<dl><div><dt>Unit</dt><dd>tonnes per person</dd></div><div><dt>Date range</dt><dd>1750-2024</dd></div><dt>Managed by</dt><dd>Pablo</dd><dd>Hannah</dd></dl>
</article></body></html>`
    expect(extractTf.extract(html).labelledValues).toEqual([
      { label: 'UPC', value: 'a897fe39b1053632', path: 'table[0] tr[0]' },
      { label: 'Price (excl. tax)', value: '£51.77', path: 'table[0] tr[1]' },
      { label: 'Availability', value: 'In stock (22 available)', path: 'table[0] tr[2]' },
      { label: 'Unit', value: 'tonnes per person', path: 'dl[0] dt[0]' },
      { label: 'Date range', value: '1750-2024', path: 'dl[0] dt[1]' },
    ])
    expect(extractTf.extract('<!doctype html><html><body><div id="root"></div></body></html>').labelledValues).toEqual([])
  })

  it('counts tables whose rows a script has yet to fill', () => {
    const html = `<!doctype html><html><body><main><h1>Population estimates, quarterly</h1>
<p>Table 17-10-0009-01. Release date 2026-09-23. Frequency: quarterly. Geography: Canada, province or territory.</p>
<table id="simpleTable"><thead id="simpleTableHeader"></thead><tbody id="simpleTableBody"></tbody></table>
</main></body></html>`
    expect(extractTf.extract(html).emptyTableShells).toBe(1)
    expect(extractTf.extract(ARTICLE).emptyTableShells).toBe(0)
  })

  it('counts data the page declares its scripts will fetch', () => {
    // ourworldindata.org's table view: the server renders the description and
    // a picture of the chart; the table is built from the preloaded JSON.
    const html = `<!doctype html><html><head><title>CO₂ emissions per capita | Our World in Data</title>
<link rel="preload" href="https://api.ourworldindata.org/v1/indicators/1119914.data.json" as="fetch" crossorigin="anonymous"/>
<link rel="preload" href="/fonts/LatoLatin-Regular.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>
<link rel="modulepreload" href="/assets/owid.mjs"/><link rel="stylesheet" href="/assets/owid.css"/>
</head><body><main><figure class="chart"><picture><img src="/grapher/co-emissions-per-capita.png?tab=table" width="850" height="600" loading="lazy"/></picture></figure>
<h2>CO₂ emissions per capita</h2><p>Carbon dioxide emissions from burning fossil fuels and industrial processes. This includes emissions from transport, electricity generation, and heating, but not land-use change.</p>
</main></body></html>`
    expect(extractTf.extract(html).fetchPreloads).toBe(1)
    expect(extractTf.extract(ARTICLE).fetchPreloads).toBe(0)
  })

  it('flags a table shell beside scripts as client-rendered, not a static empty table', () => {
    // A statistics table viewer (StatCan): prose, a table whose rows a script
    // fills in after load, and the viewer's scripts.
    const prose = '<p>The table below lists the monthly consumer price index by geography and product group for the reference period.</p>'
    const shell = `<!doctype html><html><body><main><h1>Table 18-10-0006-01</h1>${prose}<table id="grid"><thead><tr></tr></thead><tbody><tr></tr></tbody></table><script>${'y'.repeat(1_500)}</script></main></body></html>`
    expect(extractTf.extract(shell).render).toMatchObject({ clientRendered: true, reason: 'empty_table_with_scripts', emptyTables: 1, scriptChars: 1_500 })

    const stat = `<!doctype html><html><body><article><h1>Empty table</h1>${prose}<table></table><p>Text after the table.</p></article></body></html>`
    expect(extractTf.extract(stat).render).toMatchObject({ clientRendered: false, reason: null, emptyTables: 1, scriptChars: 0, markers: [] })
  })

  it('flags an explicit JavaScript fallback when script outweighs text', () => {
    // ourworldindata.org's grapher: a fallback picture the page hides once
    // its scripts run, beside the chart's configuration blob.
    const html = `<!doctype html><html><body><main><h1>Emissions per capita</h1>
<p>Carbon dioxide emissions per person, measured in tonnes per year across the selected countries.</p>
<figure class="GrapherWithFallback__fallback"><picture class="js--hide-if-js-enabled"><img src="/fallback.png" alt=""></picture></figure>
<script>window._OWID_GRAPHER_CONFIG = {${'"k":1,'.repeat(300)}"tab":"table"}</script>
</main></body></html>`
    const out = extractTf.extract(html)
    expect(out.render).toMatchObject({ clientRendered: true, reason: 'js_fallback', markers: ['hydration_state', 'js_fallback_marker'] })
    expect(out.escalate).toBe(false)
  })

  it('still escalates a script shell and flags it as client-rendered', () => {
    const html = `<!doctype html><html><body><div id="root">Loading…</div><script>${'x'.repeat(3_000)}</script></body></html>`
    const out = extractTf.extract(html)
    expect(out.escalate).toBe(true)
    expect(out.mainHtml).toBe('')
    expect(out.render).toMatchObject({ clientRendered: true, reason: 'empty_app_root', markers: ['app_root_empty'] })
  })

  it('does not take a long static page with a noscript notice for a shell', () => {
    // GOV.UK's reports carry a generic "enable JavaScript" line beside their
    // analytics scripts: a notice alone counts only on a thin page.
    const paragraph = (i: number) => `<p>Paragraph ${i}: household consumption in the region rose in the quarter, led by spending on transport and recreation, while spending on housing was flat.</p>`
    const page = (paragraphs: number) => `<!doctype html><html><body><noscript><p>Please enable JavaScript to use this site.</p></noscript>
<main><h1>Subnational consumption</h1>${Array.from({ length: paragraphs }, (_, i) => paragraph(i + 1)).join('\n')}</main>
<script>${'z'.repeat(6_000)}</script></body></html>`
    const report = extractTf.extract(page(30)).render
    expect(report).toMatchObject({ clientRendered: false, reason: null, markers: ['noscript_notice'], scriptChars: 6_000 })
    expect(report?.textChars).toBeGreaterThan(1_500)
    // The same notice on a thin page is what a script-filled shell looks like.
    expect(extractTf.extract(page(3)).render).toMatchObject({ clientRendered: true, reason: 'js_fallback' })
  })

  it('filters link-farm paragraphs by link density', () => {
    const html = `<!doctype html><html><body><article>
<h1>Directory</h1>
<p><a href="/a">Alpha link one</a> <a href="/b">Beta link two</a> <a href="/c">Gamma link three</a></p>
<p>This paragraph carries real prose about the harbour and its many lighthouses that guide ships home.</p>
</article></body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('real prose about the harbour')
  })

  it('favorPrecision and favorRecall pick different containers', () => {
    // <article> holds several short blocks (below the precision threshold but
    // above the recall threshold); a div holds one long block. Under
    // favorPrecision the short blocks are filtered out and the div wins;
    // under favorRecall the article's semantic bonus dominates.
    const html = `<!doctype html><html><body>
<article><h1>Fragments</h1>
<p>Short observation number one here.</p>
<p>Short observation number two here.</p>
<p>Short observation number three here.</p>
</article>
<div><p>This is a properly long paragraph with real prose content that should dominate precision filtering without any trouble at all.</p></div>
</body></html>`
    const precise = extractTf.extract(html, { favorPrecision: true })
    const recalled = extractTf.extract(html, { favorRecall: true })
    expect(precise.mainHtml).toContain('dominate precision filtering')
    expect(recalled.mainHtml).toContain('Short observation number one')
  })

  it('leaves out what a browser capture marked hidden', () => {
    const menu = 'The collapsed mobile menu repeats every section title of the site in long sentences that no reader of the desktop page sees.'
    const html = `<!doctype html><html><body>
<div class="menu" data-w2l-hidden=""><p>${menu}</p><p>${menu}</p><p>${menu}</p></div>
<div class="report"><p>The survey covers forty villages and three hundred households in the upper valley.</p></div>
</body></html>`
    const out = extractTf.extract(html)
    expect(out.mainHtml).toContain('The survey covers forty villages')
    expect(out.mainHtml).not.toContain('collapsed mobile menu')
    // Unmarked HTML (every lane but the browser's) still chooses by text alone.
    expect(extractTf.extract(html.replace(' data-w2l-hidden=""', '')).mainHtml).toContain('collapsed mobile menu')
  })

  it('applies caller prune selectors', () => {
    const html = `<!doctype html><html><body><article>
<h1>Report</h1>
<p class="sponsor-note">Brought to you by our generous sponsor.</p>
<p>The harbour master recorded the tides every hour without exception through the winter months.</p>
</article></body></html>`
    const out = extractTf.extract(html, { pruneSelectors: ['.sponsor-note'] })
    expect(out.mainHtml).not.toContain('generous sponsor')
    expect(out.mainHtml).toContain('harbour master recorded the tides')
  })
})

// includeSelectors (the API's includeTags), and the whole page as the html format returns it.
describe('extractTf selection and whole page', () => {
  const PAGE = `<!doctype html><html class="js"><head><title>Kiln archive | Harbour office</title></head><body class="home">
<header><h1>Kiln archive</h1><nav><a href="/a">Home</a></nav></header>
<article><p>The kiln reached 1240 degrees before the glaze vitrified, and every reading was logged in the harbour office ledger.</p>
<table id="readings"><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41 <sup class="ref">[1]</sup></td></tr></table>
<form><label>Search the archive</label><input name="q"><button>Go</button></form></article>
<table id="legend"><tr><th>Key</th><th>Meaning</th></tr><tr><td>*</td><td>estimate</td></tr></table>
<footer><p>Copyright 2026</p></footer><script>var never = "shown"</script></body></html>`

  it('reduces the page to the included selectors, in document order, and returns that selection whole', () => {
    const out = extractTf.extract(PAGE, { includeSelectors: ['table', 'html.js h1'], pruneSelectors: ['#legend', 'td .ref'] })
    // The <tbody> a browser opens for rows written directly in the table.
    expect(out.mainHtml).toBe('<body><h1>Kiln archive</h1><table id="readings"><tbody><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41 </td></tr></tbody></table></body>')
    expect(htmlToMarkdown(out.mainHtml)).toBe('# Kiln archive\n\n| Station | Flow |\n| --- | --- |\n| Meridian | 41 |')
    // Exclusions are matched against the whole page too: the footer's paragraph is named by where it was,
    // and an excluded element takes the named elements inside it along.
    for (const excluded of ['footer p', 'footer', 'html > body > footer']) {
      expect(extractTf.extract(PAGE, { includeSelectors: ['p'], pruneSelectors: [excluded] }).mainHtml, excluded)
        .toBe('<body><p>The kiln reached 1240 degrees before the glaze vitrified, and every reading was logged in the harbour office ledger.</p></body>')
    }
    expect(extractTf.extract(PAGE, { includeSelectors: ['p', 'td'], pruneSelectors: ['article', '#legend tr'] }).mainHtml).toBe('<body><p>Copyright 2026</p></body>')
    expect(extractTf.extract(PAGE, { includeSelectors: ['body'], pruneSelectors: ['html'] }).mainHtml).toBe('')
    expect(extractTf.extract(PAGE, { includeSelectors: ['p'], pruneSelectors: ['body'] }).mainHtml).toBe('')
    // The page itself is still read for its type and metadata.
    expect(out).toMatchObject({ confidence: 1, escalate: false, pageType: 'article', metadata: { title: 'Kiln archive | Harbour office' } })
    // The same page without the option is unchanged: its main content, not the selection.
    expect(extractTf.extract(PAGE).mainHtml).toContain('glaze vitrified')
  })

  it('keeps a named navigation, an element inside another named one once, and everything when the body is named', () => {
    expect(extractTf.extract(PAGE, { includeSelectors: ['nav'] }).mainHtml).toBe('<body><nav><a href="/a">Home</a></nav></body>')
    const nested = extractTf.extract(PAGE, { includeSelectors: ['#readings', 'article'] }).mainHtml
    expect(nested.match(/Meridian/g)).toHaveLength(1)
    expect(nested).toContain('glaze vitrified')
    // Scripts and form controls are never shown, in a selection either.
    expect(nested).toContain('<form><label>Search the archive</label></form>')
    const everything = extractTf.extract(PAGE, { includeSelectors: ['body'] }).mainHtml
    for (const text of ['Kiln archive', 'Home', 'Meridian', 'estimate', 'Copyright 2026']) expect(everything).toContain(text)
    expect(everything).not.toContain('never')
  })

  it('gives an empty selection as an empty answer, and leaves escalate the page\'s own signal', () => {
    // The page has main content: nothing named is an empty answer, and nothing asks for a browser render.
    const none = extractTf.extract(PAGE, { includeSelectors: ['.does-not-exist'] })
    expect(none).toMatchObject({ mainHtml: '', escalate: false })
    expect(none.confidence).toBe(extractTf.extract(PAGE).confidence)
    // A page with no main content says so with or without a selection: a lane blocks it on its gate and offers it to the browser.
    const shell = '<!doctype html><html><body><div id="root"></div></body></html>'
    expect(extractTf.extract(shell).escalate).toBe(true)
    expect(extractTf.extract(shell, { includeSelectors: ['table'] })).toMatchObject({ mainHtml: '', escalate: true })
    // Its empty root, when named, is returned, and says no more about the page than no match does.
    expect(extractTf.extract(shell, { includeSelectors: ['#root'] })).toMatchObject({ mainHtml: '<body><div id="root"></div></body>', escalate: true, confidence: 0 })
  })

  it('matches exclusions against the page as it was received, for the main content as for the whole page', () => {
    // A page whose form wraps its content, as an ASP.NET page's does: cleaning unwraps the form.
    const prose = 'The harbour office records tide height, wind and visibility for every hour of the day. '.repeat(5)
    const page = `<!doctype html><html><body><form id="aspnetForm"><div class="wrap"><h1>Report</h1><p>${prose}</p>
<table class="filters"><tr><td>Filter A</td><td>Filter B</td></tr></table>
<table class="data"><tr><th>Station</th><th>Flow</th></tr><tr><td>Meridian</td><td>41</td></tr></table></div></form></body></html>`
    expect(extractTf.extract(page).mainHtml).toContain('Filter A')
    for (const selector of ['table.filters', 'form table.filters', '#aspnetForm > .wrap > .filters', 'body > form .filters']) {
      const main = extractTf.extract(page, { pruneSelectors: [selector] }).mainHtml
      expect(main, selector).toContain('Meridian')
      expect(main, selector).not.toContain('Filter A')
      expect(wholePageBody(page, [selector]), selector).not.toContain('Filter A')
      expect(htmlToMarkdown(page, { exclude: [selector] }), selector).not.toContain('Filter A')
    }
    // An excluded form goes with all it holds, although cleaning would unwrap it; so does the page with its root element.
    for (const selector of ['#aspnetForm', 'html', '*']) {
      expect(extractTf.extract(page, { pruneSelectors: [selector] }), selector).toMatchObject({ mainHtml: '', escalate: true })
      expect(htmlToMarkdown(page, { exclude: [selector] }), selector).toBe('')
      expect(wholePageBody(page, [selector]), selector).not.toContain('Report')
    }
  })

  it('wholePageBody keeps header, navigation and footer, and leaves out exclusions and what Markdown never shows', () => {
    const whole = wholePageBody(PAGE, ['nav', '#legend', 'html.js td .ref'])
    expect(whole.startsWith('<body class="home">')).toBe(true)
    for (const text of ['<h1>Kiln archive</h1>', 'glaze vitrified', '<td>41 </td>', '<label>Search the archive</label>', '<footer><p>Copyright 2026</p></footer>']) expect(whole).toContain(text)
    for (const text of ['Home', 'estimate', '[1]', '<script', '<input', '<button', 'never']) expect(whole).not.toContain(text)
    // It is the HTML the whole-page Markdown with the same exclusions is written from.
    expect(htmlToMarkdown(whole)).toBe(htmlToMarkdown(PAGE, { exclude: ['nav', '#legend', 'html.js td .ref'] }))
    expect(wholePageBody(PAGE)).toContain('<nav><a href="/a">Home</a></nav>')
  })

  it('returns HTML without the layout markers of a browser capture', () => {
    const marked = '<!doctype html><html><body><main><div class="quote"><span class="text" data-w2l-display="block">“The world as we have created it.”</span><span>by Albert Einstein</span></div>' +
      '<p>Open <span>Terminal</span><span data-w2l-hidden="">Git Bash</span>, as the harbour office manual describes for every new workstation.</p></main></body></html>'
    const main = extractTf.extract(marked).mainHtml
    expect(main).toContain('data-w2l-display="block"')
    expect(withoutLayoutMarkers(main)).toBe(main.replace(' data-w2l-display="block"', ''))
    const whole = wholePageBody(marked)
    expect(whole).toContain('<span class="text">“The world as we have created it.”</span>')
    expect(whole).not.toContain('data-w2l')
    expect(whole).not.toContain('Git Bash')
    // Text that only mentions a marker is content, and unmarked HTML is returned as it is.
    const mention = '<p>Set <code>data-w2l-display="block"</code> on the copy.</p>'
    expect(withoutLayoutMarkers(mention)).toBe(mention)
  })

  it('reads a selector it cannot use as naming nothing, in includeSelectors and pruneSelectors alike', () => {
    // The API refuses these by name; a caller that passes one anyway gets no match, never unbounded matching.
    expect(extractTf.extract(PAGE, { includeSelectors: ['tr:first-child', 'h1 ~ nav', 'div[['] }).mainHtml).toBe('')
    expect(extractTf.extract(PAGE, { pruneSelectors: ['article p:first-child', 'table:has(sup)'] }).mainHtml).toContain('glaze vitrified')
    expect(wholePageBody(PAGE, ['header ~ article'])).toContain('glaze vitrified')
  })

  it('removes ad containers and cookie banners by default and keeps them with blockAds: false, never touching a "download" class', () => {
    const prose = 'The kiln reached 1240 degrees before the glaze vitrified, and every reading was logged in the ledger kept by the harbour office for the whole season.'
    const html = `<!doctype html><html><head><title>Kiln report</title></head><body><main>
<div id="cookie-consent" role="dialog"><p>We use cookies to personalise content.</p></div>
<h1>Kiln report</h1>
<p>${prose}</p>
<div class="advertisement"><p>Advertisement: buy the almanac.</p></div>
<p>Sediment cores from the estuary date to 1873, and researchers compared them against the almanac kept at the plinth house through the winter.</p>
<div id="ad-slot"><p>Sponsored slot.</p></div>
<p class="download">Download the report as PDF.</p>
</main></body></html>`
    const pruned = extractTf.extract(html)
    expect(pruned.mainHtml).toContain(prose)
    expect(pruned.mainHtml).toContain('Download the report as PDF.')
    for (const gone of ['Advertisement: buy', 'Sponsored slot', 'We use cookies']) expect(pruned.mainHtml).not.toContain(gone)
    expect(extractTf.extract(html, { blockAds: true }).mainHtml).toBe(pruned.mainHtml)
    const kept = extractTf.extract(html, { blockAds: false })
    expect(kept.mainHtml).toContain(prose)
    for (const stays of ['Advertisement: buy', 'Sponsored slot', 'We use cookies', 'Download the report as PDF.']) expect(kept.mainHtml).toContain(stays)
    // The structural cleaning is not the switch's: scripts and navigation go either way, and a caller's own exclusions still apply.
    const chrome = `<!doctype html><html><body><nav><a href="/">Home</a></nav><main><h1>Kiln report</h1><p>${prose}</p><div class="promo"><p>Promo box.</p></div><script>var x = 1</script></main></body></html>`
    const loose = extractTf.extract(chrome, { blockAds: false, pruneSelectors: ['.promo'] })
    expect(loose.mainHtml).not.toContain('Home')
    expect(loose.mainHtml).not.toContain('var x')
    expect(loose.mainHtml).not.toContain('Promo box')
    expect(extractTf.extract(chrome, { blockAds: false }).mainHtml).toContain('Promo box')
  })

  it('reads a document without <html> as it reads it with one', () => {
    const page = '<head><title>Kiln log</title></head><body><article><h1>Kiln log</h1>' +
      '<p>The kiln reached 1240 degrees before the glaze vitrified. Every reading was logged in the ledger kept by the harbour office.</p>' +
      '<table><tr><td>Firing</td><td>Peak</td></tr><tr><td>1</td><td>1240</td></tr></table></article></body>'
    const bare = extractTf.extract(`<!doctype html>${page}`)
    const full = extractTf.extract(`<!doctype html><html>${page}</html>`)
    expect(bare.title).toBe('Kiln log')
    expect(bare.mainHtml).toContain('The kiln reached 1240 degrees')
    expect(htmlToMarkdown(bare.mainHtml)).toContain('| Firing | Peak |')
    expect({ ...bare, timings: undefined }).toEqual({ ...full, timings: undefined })
    expect(extractTf.extract('<!doctype html><body><p>Only a body here, with a sentence long enough to be read as content.</p></body>').mainHtml)
      .toContain('Only a body here')
  })

  it('keeps the main content after a <head> tag in the body', () => {
    const html = '<!doctype html><html><head><title>Kiln log</title></head><body><article><h1>Kiln log</h1><head/>' +
      '<p>The kiln reached 1240 degrees before the glaze vitrified. Every reading was logged in the ledger kept by the harbour office.</p>' +
      '<p>Sediment cores from the estuary date to 1873. Researchers compared them against the almanac kept at the plinth house.</p></article></body></html>'
    const md = htmlToMarkdown(extractTf.extract(html).mainHtml)
    expect(md).toContain('The kiln reached 1240 degrees')
    expect(md).toContain('Sediment cores from the estuary')
  })
})

describe('parse', () => {
  it('reads a <head> inside the body as a browser does also on a page past the parse5 budget, read by linkedom', async () => {
    const { htmlToMarkdown: markdown } = await import('../src/index.js')
    // One tag of 300 attributes sends the page to linkedom's parser.
    const wide = `<div ${Array.from({ length: 300 }, (_, k) => `data-k${k}="v"`).join(' ')}>config</div>`
    expect(markdown(`<head/><p>Some text</p>${wide}`)).toBe('Some text\n\nconfig')
    expect(markdown(`<head><title>T</title><p>Para one.</p>${wide}`)).toBe('Para one.\n\nconfig')
    expect(markdown(`<!doctype html><head><title>T</title><p>Para one.</p>${wide}`)).toBe('Para one.\n\nconfig')
    expect(markdown(`<!doctype html><html><body><article><p>a<head/>b</p><p>c</p></article>${wide}</body></html>`)).toBe('ab\n\nc\n\nconfig')
  })

  it('copies a page parsed again from the tree it built, each document its own', async () => {
    const { parse } = await import('../src/dom.js')
    const page = '<!doctype html><html><body><b>1<p>2</b>3</p><table><tr><td>a</td></tr></table></body></html>'
    const first = parse(page).document
    first.body.innerHTML = ''
    const second = parse(page).document
    expect(second.body.innerHTML).toBe('<b>1</b><p><b>2</b>3</p><table><tbody><tr><td>a</td></tr></tbody></table>')
    expect(first.body.innerHTML).toBe('')
  })

  it('builds each of two pages read by turns once (the rendered page and the body as received)', async () => {
    const { parse } = await import('../src/dom.js')
    const { Parser } = await import('parse5')
    const built = vi.spyOn(Parser, 'parse')
    try {
      const rendered = '<!doctype html><html><body><main><p>rendered</p></main></body></html>'
      const received = '<!doctype html><html><body><main><p>received</p></main></body></html>'
      for (let i = 0; i < 3; i++) {
        expect(parse(rendered).document.body.innerHTML).toBe('<main><p>rendered</p></main>')
        expect(parse(received).document.body.innerHTML).toBe('<main><p>received</p></main>')
      }
      expect(built).toHaveBeenCalledTimes(2)
    } finally {
      built.mockRestore()
    }
  })

  it('reads a page the same way every time, also when its <noscript> goes past the budget', async () => {
    const { htmlToMarkdown } = await import('../src/index.js')
    let noscript = ''
    for (let i = 0; i < 200; i++) noscript += `<b a=${i}>`
    for (let i = 0; i < 200; i++) noscript += `<p>x${i}`
    const page = `<!doctype html><html><body><div><b>1<p>2</b>3</p></div>${'<i>a</i>'.repeat(46)}<noscript>${noscript}</noscript></body></html>`
    expect(htmlToMarkdown(page)).toBe(htmlToMarkdown(page))
  })
})
