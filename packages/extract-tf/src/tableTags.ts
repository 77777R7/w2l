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
 * `whole` (default: the HTML has an `<html>` tag or a doctype, as the
 * converter decides) is a page as a browser would read it: a table tag
 * outside any table is dropped, as a browser ignores it, and so is every
 * `</body>` and `</html>`. A fragment, such as
 * the main content of a layout table serialized from its tree, keeps them.
 */
export function normalizeTableTags(html: string, whole = /<html[\s>]|<!doctype/i.test(html)): string {
  const tableTags = whole ? /<(table|t[dhr]|thead|tbody|tfoot|caption|col)/i : /<table/i
  if (!tableTags.test(html) && (!whole || endsWithBodyEnd(html)) && !breaksOutOfForeign(html)) return html
  // Replace [at, end) with text, in source order.
  const edits: { at: number; end: number; text: string }[] = []
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

  // Where the table elements, the svg and math elements and each name's
  // elements are on the stack, innermost last, so no step walks the stack:
  // a cell may be thousands of elements deep.
  const tablePos: number[] = []
  // The HTML elements (an svg or math opened in HTML starts a run of its
  // elements, kept as ^name), and the HTML integration points in those runs.
  const plainPos: number[] = []
  const integrationPos: number[] = []
  // The svg and math elements opened as HTML (each starts a run), innermost last: one can sit in another's integration point.
  const regionPos: number[] = []
  const byName = new Map<string, number[]>()
  const last = (list: number[] | undefined): number => (list !== undefined && list.length > 0 ? list[list.length - 1]! : -1)

  const push = (name: string) => {
    const i = stack.length
    stack.push(name)
    if (TABLE_TAGS.has(name)) tablePos.push(i)
    if (!name.startsWith('^') && !FOREIGN.has(name)) plainPos.push(i)
    if (FOREIGN.has(name)) regionPos.push(i)
    if (name.startsWith('^') && INTEGRATION.has(name.slice(1))) integrationPos.push(i)
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
      if (TABLE_TAGS.has(name)) tablePos.pop()
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
  /** Opens the <tbody> a browser opens for a row written directly in the table: implied, or written out after an implied one closed. */
  const openImpliedTbody = (): string => {
    if (impliedClosed.has(last(byName.get('table')))) {
      push('tbody')
      return '<tbody>'
    }
    push(IMPLIED_TBODY)
    return ''
  }
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
  // The elements open from the outermost svg or math opened outside any
  // table, innermost last, as htmlparser2 builds them: the svg or math as its
  // name, the svg and math elements in it as ^s:name and ^m:name (by the
  // namespace they are in: an <mi> is an integration point in math, not in
  // svg), and the HTML elements of an integration point (a <foreignObject>,
  // say) as their name. An end tag
  // that closes none of them may close the svg from further out, or nothing:
  // they stay, as an end tag written for them later is ignored either way.
  const outer: string[] = []
  const outerByName = new Map<string, number[]>()
  // Where its HTML elements and its integration points are, innermost last.
  const outerHtml: number[] = []
  const outerIntegration: number[] = []
  const isOuterHtml = (entry: string): boolean => !entry.startsWith('^') && !FOREIGN.has(entry)
  const isOuterIntegration = (entry: string): boolean => entry.startsWith('^') && OUTER_INTEGRATION.has(entry.slice(1))
  const bare = (entry: string): string => (entry.startsWith('^') ? entry.slice(3) : entry)
  const outerPush = (entry: string): void => {
    let list = outerByName.get(bare(entry))
    if (list === undefined) outerByName.set(bare(entry), (list = []))
    list.push(outer.length)
    if (isOuterHtml(entry)) outerHtml.push(outer.length)
    if (isOuterIntegration(entry)) outerIntegration.push(outer.length)
    outer.push(entry)
  }
  const outerPop = (): string => {
    const entry = outer.pop()!
    outerByName.get(bare(entry))!.pop()
    if (isOuterHtml(entry)) outerHtml.pop()
    if (isOuterIntegration(entry)) outerIntegration.pop()
    return entry
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
  /**
   * Closes what an end tag closes, as a browser does, and returns whether it
   * is to be dropped: htmlparser2 would close the nearest open element of its
   * name wherever it is.
   */
  const outerClose = (name: string): boolean => {
    if (VOID.has(name)) return false
    const open = last(outerByName.get(name))
    // In svg or math (an integration point too, as end tags there are its
    // own), an end tag of one of its elements closes it there. Any other is
    // read as HTML: it closes the nearest element of its name unless an
    // integration point comes first, where a browser ignores it, as it does
    // one that finds nothing. A </template> closes the nearest template
    // wherever it is.
    const stop = last(outerIntegration)
    if (open > last(outerHtml) || open > stop || (name === 'template' && open >= 0)) {
      while (outer.length > open) outerPop()
      return false
    }
    return stop >= 0
  }
  const insert = (at: number, text: string) => {
    if (text !== '') edits.push({ at, end: at, text })
  }

  const startTag = (name: string, at: number, end: number, selfClosing: boolean): void => {
    if (tables === 0) {
      if (inOuterForeign()) {
        if (!BREAKOUT.has(name)) {
          outerImplied(name)
          // svg and math elements, self-closing ones closed at once, as htmlparser2 and a browser close them.
          if (!selfClosing && !VOID.has(name)) outerPush(foreignEntry(name))
          return
        }
        insert(at, leaveOuterForeign())
      }
      if (outer.length > 0) {
        outerImplied(name)
        if (name !== 'table' && !VOID.has(name) && !(FOREIGN.has(name) && selfClosing)) outerPush(name)
      } else if (FOREIGN.has(name) && !selfClosing) outerPush(name)
      if (name === 'table') push(name)
      else if (name === 'template') templatesOutside++
      else if (STRAY.has(name) && (ended > 0 || (whole && templatesOutside === 0 && outer.length === 0))) edits.push({ at, end, text: '' })
      return
    }
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
    const drop = (): void => {
      edits.push({ at, end, text: '' })
    }
    if (tables === 0) {
      if (whole && (name === 'body' || name === 'html')) return drop()
      if (ended > 0 && TABLE_TAGS.has(name) && name !== 'template') {
        if (name === 'table') ended--
        return drop()
      }
      if (STRAY.has(name) && whole && templatesOutside === 0 && outer.length === 0) return drop()
      if (name === 'template' && templatesOutside > 0) {
        templatesOutside--
        // A </template> closes the nearest template wherever it is: one opened before the svg, with the svg.
        if (last(outerByName.get(name)) < 0) while (outer.length > 0) outerPop()
      }
      // </p> and </br> end the svg or math they are written in, as a <p> does.
      if ((name === 'p' || name === 'br') && inOuterForeign()) insert(at, leaveOuterForeign())
      if (outerClose(name)) drop()
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
    // browser) comes first.
    const open = last(byName.get(name))
    if (open > last(tablePos) && open > last(integrationPos)) close(open)
    else drop()
  }

  const tokenizer = new Tokenizer(
    { decodeEntities: true },
    {
      onopentagname(start, endIndex) {
        tagAt = start - 1
        tagName = html.slice(start, endIndex).toLowerCase()
      },
      onopentagend(endIndex) {
        startTag(tagName, tagAt, endIndex + 1, false)
      },
      onselfclosingtag(endIndex) {
        startTag(tagName, tagAt, endIndex + 1, true)
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
        // Text in a column group closes it too, as a browser moves the text out of the table.
        if (tables > 0 && !/^[\t\n\f\r ]*$/.test(html.slice(start, endIndex))) {
          const [mode, index] = innermost()
          if (mode === 'colgroup') insert(start, popTo(index, true))
        }
      },
      ontextentity() {},
    },
  )
  tokenizer.write(html)
  tokenizer.end()
  if (edits.length === 0) return html
  let out = ''
  let from = 0
  for (const edit of edits) {
    out += html.slice(from, edit.at) + edit.text
    from = edit.end
  }
  return out + html.slice(from)
}
