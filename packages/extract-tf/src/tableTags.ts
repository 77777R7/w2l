/**
 * Makes htmlparser2 build a page's tables as a browser's parser does, before
 * linkedom parses it.
 *
 * htmlparser2 closes the nearest open element of an end tag's name wherever
 * it is: a cell's own `</td>` after a `<td>` written in it, a `</div>` or a
 * `</body>` in a cell closed cells, rows and whole tables further out, which
 * a browser keeps (its table scope stops at the table, and an end tag that
 * finds a cell or row first is ignored). Its implied closes also differ: a
 * `<td>` directly in a `<thead>` closed the `<thead>`.
 *
 * This reads the tags with htmlparser2's own tokenizer, keeps the stack of
 * elements a browser has open from the outermost table in, and edits the
 * source only where the two would differ: it drops an end tag a browser
 * ignores there, and writes out the end tags of the cells, rows, row groups
 * and captions a browser closes at a table tag (with the elements it moved
 * out of the table at that level), the `<tr>` it opens for a cell written
 * directly in a row group or table, and the `</table>` before a table
 * written where rows belong, which ends the table there. What a browser
 * moves before the table is left to the converter's rebuild of the table.
 * Outside tables, a whole page's table tags are dropped (outside a template,
 * svg or math), as a browser ignores them; nothing else changes. In a
 * fragment they stay: a page's main content can be one cell or row of a
 * layout table, given to the converter on its own. Once a table has ended at
 * a table written where its rows belong, its table tags left outside any
 * table are dropped in a fragment too.
 *
 * An HTML element such as a `<p>` or `<div>` written in an svg or math ends
 * it in a browser (outside an integration point such as `<foreignObject>`,
 * whose content is HTML), and so do `</p>` and `</br>`; htmlparser2 kept
 * them in the svg, which the converter skips with what follows. Outside
 * tables too, the end tags of the svg or math elements a browser ends there
 * are written out before the tag.
 *
 * A whole page's `</body>` and `</html>` are dropped wherever they are:
 * htmlparser2 closes the body there, so what follows was outside it, where a
 * browser closes nothing and puts what follows in the body. As a browser
 * closes both at the end anyway, dropping them changes nothing else.
 */

import { Tokenizer } from 'htmlparser2'

// htmlparser2's void elements: no end tag, never on its stack.
const VOID = new Set(['area', 'base', 'basefont', 'br', 'col', 'command', 'embed', 'frame', 'hr', 'img', 'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
/** The `<tbody>` a browser opens for rows written directly in a table, which htmlparser2's tree does not hold. */
const IMPLIED_TBODY = 'tbody*'
const GROUPS = new Set(['thead', 'tbody', 'tfoot', IMPLIED_TBODY])
const TABLE_TAGS = new Set(['table', 'caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'template', IMPLIED_TBODY])
/** Where a browser's content goes into the element itself rather than being moved out of the table. */
const CONTENT = new Set(['td', 'th', 'caption', 'template'])
const FOREIGN = new Set(['svg', 'math'])
/** Elements in svg or math whose content is HTML again. */
const INTEGRATION = new Set(['foreignobject', 'desc', 'title', 'mi', 'mo', 'mn', 'ms', 'mtext'])
/** HTML start tags that end the svg or math they are written in. */
const BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var'])
/** The integration points of svg (s:) and math (m:), whose content is HTML. */
const OUTER_INTEGRATION = new Set(['s:foreignobject', 's:desc', 's:title', 'm:mi', 'm:mo', 'm:mn', 'm:ms', 'm:mtext'])
/** A start tag in the BREAKOUT set, or a `</p>` or `</br>`: what may end an svg or math it is written in. */
const BREAKOUT_TAG = new RegExp(`<(?:${[...BREAKOUT].join('|')})[\\t\\n\\f\\r />]|</(?:p|br)[\\t\\n\\f\\r >]`, 'i')
const FOREIGN_TAG = /<(\/?)(svg|math)(?=[\t\n\f\r />])/gi

/**
 * Whether an svg or math may hold a tag that ends it, read from the tags'
 * text alone: a page whose svgs and maths (icons, mostly) hold none skips the
 * pass. Anything it misreads, such as `<svg>` in a script, only runs the pass.
 */
const breaksOutOfForeign = (html: string): boolean => {
  if (!/<(?:svg|math)[\t\n\f\r />]/i.test(html)) return false
  // Open svgs and maths: an end tag closes only its own.
  const depth = { svg: 0, math: 0 }
  let from = 0
  // The `>` that ends the latest tag, found once: a `<svg` without one is not looked past again.
  let gt = -1
  for (const tag of html.matchAll(FOREIGN_TAG)) {
    if (tag.index < from) continue
    if (depth.svg + depth.math > 0 && BREAKOUT_TAG.test(html.slice(from, tag.index))) return true
    if (gt < tag.index) gt = html.indexOf('>', tag.index)
    if (gt < 0) break
    const name = tag[2]!.toLowerCase() as 'svg' | 'math'
    if (tag[1] === '/') depth[name] = Math.max(0, depth[name] - 1)
    else if (html[gt - 1] !== '/') depth[name]++
    from = gt + 1
  }
  return depth.svg + depth.math > 0 && BREAKOUT_TAG.test(html.slice(from))
}

// htmlparser2's implied closes (its openImpliesClose) of the elements outside
// table structure, which a browser makes too: the stack drops what
// htmlparser2 has closed, so no end tag is written out for it.
const P = new Set(['p'])
const FORM = new Set(['input', 'option', 'optgroup', 'select', 'button', 'datalist', 'textarea'])
const IMPLIES_CLOSE = new Map<string, Set<string>>([
  ...['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr', 'main', 'nav', 'ol', 'pre', 'section', 'table', 'ul'].map((name) => [name, P] as [string, Set<string>]),
  ...['select', 'input', 'output', 'button', 'datalist', 'textarea'].map((name) => [name, FORM] as [string, Set<string>]),
  ['li', new Set(['li'])],
  ['option', new Set(['option'])],
  ['optgroup', new Set(['optgroup', 'option'])],
  ['dd', new Set(['dt', 'dd'])],
  ['dt', new Set(['dt', 'dd'])],
  ['rt', new Set(['rb', 'rt', 'rtc', 'rp'])],
  ['rp', new Set(['rb', 'rt', 'rtc', 'rp'])],
])

/** A browser's special elements: an end tag it reads by its "any other end tag" rule closes nothing past one. */
const SPECIAL = new Set(['address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br', 'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen', 'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext', 'pre', 'script', 'search', 'section', 'select', 'source', 'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp'])
/** The end tags a browser reads in the body by a rule of their own (with the table tags, and `</head>`, read in the head). */
const OWN_END_RULE = new Set(['template', 'body', 'html', 'head', 'address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'listing', 'main', 'menu', 'nav', 'ol', 'pre', 'search', 'section', 'summary', 'ul', 'form', 'p', 'li', 'dd', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u', 'applet', 'marquee', 'object', 'br'])
/** Whether a browser reads an end tag by its "any other end tag" rule: `</span>`, `</label>`, `</sup>`, a custom element's. */
const anyOtherEnd = (name: string): boolean => !OWN_END_RULE.has(name) && !TABLE_TAGS.has(name) && !VOID.has(name)
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
/** The formatting elements a browser keeps in its list of active formatting elements. */
const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u'])
/** The elements that put a marker on that list: formatting elements opened before one are not reopened in it. */
const MARKERS = new Set(['applet', 'marquee', 'object', 'template', 'td', 'th', 'caption'])
/** The start tags at which a browser does not reopen the formatting elements it has closed (it does at text and any other). */
const NO_RECONSTRUCT = new Set(['html', 'body', 'head', 'frameset', 'base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'script', 'style', 'template', 'title', 'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search', 'section', 'summary', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form', 'li', 'dd', 'dt', 'plaintext', 'table', 'hr', 'textarea', 'iframe', 'noembed', 'noscript', 'param', 'source', 'track', 'caption', 'col', 'colgroup', 'frame', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'])
// Bounds past which the formatting elements are left as htmlparser2 reads them: elements open above one a browser
// adopts (each adoption rebuilds them), entries on the list, and elements reopened on a page.
const MAX_ADOPTION_DEPTH = 2000
const MAX_ADOPTION_WORK = 200_000
const MAX_FORMATTING = 200
const MAX_REOPENED = 20000
/** Elements whose content a browser reads as text (a <noscript> with scripting on) where htmlparser2 reads tags: their own end tag always ends them. */
const TEXT_CONTENT = new Set(['noscript', 'iframe', 'noembed', 'noframes', 'xmp', 'plaintext', 'textarea', 'title', 'style', 'script'])
/** The start tags at which a browser closes a <p> open in button scope. */
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search', 'section', 'summary', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form', 'plaintext', 'xmp', 'li', 'dd', 'dt', 'hr', 'table'])
/** The elements that end a browser's default scope outside tables (with the integration points), and the special ones a <li>, <dd> or <dt> looks past. */
const SCOPE = new Set(['applet', 'marquee', 'object', 'template', 'html', 'table', 'td', 'th', 'caption'])
/** The elements htmlparser2 counts in or out of svg and math (by name): their end tags keep its count right. */
const FOREIGN_CONTEXT = new Set(['svg', 'math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml', 'foreignobject', 'desc', 'title'])
const LIST_ITEM_PASSES = new Set(['address', 'div', 'p'])

/** The table tags a browser ignores outside any table (outside a template, svg or math). */
const STRAY = new Set(['caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])

/**
 * Whether the page's `</body>` and `</html>` are all in its last run of end
 * tags, white space and comments, where dropping them changes nothing: one
 * written earlier (or in a script) needs the pass. Read step by step rather
 * than by one pattern over the tail, whose backtracking state overflows on a
 * tail of millions of characters; anything else, such as `<!-->`, runs the
 * pass.
 */
const endsWithBodyEnd = (html: string): boolean => {
  let i = html.search(/<\/\s*(body|html)/i)
  if (i < 0) return true
  const endTag = /<\/[\t\n\f\r ]*(?:body|html)[\t\n\f\r ]*>/iy
  while (i < html.length) {
    const c = html.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) i++
    else if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 2)
      if (end < i + 4) return false
      i = end + 3
    } else {
      endTag.lastIndex = i
      if (!endTag.test(html)) return false
      i = endTag.lastIndex
    }
  }
  return true
}

/**
 * A start tag at which a browser may close an element htmlparser2 keeps open (a <li>, <dd>, <dt>, heading, <button>, or a
 * <p> a block closes), or a formatting element's, which a browser may reopen or move a block out of.
 */
const CLOSING_START = /<(?:li|dd|dt|h[1-6]|button|p|a|b|big|code|em|font|i|nobr|s|small|strike|strong|tt|u)[\t\n\f\r />]/i

/** Whether the page has an end tag a browser reads by its "any other end tag" rule, such as `</span>`, or a heading's, which closes any heading. */
const hasLooseEnd = (html: string): boolean => {
  for (const tag of html.matchAll(/<\/([A-Za-z][^\t\n\f\r />]*)/g)) {
    const name = tag[1]!.toLowerCase()
    if (anyOtherEnd(name) || HEADINGS.has(name)) return true
  }
  return false
}

/**
 * `whole` (default: the HTML has an `<html>` tag or a doctype, as the
 * converter decides) is a page as a browser would read it: a table tag
 * outside any table is dropped, as a browser ignores it, and so is every
 * `</body>` and `</html>`. A fragment, such as
 * the main content of a layout table serialized from its tree, keeps them.
 */
export function normalizeTableTags(html: string, whole = /<html[\s>]|<!doctype/i.test(html)): string {
  const tableTags = whole ? /<(table|t[dhr]|thead|tbody|tfoot|caption|col)/i : /<table/i
  if (!tableTags.test(html) && (!whole || endsWithBodyEnd(html)) && !breaksOutOfForeign(html) && !hasLooseEnd(html) && !CLOSING_START.test(html)) return html
  // Replace [at, end) with text, in source order.
  // `first`: written before the other edits at its place (the copy of a formatting element a browser puts in a block,
  // before its content), a later one before an earlier one, as the later copy holds the earlier.
  const edits: { at: number; end: number; text: string; first?: number }[] = []
  let firsts = 0
  // The elements a browser has open from the outermost table in, innermost last.
  const stack: string[] = []
  let tables = 0
  // Tables a browser ended early, at a <table> where their rows belong, whose own tags still follow outside any table:
  // a browser ignores those table tags there, and the </table> each still has.
  let ended = 0
  // The templates open outside any table: a browser reads table tags in them, as in an svg or math (`outer`).
  let templatesOutside = 0
  // The tables (by stack index) whose implied <tbody> a browser has closed: the next one is written out, so the rows stay in two groups.
  const impliedClosed = new Set<number>()
  let tagAt = 0
  let tagName = ''
  let tagNameEnd = 0

  // Where the table elements, the svg and math elements and each name's
  // elements are on the stack, innermost last, so no step walks the stack:
  // a cell may be thousands of elements deep.
  const tablePos: number[] = []
  // The HTML elements (an svg or math opened in HTML starts a run of its
  // elements, kept as ^name), and the HTML integration points in those runs.
  const plainPos: number[] = []
  const integrationPos: number[] = []
  // The HTML elements special to a browser.
  const specialPos: number[] = []
  // The svg and math elements opened as HTML (each starts a run), innermost last: one can sit in another's integration point.
  const regionPos: number[] = []
  const byName = new Map<string, number[]>()
  // The table stack's tables, cells, captions and templates, by index, and their ids in the body model.
  const links = new Map<number, number>()
  // Where the tag being read starts.
  let tagStart = 0
  const last = (list: number[] | undefined): number => (list !== undefined && list.length > 0 ? list[list.length - 1]! : -1)

  const push = (name: string) => {
    const i = stack.length
    stack.push(name)
    // A table, cell, caption or template is a boundary in the body model too (its content is read by a browser's body rules).
    if (name === 'table' || CONTENT.has(name)) {
      links.set(i, outerPush(name))
      if (MARKERS.has(name)) afe.push(null)
    }
    if (TABLE_TAGS.has(name)) tablePos.push(i)
    if (!name.startsWith('^') && !FOREIGN.has(name)) plainPos.push(i)
    if (FOREIGN.has(name)) regionPos.push(i)
    if (name.startsWith('^') && INTEGRATION.has(name.slice(1))) integrationPos.push(i)
    if (SPECIAL.has(name)) specialPos.push(i)
    let list = byName.get(name)
    if (list === undefined) byName.set(name, (list = []))
    list.push(i)
    if (name === 'table') tables++
  }
  /** Pops the elements above `index` (and it, when `inclusive`), returning the end tags htmlparser2 needs written out. */
  const popTo = (index: number, inclusive: boolean): string => {
    let text = ''
    const keep = inclusive ? index : index + 1
    while (stack.length > keep) {
      const i = stack.length - 1
      const name = stack.pop()!
      byName.get(name)!.pop()
      if (!name.startsWith('^') && !FOREIGN.has(name)) plainPos.pop()
      if (FOREIGN.has(name)) regionPos.pop()
      if (name.startsWith('^') && INTEGRATION.has(name.slice(1))) integrationPos.pop()
      if (SPECIAL.has(name)) specialPos.pop()
      if (TABLE_TAGS.has(name)) tablePos.pop()
      const link = links.get(i)
      if (link !== undefined) {
        links.delete(i)
        unlink(name, link)
      }
      if (name === IMPLIED_TBODY) impliedClosed.add(last(byName.get('table')))
      else if (TABLE_TAGS.has(name)) text += `</${name}>`
      else {
        // An element in a cell closes with the cell's end tag; one at the table's own level is open in htmlparser2's tree there.
        const below = last(tablePos)
        if (below >= 0 && !CONTENT.has(stack[below]!)) text += `</${name}>`
      }
      if (name === 'table') {
        tables--
        impliedClosed.delete(i)
      }
    }
    return text
  }
  /**
   * Ends a boundary in the body model with its table element: what is open
   * in it closes with the element's end tag, but the svg and math there are
   * ended by name first, as htmlparser2 counts them by their end tags.
   */
  function unlink(name: string, id: number): void {
    const index = idIndex.get(id)
    if (index === undefined) return
    let text = ''
    for (let k = outer.length - 1; k > index; k--) if (FOREIGN_CONTEXT.has(bare(outer[k]!))) text += `</${bare(outer[k]!)}>`
    insert(tagStart, text)
    outerPopTo(index)
    if (MARKERS.has(name)) afeClearToMarker()
  }
  /** Opens the <tbody> a browser opens for a row written directly in the table: implied, or written out after an implied one closed. */
  const openImpliedTbody = (): string => {
    if (impliedClosed.has(last(byName.get('table')))) {
      push('tbody')
      return '<tbody>'
    }
    push(IMPLIED_TBODY)
    return ''
  }
  /** Whether a browser reads the tags here by its body rules: in a cell, caption or template of a table. */
  const inCell = (): boolean => tables > 0 && CONTENT.has(innermost()[0])
  /** The innermost table element open, and where it is. */
  const innermost = (): [string, number] => {
    const i = last(tablePos)
    return i < 0 ? ['', -1] : [stack[i]!, i]
  }
  /** The nearest open table element of `name` before the table scope ends (at a table or template), or -1. */
  const inTableScope = (name: string): number => {
    for (let k = tablePos.length - 1; k >= 0; k--) {
      const i = tablePos[k]!
      // An end tag </tbody> closes the implied one too.
      if (stack[i] === name || (name === 'tbody' && stack[i] === IMPLIED_TBODY)) return i
      if (stack[i] === 'table' || stack[i] === 'template') return -1
    }
    return -1
  }
  /** Where the innermost svg or math the current element is in starts, or -1 when the current element is HTML. */
  const foreignStart = (): number => (stack.length - 1 > last(plainPos) ? last(regionPos) : -1)
  /** Whether a start tag is read as svg or math: in one, but not at an HTML integration point, whose content is HTML. */
  const inForeign = (): boolean => {
    const top = stack[stack.length - 1]!
    return foreignStart() >= 0 && !(top.startsWith('^') && INTEGRATION.has(top.slice(1)))
  }
  /** Ends the svg or math the current element is in, writing out its end tag so htmlparser2 leaves it too. */
  const leaveForeign = (): string => {
    const start = foreignStart()
    const text = `</${stack[start]}>`
    popTo(start, true)
    return text
  }
  const impliedCloses = (name: string): void => {
    const closes = IMPLIES_CLOSE.get(name)
    while (closes !== undefined && stack.length > 0 && closes.has(stack[stack.length - 1]!)) popTo(stack.length - 1, true)
  }
  // The elements a browser has open outside any table, innermost last: HTML
  // elements as their name, an svg or math opened in HTML as its name, and
  // the svg and math elements in it as ^s:name and ^m:name (by the namespace
  // they are in: an <mi> is an integration point in math, not in svg). They
  // follow htmlparser2's tree, and a browser's closes where it closes a
  // special element that htmlparser2 keeps open (a <li> at the next <li>, a
  // <p> at a <div>), so an element a browser has closed does not stop an
  // end tag (the elements htmlparser2 reads in a <noscript> or <iframe>,
  // whose content a browser reads as text, are ended with it).
  const outer: string[] = []
  const outerByName = new Map<string, number[]>()
  // Where its HTML elements, integration points, svg and math elements opened in HTML, special elements (integration
  // points among them), those a <li> does not look past, and the elements that end a scope are, innermost last.
  const outerHtml: number[] = []
  const outerIntegration: number[] = []
  const outerRoots: number[] = []
  const outerSpecial: number[] = []
  const outerStrict: number[] = []
  const outerScope: number[] = []
  const isOuterHtml = (entry: string): boolean => !entry.startsWith('^') && !FOREIGN.has(entry)
  const isOuterIntegration = (entry: string): boolean => entry.startsWith('^') && (OUTER_INTEGRATION.has(entry.slice(1)) || entry === '^m:annotation-xml')
  const bare = (entry: string): string => (entry.startsWith('^') ? entry.slice(3) : entry)
  // The <noscript>, <iframe> and the like (text to a browser) and <select> elements open: nothing in them closes past them.
  const outerOpaque: number[] = []
  const outerLists = [outerHtml, outerRoots, outerIntegration, outerSpecial, outerStrict, outerScope, outerOpaque]
  // Which of those lists each entry is in, one bit per list, kept beside it.
  const outerMasks: number[] = []
  const maskOf = (entry: string): number => {
    const html = isOuterHtml(entry)
    const integration = isOuterIntegration(entry)
    const special = integration || (html && SPECIAL.has(entry))
    return (html ? 1 : 0) | (FOREIGN.has(entry) ? 2 : 0) | (integration ? 4 : 0) | (special ? 8 : 0) |
      (special && !LIST_ITEM_PASSES.has(entry) ? 16 : 0) | (integration || (html && SCOPE.has(entry)) ? 32 : 0) |
      (html && (TEXT_CONTENT.has(entry) || entry === 'select') ? 64 : 0)
  }
  // Each element's id, and where its start tag is (-1 for one written out here), beside it; where each id is.
  const outerIds: number[] = []
  const outerAt: number[] = []
  const outerEnd: number[] = []
  const idIndex = new Map<number, number>()
  let nextId = 0
  const outerPush = (entry: string, at = -1, end = -1, id = nextId++): number => {
    let list = outerByName.get(bare(entry))
    if (list === undefined) outerByName.set(bare(entry), (list = []))
    list.push(outer.length)
    const mask = maskOf(entry)
    for (let bit = 0; bit < outerLists.length; bit++) if (mask & (1 << bit)) outerLists[bit]!.push(outer.length)
    outerMasks.push(mask)
    idIndex.set(id, outer.length)
    outerIds.push(id)
    outerAt.push(at)
    outerEnd.push(end)
    outer.push(entry)
    return id
  }
  const outerPop = (): string => {
    const entry = outer.pop()!
    outerByName.get(bare(entry))!.pop()
    const mask = outerMasks.pop()!
    for (let bit = 0; bit < outerLists.length; bit++) if (mask & (1 << bit)) outerLists[bit]!.pop()
    idIndex.delete(outerIds.pop()!)
    outerAt.pop()
    outerEnd.pop()
    return entry
  }
  const outerPopTo = (index: number): void => {
    while (outer.length > index) outerPop()
  }
  /** The nearest open HTML element of a name, or -1. */
  const outerOpen = (name: string): number => {
    const open = last(outerByName.get(name))
    return open >= 0 && isOuterHtml(outer[open]!) ? open : -1
  }
  /** Whether a start tag outside tables is read as svg or math: in one, but not at an integration point. */
  const inOuterForeign = (): boolean => {
    const top = outer[outer.length - 1]
    return top !== undefined && (FOREIGN.has(top) || (top.startsWith('^') && !OUTER_INTEGRATION.has(top.slice(1))))
  }
  /** The entry of an svg or math element opened in the current one: in its namespace, but an svg in math's <annotation-xml> starts an svg. */
  const foreignEntry = (name: string): string => {
    const top = outer[outer.length - 1]!
    if (name === 'svg' && top === '^m:annotation-xml') return name
    return `^${top.startsWith('^') ? top[1] : top[0]}:${name}`
  }
  /** Ends the svg or math elements a browser ends at an HTML tag, returning the end tags that make htmlparser2 end them too. */
  const leaveOuterForeign = (): string => {
    const names: string[] = []
    while (inOuterForeign()) names.push(bare(outerPop()))
    // The last is the svg or math itself: one end tag for it, and for each element of its name in it, closes them all.
    const root = names[names.length - 1]!
    return `</${root}>`.repeat(names.filter((name) => name === root).length)
  }
  const outerImplied = (name: string): void => {
    const closes = IMPLIES_CLOSE.get(name)
    while (closes !== undefined && outer.length > 0 && closes.has(bare(outer[outer.length - 1]!))) outerPop()
  }
  /** The elements a browser closes at an HTML start tag, which htmlparser2 may keep open. */
  /**
   * Closes what a browser closes at an HTML start tag beyond htmlparser2's
   * implied closes, returning the end tags that make htmlparser2 close it
   * too: htmlparser2 kept a <li> open at the next <li> past an inline
   * element, and nested the next one in it.
   */
  const outerBrowserCloses = (name: string): string => {
    let text = ''
    // In a <noscript> or <iframe> a browser reads text, and a <select> holds options: leave what htmlparser2 reads there.
    if (outerOpaque.length > 0) return text
    const closeTo = (index: number): void => {
      // The nearest element of its name: its end tag closes it, and what is open in it, in htmlparser2 too.
      text += `</${outer[index]}>`
      outerPopTo(index)
    }
    // In a browser's order: the list item, the <p>, then a heading the <p> was in.
    // A <li> closes the nearest <li> unless a special element other than <address>, <div> or <p> comes first; <dd> and <dt> alike.
    if (name === 'li' || name === 'dd' || name === 'dt') {
      const item = name === 'li' ? outerOpen('li') : Math.max(outerOpen('dd'), outerOpen('dt'))
      if (item >= 0 && item >= last(outerStrict)) closeTo(item)
    }
    if (CLOSES_P.has(name)) {
      const p = outerOpen('p')
      if (p > Math.max(last(outerScope), outerOpen('button'))) closeTo(p)
    }
    const top = outer.length - 1
    if (HEADINGS.has(name) && top >= 0 && HEADINGS.has(outer[top]!)) closeTo(top)
    if (name === 'button') {
      const button = outerOpen('button')
      if (button > last(outerScope)) closeTo(button)
    }
    return text
  }
  // A browser's list of active formatting elements outside tables, null a
  // marker: the <b>, <a> and the like it has opened and not yet ended at
  // their end tag. One a block or a </p> closed is reopened (a copy, with its
  // attributes) at the next text or inline tag, and an end tag that finds a
  // block in its element moves the block out of it, with a copy of the
  // element inside (the adoption agency algorithm).
  type Formatting = { id: number; name: string; attrs: string }
  const afe: (Formatting | null)[] = []
  const afeById = new Map<number, Formatting>()
  let reopened = 0
  // The elements the adoptions on this page have moved, and how many they may.
  let adopted = 0
  /** Whether a browser follows the list here: outside tables, svg and math, and a <select>, <noscript> or the like. */
  const formattingOn = (): boolean => (tables === 0 || inCell()) && !inOuterForeign() && outerOpaque.length === 0
  const afeAdd = (f: Formatting): void => {
    // At most three entries alike after the last marker (the Noah's Ark clause): the earliest goes.
    let alike = 0
    let earliest = -1
    for (let i = afe.length - 1; i >= 0 && afe[i] !== null; i--) {
      if (afe[i]!.name === f.name && afe[i]!.attrs === f.attrs) {
        alike++
        earliest = i
      }
    }
    if (alike >= 3) afeById.delete(afe.splice(earliest, 1)[0]!.id)
    if (afe.length >= MAX_FORMATTING) return
    afe.push(f)
    afeById.set(f.id, f)
  }
  const afeReplace = (f: Formatting, by: Formatting): void => {
    afe[afe.indexOf(f)] = by
    afeById.delete(f.id)
    afeById.set(by.id, by)
  }
  const afeRemove = (f: Formatting): void => {
    afe.splice(afe.indexOf(f), 1)
    afeById.delete(f.id)
  }
  const afeClearToMarker = (): void => {
    while (afe.length > 0) {
      const f = afe.pop()
      if (f === null || f === undefined) break
      afeById.delete(f.id)
    }
  }
  /** The last entry of a name after the last marker, or -1. */
  const afeLast = (name: string): number => {
    for (let i = afe.length - 1; i >= 0 && afe[i] !== null; i--) if (afe[i]!.name === name) return i
    return -1
  }
  const startTagOf = (f: Formatting): string => `<${f.name}${f.attrs}>`
  /** Reopens the formatting elements a browser has closed and not ended, returning their start tags. */
  const reconstruct = (): string => {
    const lastEntry = afe[afe.length - 1]
    if (lastEntry === undefined || lastEntry === null || idIndex.has(lastEntry.id)) return ''
    let i = afe.length - 1
    while (i > 0 && afe[i - 1] !== null && !idIndex.has(afe[i - 1]!.id)) i--
    let text = ''
    for (; i < afe.length && reopened < MAX_REOPENED; i++, reopened++) {
      const f = afe[i]!
      const copy = { id: nextId++, name: f.name, attrs: f.attrs }
      text += startTagOf(f)
      outerPush(f.name, -1, -1, copy.id)
      afeReplace(f, copy)
    }
    return text
  }
  /** The nearest special element above the stack index, or -1. */
  const specialAbove = (index: number): number => {
    let lo = 0
    let hi = outerSpecial.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (outerSpecial[mid]! > index) hi = mid
      else lo = mid + 1
    }
    return lo < outerSpecial.length ? outerSpecial[lo]! : -1
  }
  /** How many open elements of a name are at stack indexes from..to-1. */
  const countOpen = (name: string, from: number, to: number): number => {
    const list = outerByName.get(name) ?? []
    let count = 0
    for (let k = list.length - 1; k >= 0 && list[k]! >= from; k--) if (list[k]! < to) count++
    return count
  }
  /**
   * A browser's adoption agency algorithm for a formatting element's end
   * tag (or a <a> or <nobr> opened while one is open). It returns the end
   * tags to write in its place, writes at each block it moves the end tags
   * before it and the copies after it, and returns null when the list holds
   * no such element (the tag is then read as any other end tag), undefined
   * when it leaves the element as htmlparser2 reads it.
   */
  const adoption = (name: string): string | null | undefined => {
    let text = ''
    for (let round = 0; round < 8; round++) {
      const fa = afeLast(name)
      if (fa < 0) return round === 0 ? null : text
      const formatting = afe[fa]!
      const fi = idIndex.get(formatting.id)
      if (fi === undefined) {
        afeRemove(formatting)
        return text
      }
      // Not in scope: the tag is ignored.
      if (last(outerScope) > fi) return text
      const block = specialAbove(fi)
      if (block < 0) {
        text += `</${name}>`.repeat(countOpen(name, fi, outer.length))
        outerPopTo(fi)
        afeRemove(formatting)
        return text
      }
      // Too deep to rebuild, or svg or math in between: left as htmlparser2 reads it.
      adopted += outer.length - fi
      if (outer.length - fi > MAX_ADOPTION_DEPTH || adopted > MAX_ADOPTION_WORK || outerAt[block]! < 0) return round === 0 ? undefined : text
      for (let k = fi; k <= block; k++) if (!isOuterHtml(outer[k]!)) return round === 0 ? undefined : text
      // The formatting elements between are copied around the block, three at most (the nearest it); any other stays behind.
      const copies: Formatting[] = []
      let bookmark: Formatting | null = null
      for (let k = block - 1, counter = 1; k > fi; k--, counter++) {
        const f = afeById.get(outerIds[k]!)
        if (f === undefined) continue
        if (counter > 3) {
          afeRemove(f)
          continue
        }
        const copy = { id: nextId++, name: f.name, attrs: f.attrs }
        afeReplace(f, copy)
        if (copies.length === 0) bookmark = copy
        copies.unshift(copy)
      }
      const inner = { id: nextId++, name, attrs: formatting.attrs }
      edits.push({ at: outerAt[block]!, end: outerAt[block]!, text: `</${name}>`.repeat(countOpen(name, fi, block)) + copies.map(startTagOf).join('') })
      edits.push({ at: outerEnd[block]!, end: outerEnd[block]!, text: startTagOf(inner), first: ++firsts })
      const blockEntry = [outer[block]!, outerAt[block]!, outerEnd[block]!, outerIds[block]!] as const
      const above: (readonly [string, number, number, number])[] = []
      for (let k = block + 1; k < outer.length; k++) above.push([outer[k]!, outerAt[k]!, outerEnd[k]!, outerIds[k]!])
      outerPopTo(fi)
      for (const copy of copies) outerPush(copy.name, -1, -1, copy.id)
      outerPush(...blockEntry)
      outerPush(name, -1, -1, inner.id)
      for (const entry of above) outerPush(...entry)
      if (bookmark === null) afeReplace(formatting, inner)
      else {
        afeRemove(formatting)
        afe.splice(afe.indexOf(bookmark) + 1, 0, inner)
        afeById.set(inner.id, inner)
      }
    }
    return text
  }
  /**
   * Closes what an end tag closes, as a browser does, and returns whether it
   * is to be dropped: htmlparser2 would close the nearest open element of its
   * name wherever it is.
   */
  const outerClose = (name: string, anyOther = anyOtherEnd(name)): boolean => {
    if (VOID.has(name)) return false
    const open = last(outerByName.get(name))
    // Nothing of its name is open: htmlparser2 closes nothing either (a </p> opens an empty <p>, as in a browser).
    if (open < 0) return false
    // In svg or math (an integration point too, as end tags there are its
    // own), an end tag of one of its elements closes it there. Any other is
    // read as HTML: it closes the nearest HTML element of its name unless an
    // integration point or the end of a scope (a cell, a table, an <object>)
    // comes first, or, for an end tag such as </span>, any
    // special element (the element itself aside): a browser ignores it
    // there. A </template> closes the nearest template wherever it is, and
    // a </noscript> (and the like) its element, whose content a browser
    // reads as text, so it holds no element to stop at.
    const stop = Math.max(last(outerIntegration), last(outerScope), anyOther ? last(outerSpecial) : -1)
    if (open > last(outerHtml) || (isOuterHtml(outer[open]!) && open >= stop) || name === 'template' || TEXT_CONTENT.has(name)) {
      outerPopTo(open)
      return false
    }
    return true
  }
  const insert = (at: number, text: string) => {
    if (text !== '') edits.push({ at, end: at, text })
  }

  const startTag = (name: string, at: number, end: number, selfClosing: boolean, attrs = ''): void => {
    tagStart = at
    // Outside tables, and in a cell (but its table tags, and a table in it after the body rules, go to the table rules).
    const cell = inCell()
    if (tables === 0 || cell) {
      if (cell && (name === 'body' || name === 'html')) return
      if (inOuterForeign()) {
        if (!BREAKOUT.has(name)) {
          outerImplied(name)
          // svg and math elements, self-closing ones closed at once, as htmlparser2 and a browser close them.
          if (!selfClosing && !VOID.has(name)) outerPush(foreignEntry(name))
          return
        }
        insert(at, leaveOuterForeign())
      }
      if (cell && (TABLE_TAGS.has(name) || name === 'col') && name !== 'table') return tableStart(name, at, end, selfClosing)
      const stray = !cell && STRAY.has(name) && (ended > 0 || (whole && templatesOutside === 0 && outerRoots.length === 0))
      if (stray) return void edits.push({ at, end, text: '' })
      // In htmlparser2's order: the end tags written before the tag, the formatting elements reopened, then its implied closes.
      let text = outerBrowserCloses(name)
      const formatting = formattingOn()
      if (formatting) {
        // A <a> while one is open ends it first (and a <nobr> a <nobr>), as its end tag would.
        if (name === 'a' && afeLast('a') >= 0) {
          const open = afe[afeLast('a')]!
          text += adoption('a') ?? ''
          if (afeById.has(open.id)) afeRemove(open)
        }
        if (!NO_RECONSTRUCT.has(name)) text += reconstruct()
        if (name === 'nobr' && outerOpen('nobr') > last(outerScope)) text += (adoption('nobr') ?? '') + reconstruct()
      }
      insert(at, text)
      outerImplied(name)
      if (name !== 'table' && !VOID.has(name) && !(FOREIGN.has(name) && selfClosing)) {
        const id = outerPush(name, at, end)
        if (formatting && FORMATTING.has(name)) afeAdd({ id, name, attrs })
        if (MARKERS.has(name)) afe.push(null)
      }
      if (name === 'table') {
        if (cell) return tableStart(name, at, end, selfClosing)
        push(name)
      } else if (name === 'template') templatesOutside++
      return
    }
    tableStart(name, at, end, selfClosing)
  }

  /** A start tag by the table rules: where rows, cells and row groups belong, and a cell's table tags. */
  const tableStart = (name: string, at: number, end: number, selfClosing: boolean): void => {
    let text = ''
    if (inForeign()) {
      if (!BREAKOUT.has(name)) {
        // svg and math elements, self-closing ones closed at once, as htmlparser2 and a browser close them.
        if (!selfClosing) push(`^${name}`)
        return
      }
      text += leaveForeign()
    }
    if (FOREIGN.has(name) && selfClosing) return insert(at, text)
    impliedCloses(name)
    let [mode, index] = innermost()
    // A column group holds only columns: anything else closes it and goes where the table puts it.
    if (mode === 'colgroup' && name !== 'col' && name !== 'template') {
      text += popTo(index, true)
      ;[mode, index] = innermost()
    }
    // A browser closes the caption or column group at a row, cell or row group.
    const closeAside = () => {
      if (mode === 'caption' || mode === 'colgroup') {
        text += popTo(index, true)
        ;[mode, index] = innermost()
      }
    }
    if (name === 'td' || name === 'th') {
      closeAside()
      if (mode === 'td' || mode === 'th') {
        text += popTo(index, true)
        ;[mode, index] = innermost()
      }
      if (mode === 'tr') text += popTo(index, false)
      else if (mode !== '') {
        text += popTo(index, false)
        if (mode === 'table') text += openImpliedTbody()
        text += '<tr>'
        push('tr')
      }
      push(name)
    } else if (name === 'tr') {
      closeAside()
      if (mode === 'td' || mode === 'th') {
        text += popTo(index, true)
        ;[mode, index] = innermost()
      }
      if (mode === 'tr') {
        text += popTo(index, true)
        ;[mode, index] = innermost()
      }
      text += popTo(index, false)
      if (mode === 'table') text += openImpliedTbody()
      push(name)
    } else if (GROUPS.has(name) || name === 'caption' || name === 'colgroup' || (name === 'col' && mode !== 'colgroup')) {
      // Close everything above the table (or template).
      text += popTo(Math.max(last(byName.get('table')), last(byName.get('template'))), false)
      if (name !== 'col') push(name)
    } else if (name === 'table' && !CONTENT.has(mode)) {
      // A table where rows belong ends the table there, and follows it; in a
      // <template>, where no table is in scope, a browser ignores the tag.
      const table = inTableScope('table')
      if (table < 0) {
        edits.push({ at, end, text: '' })
        return
      }
      text += popTo(table, true)
      if (tables === 0) ended++
      push(name)
    } else if (name === 'body' || name === 'html') {
      // Ignored inside a table, and never on htmlparser2's stack.
    } else if (!VOID.has(name)) {
      // htmlparser2 ignores a self-closing slash on an HTML element, as a browser does.
      push(name)
    }
    insert(at, text)
  }

  const endTag = (name: string, at: number, end: number, spaced: boolean): void => {
    tagStart = at
    const drop = (): void => {
      edits.push({ at, end, text: '' })
    }
    // In a cell, its table tags (a </td>, a </table>) go to the table rules, the others to the body rules, as does a
    // table tag that closes an svg or math element of its name (an svg's <td>).
    const cell = inCell() && (!TABLE_TAGS.has(name) || last(outerByName.get(name)) > last(outerHtml))
    if (cell && (spaced || name === 'body' || name === 'html')) return drop()
    if (tables === 0 || cell) {
      if (!cell) {
        if (whole && (name === 'body' || name === 'html')) return drop()
        if (ended > 0 && TABLE_TAGS.has(name) && name !== 'template') {
          if (name === 'table') ended--
          return drop()
        }
        if (STRAY.has(name) && whole && templatesOutside === 0 && outerRoots.length === 0) return drop()
        if (name === 'template' && templatesOutside > 0) templatesOutside--
      }
      // </p> and </br> end the svg or math they are written in, as a <p> does.
      if ((name === 'p' || name === 'br') && inOuterForeign()) insert(at, leaveOuterForeign())
      // A heading's end tag closes the nearest heading of any level in scope: written out as that one's, which htmlparser2 closes.
      if (HEADINGS.has(name) && !inOuterForeign()) {
        const heading = Math.max(...[...HEADINGS].map(outerOpen))
        if (heading > last(outerScope) && outer[heading] !== name) {
          edits.push({ at, end, text: `</${outer[heading]}>` })
          outerPopTo(heading)
          return
        }
      }
      // A </li> closes a <li> only in list item scope (not past a <ul> or <ol>), a </p> a <p> in button scope, and </dd> and
      // </dt> theirs in scope; htmlparser2 closed the nearest anywhere. A browser ignores the tag there, and opens an empty
      // <p> at a </p>.
      if ((name === 'li' || name === 'p' || name === 'dd' || name === 'dt') && !inOuterForeign() && outerOpaque.length === 0) {
        const open = outerOpen(name)
        const bound = name === 'li' ? Math.max(outerOpen('ul'), outerOpen('ol')) : name === 'p' ? outerOpen('button') : -1
        if (open >= 0 && open < Math.max(bound, last(outerScope))) return void edits.push({ at, end, text: name === 'p' ? '<p></p>' : '' })
      }
      /** Closes as htmlparser2 would; a formatting element it closes leaves the list too, or it would be reopened. */
      const closeAsWritten = (anyOther?: boolean): void => {
        const open = FORMATTING.has(name) ? outerOpen(name) : -1
        const id = open >= 0 ? outerIds[open]! : -1
        if (outerClose(name, anyOther)) drop()
        else if (id >= 0 && !idIndex.has(id) && afeById.has(id)) afeRemove(afeById.get(id)!)
      }
      if (FORMATTING.has(name) && formattingOn()) {
        const text = adoption(name)
        if (text === null) closeAsWritten(true)
        else if (text === undefined) closeAsWritten()
        else if (text !== `</${name}>`) edits.push({ at, end, text })
        return
      }
      const marker = MARKERS.has(name) && outerOpen(name) >= 0
      closeAsWritten()
      if (marker && outerOpen(name) < 0) afeClearToMarker()
      return
    }
    // A </template> for a template opened before the table closes it, and the tables in it.
    if (name === 'template' && !spaced && last(byName.get('template')) < 0 && templatesOutside > 0) {
      popTo(0, true)
      templatesOutside--
      outerClose(name)
      return
    }
    // `</ td>`: htmlparser2 reads an end tag, a browser a comment.
    if (spaced) return drop()
    // In svg or math (an integration point too, as end tags there are svg's or
    // math's), an end tag of one of its elements closes it there; any other is
    // read as HTML, and when it closes an element outside, the svg or math
    // ends with it: its end tag is written out first, so htmlparser2 leaves
    // the svg or math too.
    let leaving = ''
    // </p> and </br> end the svg or math they are written in, as a <p> does (not at an integration point, whose content is HTML).
    if (inForeign() && (name === 'p' || name === 'br')) insert(at, leaveForeign())
    const start = foreignStart()
    if (start >= 0) {
      // A browser looks through every svg and math element above the nearest HTML one: integration points and inner svgs too.
      const open = Math.max(last(byName.get(`^${name}`)), FOREIGN.has(name) ? last(byName.get(name)) : -1)
      if (open > last(plainPos)) {
        popTo(open, true)
        return
      }
      leaving = `</${stack[start]}>`
    }
    const close = (index: number): void => {
      insert(at, leaving)
      popTo(index, true)
    }
    if (name === 'br' || VOID.has(name)) return
    if (name === 'body' || name === 'html') return drop()
    if (TABLE_TAGS.has(name)) {
      if (name === 'colgroup') {
        const [mode, index] = innermost()
        if (mode === 'colgroup') close(index)
        else drop()
        return
      }
      const found = name === 'template' ? last(byName.get('template')) : inTableScope(name)
      if (found < 0) return drop()
      if (stack[found] === IMPLIED_TBODY) {
        // htmlparser2 holds no <tbody> to close: close what a browser closes with it instead.
        edits.push({ at, end, text: leaving + popTo(found, true) })
        return
      }
      close(found)
      return
    }
    // Any other end tag closes the nearest open element of its name, unless a
    // table element or an svg or math integration point (both special to a
    // browser) comes first, or, for an end tag such as </span>, any special
    // element: </span> in <span><div> closes nothing.
    const open = last(byName.get(name))
    if (open > last(tablePos) && open > last(integrationPos) && (!anyOtherEnd(name) || open >= last(specialPos) || TEXT_CONTENT.has(name))) close(open)
    else drop()
  }

  const tokenizer = new Tokenizer(
    { decodeEntities: true },
    {
      onopentagname(start, endIndex) {
        tagAt = start - 1
        tagName = html.slice(start, endIndex).toLowerCase()
        tagNameEnd = endIndex
      },
      onopentagend(endIndex) {
        startTag(tagName, tagAt, endIndex + 1, false, html.slice(tagNameEnd, endIndex))
      },
      onselfclosingtag(endIndex) {
        startTag(tagName, tagAt, endIndex + 1, true, html.slice(tagNameEnd, endIndex).replace(/\/[\t\n\f\r ]*$/, ''))
      },
      onclosetag(start, endIndex) {
        // The tag starts at its `</`, which space may separate from the name.
        const open = html.lastIndexOf('<', start)
        const close = html.indexOf('>', endIndex)
        endTag(html.slice(start, endIndex).toLowerCase(), open, close < 0 ? html.length : close + 1, open + 2 < start)
      },
      onattribdata() {},
      onattribentity() {},
      onattribend() {},
      onattribname() {},
      oncdata() {},
      oncomment() {},
      ondeclaration() {},
      onend() {},
      onprocessinginstruction() {},
      ontext(start, endIndex) {
        // A browser reopens the formatting elements it has closed for text.
        if (afe.length > 0 && formattingOn()) insert(start, reconstruct())
        // Text in a column group closes it too, as a browser moves the text out of the table.
        if (tables > 0 && !/^[\t\n\f\r ]*$/.test(html.slice(start, endIndex))) {
          const [mode, index] = innermost()
          if (mode === 'colgroup') insert(start, popTo(index, true))
        }
      },
      ontextentity(_codepoint, endIndex) {
        if (afe.length > 0 && formattingOn()) insert(html.lastIndexOf('&', endIndex - 1), reconstruct())
      },
    },
  )
  tokenizer.write(html)
  tokenizer.end()
  if (edits.length === 0) return html
  // An adoption writes at a block opened earlier: in source order, and in the order written at one place.
  edits.sort((a, b) => a.at - b.at || (b.first ?? 0) - (a.first ?? 0))
  let out = ''
  let from = 0
  for (const edit of edits) {
    out += html.slice(from, edit.at) + edit.text
    from = edit.end
  }
  return out + html.slice(from)
}
