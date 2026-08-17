/**
 * Shared page furniture. Every string here is boilerplate that MUST NOT appear
 * in extracted main content — the `mustNotContain` annotations reference these.
 */

export const NAV_MARKER = 'Pricing · Changelog · Careers'
export const FOOTER_MARKER = 'Copyright 2026 Synthetic Fixture Co'
export const COOKIE_MARKER = 'We use cookies to personalise content'
export const SIDEBAR_MARKER = 'Trending: seventeen ways to boil water'

export function nav(): string {
  return `<nav class="site-nav"><a href="/">Home</a> <a href="/pricing">${NAV_MARKER}</a></nav>`
}

export function cookieBanner(): string {
  return `<div id="cookie-consent" role="dialog"><p>${COOKIE_MARKER} and analyse traffic.</p><button>Accept all</button></div>`
}

export function sidebar(): string {
  return `<aside class="sidebar"><h3>${SIDEBAR_MARKER}</h3><ul><li><a href="/a">Unrelated link A</a></li><li><a href="/b">Unrelated link B</a></li></ul></aside>`
}

export function footer(): string {
  return `<footer><p>${FOOTER_MARKER}. All rights reserved. <a href="/tos">Terms</a></p></footer>`
}

/** All boilerplate markers, for use in mustNotContain annotations. */
export const ALL_BOILERPLATE = [NAV_MARKER, FOOTER_MARKER, COOKIE_MARKER, SIDEBAR_MARKER] as const

export interface PageOptions {
  title: string
  bodyHtml: string
  /** Wrap main content in these chrome elements. Defaults to all. */
  chrome?: boolean
  headExtra?: string
}

export function htmlPage({ title, bodyHtml, chrome = true, headExtra = '' }: PageOptions): string {
  const before = chrome ? `${cookieBanner()}\n${nav()}` : ''
  const after = chrome ? `${sidebar()}\n${footer()}` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="Synthetic fixture page for benchmark purposes.">
${headExtra}
</head>
<body>
${before}
${bodyHtml}
${after}
</body>
</html>`
}

/** Deterministic prose generator. Same n always yields the same text. */
export function prose(paragraphs: number, seed = 1): string {
  const words = [
    'harbour', 'lantern', 'meridian', 'quarry', 'sediment', 'thistle', 'valve',
    'kiln', 'ravine', 'compass', 'furrow', 'granite', 'tributary', 'bellows',
    'almanac', 'cistern', 'plinth', 'yarrow', 'scaffold', 'estuary',
  ]
  const out: string[] = []
  let state = seed
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state
  }
  for (let p = 0; p < paragraphs; p++) {
    const sentences: string[] = []
    for (let s = 0; s < 4; s++) {
      const len = 9 + (next() % 8)
      const picked: string[] = []
      for (let w = 0; w < len; w++) {
        picked.push(words[next() % words.length]!)
      }
      const sentence = picked.join(' ')
      sentences.push(sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.')
    }
    out.push(`<p>${sentences.join(' ')}</p>`)
  }
  return out.join('\n')
}
