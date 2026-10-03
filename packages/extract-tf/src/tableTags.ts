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
const INTEGRATION = new Set(['svg:foreignobject', 'svg:desc', 'svg:title', 'math:mi', 'math:mo', 'math:mn', 'math:ms', 'math:mtext'])
/** The names htmlparser2 takes for an HTML integration point in any namespace: it honours a self-closing slash outside them only. */
const H2_INTEGRATION = new Set(['mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml', 'foreignobject', 'desc', 'title'])
/**
 * The tag names svg writes in camel case (clipPath, foreignObject, ...). An end
 * tag of one in svg that closes no svg element is ignored by Chromium, which
 * matches it in camel case against the HTML elements outside.
 */
const SVG_CAMEL = new Set(['altglyph', 'altglyphdef', 'altglyphitem', 'animatecolor', 'animatemotion', 'animatetransform', 'clippath', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence', 'foreignobject', 'glyphref', 'lineargradient', 'radialgradient', 'textpath'])
/** An svg or math element is kept on the stack as ^ns:name; its tag name. */
const tagOf = (entry: string): string => (entry.startsWith('^') ? entry.slice(entry.indexOf(':') + 1) : entry)
const isIntegration = (entry: string): boolean => entry.startsWith('^') && INTEGRATION.has(entry.slice(1))
/** HTML start tags that end the svg or math they are written in. */
const BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var'])
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
  ['rt', new Set(['rt', 'rp'])],
  ['rp', new Set(['rt', 'rp'])],
])
/** htmlparser2 closes these also in svg and math, where a browser does not (a <tr> in math closes a <tr> before it). */
const IMPLIES_CLOSE_ANYWHERE = new Map<string, Set<string>>([
  ...IMPLIES_CLOSE,
  ['tr', new Set(['tr', 'th', 'td'])],
  ['th', new Set(['th'])],
  ['td', new Set(['thead', 'th', 'td'])],
  ['tbody', new Set(['thead', 'tbody'])],
  ['tfoot', new Set(['thead', 'tbody'])],
])
/**
 * The HTML elements an end tag of another element does not pass in a browser
 * (its "special" elements); a table's own are tracked as table elements.
 */
const SPECIAL = new Set(['address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br', 'button', 'center', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen', 'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext', 'pre', 'script', 'search', 'section', 'select', 'source', 'style', 'summary', 'textarea', 'title', 'track', 'ul', 'wbr', 'xmp'])
/** Formatting elements: a browser closes them by its adoption agency algorithm, which this does not follow. */
const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u'])
/**
 * End tags a browser applies when their element is in scope, whatever special
 * element lies between (its own rules for them). A <select> closes back to
 * itself; <noscript>, <iframe>, <noembed> and <noframes> hold text to a
 * browser, so the elements htmlparser2 opens in them are not there for it.
 */
const SCOPED_END = new Set(['select', 'noscript', 'iframe', 'noembed', 'noframes', 'address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'listing', 'main', 'menu', 'nav', 'ol', 'pre', 'search', 'section', 'summary', 'ul', 'li', 'dd', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'form', 'applet', 'marquee', 'object'])

/** The table tags a browser ignores outside any table (outside a template, svg or math). */
const STRAY = new Set(['caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])

/**
 * `whole` (default: the HTML has an `<html>` tag or a doctype, as the
 * converter decides) is a page as a browser would read it: a table tag
 * outside any table is dropped, as a browser ignores it. A fragment, such as
 * the main content of a layout table serialized from its tree, keeps them.
 */
export function normalizeTableTags(html: string, whole = /<html[\s>]|<!doctype/i.test(html)): string {
  if (!(whole ? /<(table|t[dhr]|thead|tbody|tfoot|caption|col)/i : /<table/i).test(html)) return html
  // Replace [at, end) with text, in source order.
  const edits: { at: number; end: number; text: string }[] = []
  // The elements a browser has open from the outermost table in, innermost last.
  const stack: string[] = []
  let tables = 0
  // Tables a browser ended early, at a <table> where their rows belong, whose own tags still follow outside any table:
  // a browser ignores those table tags there, and the </table> each still has.
  let ended = 0
  // The templates, and svg or math elements, open outside any table: a browser reads table tags in them.
  let templatesOutside = 0
  let foreignOutside = 0
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
  // The elements by which htmlparser2 decides whether it is in svg or math (its foreignContext).
  const h2Context: number[] = []
  // The special HTML elements (other than a table's own).
  const specialPos: number[] = []
  const byName = new Map<string, number[]>()
  const last = (list: number[] | undefined): number => (list !== undefined && list.length > 0 ? list[list.length - 1]! : -1)

  const push = (name: string) => {
    const i = stack.length
    stack.push(name)
    if (TABLE_TAGS.has(name)) tablePos.push(i)
    if (!name.startsWith('^') && !FOREIGN.has(name)) plainPos.push(i)
    if (FOREIGN.has(name)) regionPos.push(i)
    if (isIntegration(name)) integrationPos.push(i)
    if (SPECIAL.has(name)) specialPos.push(i)
    if (FOREIGN.has(tagOf(name)) || H2_INTEGRATION.has(tagOf(name))) h2Context.push(i)
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
      if (isIntegration(name)) integrationPos.pop()
      if (SPECIAL.has(name)) specialPos.pop()
      if (FOREIGN.has(tagOf(name)) || H2_INTEGRATION.has(tagOf(name))) h2Context.pop()
      if (TABLE_TAGS.has(name)) tablePos.pop()
      if (name === IMPLIED_TBODY) impliedClosed.add(last(byName.get('table')))
      // An svg or math element is closed by name too: one may be called td, and htmlparser2 must leave the svg or math.
      else if (TABLE_TAGS.has(name) || name.startsWith('^') || FOREIGN.has(name)) text += `</${tagOf(name)}>`
      else {
        // An element in a cell closes with the cell's end tag; one at the table's own level is open in htmlparser2's tree there.
        const below = last(tablePos)
        if (below >= 0 && !CONTENT.has(stack[below]!)) text += `</${tagOf(name)}>`
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
  const inForeign = (): boolean => foreignStart() >= 0 && !isIntegration(stack[stack.length - 1]!)
  /** The end tags that close the svg or math the current element is in, innermost first, so each closes its own element in htmlparser2. */
  const foreignEnds = (): string => {
    let text = ''
    for (let i = stack.length - 1; i >= foreignStart(); i--) text += `</${tagOf(stack[i]!)}>`
    return text
  }
  /** Ends the svg or math the current element is in, writing out its end tags so htmlparser2 leaves it too. */
  const leaveForeign = (): string => {
    const text = foreignEnds()
    popTo(foreignStart(), true)
    return text
  }
  /** The namespace of the svg or math the current element is in. */
  const namespace = (): string => {
    const top = stack[stack.length - 1]!
    return top.startsWith('^') ? top.slice(1, top.indexOf(':')) : top
  }
  const impliedCloses = (name: string): void => {
    const closes = IMPLIES_CLOSE.get(name)
    while (closes !== undefined && stack.length > 0 && closes.has(stack[stack.length - 1]!)) popTo(stack.length - 1, true)
  }
  const insert = (at: number, text: string) => {
    if (text !== '') edits.push({ at, end: at, text })
  }

  const startTag = (name: string, at: number, end: number, selfClosing: boolean): void => {
    if (tables === 0) {
      if (name === 'table') push(name)
      else if (name === 'template') templatesOutside++
      else if (FOREIGN.has(name) && !selfClosing) foreignOutside++
      else if (STRAY.has(name) && (ended > 0 || (whole && templatesOutside === 0 && foreignOutside === 0))) edits.push({ at, end, text: '' })
      return
    }
    let text = ''
    if (inForeign()) {
      if (!BREAKOUT.has(name)) {
        // svg and math elements, self-closing ones closed at once, as a browser closes them; where
        // htmlparser2 thinks itself in an integration point, it ignores the slash, so the end tag is written out.
        // htmlparser2's implied closes of the svg or math elements before it.
        const closes = IMPLIES_CLOSE_ANYWHERE.get(name)
        while (closes !== undefined && stack.length - 1 > last(plainPos) && closes.has(tagOf(stack[stack.length - 1]!))) popTo(stack.length - 1, true)
        if (!selfClosing) push(`^${namespace()}:${name}`)
        else {
          // htmlparser2 honours the slash when, with the element open, it thinks itself in svg or math.
          const h2Foreign = FOREIGN.has(name) || (!H2_INTEGRATION.has(name) && FOREIGN.has(tagOf(stack[last(h2Context)] ?? '')))
          if (!h2Foreign) insert(end, `</${name}>`)
        }
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
      if (name === 'template' && templatesOutside > 0) templatesOutside--
      else if (FOREIGN.has(name) && foreignOutside > 0) foreignOutside--
      else if (ended > 0 && TABLE_TAGS.has(name) && name !== 'template') {
        if (name === 'table') ended--
        drop()
      } else if (STRAY.has(name) && whole && templatesOutside === 0 && foreignOutside === 0) drop()
      return
    }
    // A </template> for a template opened before the table closes it, and the tables in it.
    if (name === 'template' && !spaced && last(byName.get('template')) < 0 && templatesOutside > 0) {
      popTo(0, true)
      templatesOutside--
      return
    }
    // `</ td>`: htmlparser2 reads an end tag, a browser a comment.
    if (spaced) return drop()
    // In svg or math (an integration point too, as end tags there are svg's or
    // math's), an end tag of one of its elements closes it there; any other is
    // read as HTML, and when it closes an element outside, the svg and math
    // elements above it end with it.
    // </p> and </br> end the svg or math they are written in, as a <p> does (not at an integration point, whose content is HTML).
    if (inForeign() && (name === 'p' || name === 'br')) insert(at, leaveForeign())
    const start = foreignStart()
    if (start >= 0) {
      // A browser looks through every svg and math element above the nearest HTML one: integration points and inner svgs too.
      const open = Math.max(last(byName.get(`^svg:${name}`)), last(byName.get(`^math:${name}`)), FOREIGN.has(name) ? last(byName.get(name)) : -1)
      if (open > last(plainPos)) {
        popTo(open, true)
        return
      }
      if (namespace() === 'svg' && SVG_CAMEL.has(name)) return drop()
    }
    // The end tags of the svg and math elements above an element closed by an end tag
    // are written out first: htmlparser2 would close the nearest element of the name,
    // which may be an svg's own <td>.
    const close = (index: number): void => {
      let text = ''
      for (let i = stack.length - 1; i > index; i--) if (stack[i]!.startsWith('^') || FOREIGN.has(stack[i]!)) text += `</${tagOf(stack[i]!)}>`
      insert(at, text)
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
        edits.push({ at, end, text: popTo(found, true) })
        return
      }
      close(found)
      return
    }
    // Any other end tag closes the nearest open element of its name, unless a
    // table element or an svg or math integration point (both special to a
    // browser) comes first.
    const open = last(byName.get(name))
    // Any other end tag also stops at a special element on the way (a <p>, <div>, ...); a block's end tag
    // (</div>, </ul>, ...) closes its element in scope, and a formatting element's (<b>, <a>, ...) is left to htmlparser2.
    if (open > last(tablePos) && open > last(integrationPos) && (FORMATTING.has(name) || SCOPED_END.has(name) || open >= last(specialPos))) close(open)
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
