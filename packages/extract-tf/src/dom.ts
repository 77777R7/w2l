/**
 * Thin DOM adapter over linkedom. The bake-off (research/dom_bakeoff.md)
 * settled on linkedom as the DOM; this module keeps every linkedom
 * touchpoint in one file so the implementation can be swapped for jsdom as a
 * regression oracle without touching the cascade.
 *
 * The tree is built by parse5, the HTML standard's tree construction, and
 * copied node by node into linkedom: htmlparser2 (linkedom's own parser)
 * closes and nests misnested markup otherwise than a browser (a stray end tag
 * closed cells and whole tables, a misnested <b> was not reopened, a table in
 * a cell's <thead> stayed in the cell).
 */

import { parseHTML } from 'linkedom'
import { defaultTreeAdapter, html as htmlSpec, Parser, Tokenizer } from 'parse5'
import type { DefaultTreeAdapterMap, DefaultTreeAdapterTypes as Spec, ParserOptions, Token } from 'parse5'

export interface DomDoc {
  document: Document
  /** Release resources when available (no-op for linkedom). */
  close(): void
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'

const GROUP_ENDS = new Set([htmlSpec.TAG_ID.TBODY, htmlSpec.TAG_ID.TFOOT, htmlSpec.TAG_ID.THEAD])
/** parse5 8.0.1's InsertionMode.IN_ROW, which it does not export (the version is pinned). */
const IN_ROW = 13
/** parse5 8.0.1's IN_TABLE_TEXT and IN_COLUMN_GROUP. */
const IN_TABLE_TEXT = 9
const IN_COLUMN_GROUP = 11
/** parse5 8.0.1's IN_TABLE, IN_TABLE_BODY and IN_ROW: the modes that read a <form> by the table's rules. */
const TABLE_MODES = new Set([8, 12, IN_ROW])
/** parse5 8.0.1's IN_BODY, IN_TABLE, IN_CAPTION, IN_TABLE_BODY, IN_ROW and IN_CELL: the modes that read a </form> by the body's rules. */
const BODY_RULE_MODES = new Set([6, 8, 10, 12, IN_ROW, 14])

/** Thrown when a page would hold more elements than its tags account for. */
const TOO_MANY = new Error('element budget')

/**
 * The most attributes one tag may have: parse5 checks each new one against
 * those before it, and linkedom's setAttribute does too, so a tag of 100,000
 * attributes took half a minute. Pages have at most 47 (120 captured pages).
 * Past it the page is parsed by linkedom.
 */
const MAX_ATTRIBUTES = 256

const TABLE_SCOPE = new Set([htmlSpec.TAG_ID.HTML, htmlSpec.TAG_ID.TABLE, htmlSpec.TAG_ID.TEMPLATE])

/** Whether an HTML element `target` takes is open in table scope: above the nearest <html>, <table> or <template>. */
function tableScoped(stack: Parser<DefaultTreeAdapterMap>['openElements'], target: (tagID: htmlSpec.TAG_ID) => boolean): boolean {
  for (let i = stack.stackTop; i >= 0; i--) {
    if (defaultTreeAdapter.getNamespaceURI(stack.items[i] as Spec.Element) !== HTML_NS) continue
    const id = stack.tagIDs[i]!
    if (target(id)) return true
    if (TABLE_SCOPE.has(id)) return false
  }
  return false
}

class StandardTokenizer extends Tokenizer {
  protected override _leaveAttrName(): void {
    const token = this.currentToken
    if (token !== null && 'attrs' in token && token.attrs.length >= MAX_ATTRIBUTES) throw TOO_MANY
    super._leaveAttrName()
  }
}

/**
 * parse5 with seven changes:
 * - Its table scope stopped only at <table> and <html>, not at <template>, so
 *   a </table>, </tr> or row group end tag in a template that is in a table
 *   closed the cells, rows and table outside the template, and a <tr> or <td>
 *   in a template in a row group ended the template. The standard's table
 *   scope stops at <template> as well (tableScoped).
 * - A <form> in a table in a <template> is kept where it is written and closed
 *   at once, without becoming the page's form, as Chromium keeps it (its
 *   HTMLTreeBuilder drops it only when a form is open outside any template).
 *   The standard drops it whenever a template is open.
 * - A </form> in a <template> closes its form as any other end tag closes its
 *   element, as in Chromium: not past a <p>, <div>, <li> or other special
 *   element still open in it. The standard closes those first.
 * - A fragment that starts with a <col> (its template's mode is then the
 *   column group's) loses a table's text still pending at its end, as in
 *   Chromium's template.innerHTML; the standard writes it. The formatting
 *   elements the text re-opens are still re-opened. Such text is always in a
 *   nested <template>, which no output reads.
 * - In a row it closed the row at a </tbody>, </tfoot> or </thead> whose row
 *   group is not open, where the standard (and Chromium) ignores the tag.
 * - It moved a node's children one by one, each found by a linear search, so a
 *   fragment of 200,000 lines, or a misnested <b> around a block of 80,000,
 *   took seconds: they move together.
 * - Its tokenizer stops at a tag of too many attributes (MAX_ATTRIBUTES).
 */
class StandardParser extends Parser<DefaultTreeAdapterMap> {
  constructor(...args: ConstructorParameters<typeof Parser<DefaultTreeAdapterMap>>) {
    super(...args)
    this.tokenizer = new StandardTokenizer(this.options, this)
    const stack = this.openElements
    stack.hasInTableScope = (tagID) => tableScoped(stack, (id) => id === tagID)
    stack.hasTableBodyContextInTableScope = () => tableScoped(stack, (id) => GROUP_ENDS.has(id))
  }

  override _startTagOutsideForeignContent(token: Token.TagToken): void {
    // In table text or a column group parse5 first leaves the mode and sends the tag here again.
    if (token.tagID === htmlSpec.TAG_ID.FORM && TABLE_MODES.has(this.insertionMode as number) && this.openElements.tmplCount > 0) {
      this._insertElement(token, htmlSpec.NS.HTML)
      this.openElements.pop()
      return
    }
    super._startTagOutsideForeignContent(token)
  }

  override onEof(token: Token.EOFToken): void {
    const fragmentMode = this.tmplInsertionModeStack[this.tmplInsertionModeStack.length - 1]
    if (this.fragmentContext !== null && (this.insertionMode as number) === IN_TABLE_TEXT && (fragmentMode as number | undefined) === IN_COLUMN_GROUP) {
      // Text that is not all whitespace still re-opens the formatting elements before the table first; only the text is lost.
      if (this.hasNonWhitespacePendingCharacterToken) {
        const fostering = this.fosterParentingEnabled
        this.fosterParentingEnabled = true
        this._reconstructActiveFormattingElements()
        this.fosterParentingEnabled = fostering
      }
      this.pendingCharacterTokens.length = 0
      this.hasNonWhitespacePendingCharacterToken = false
    }
    super.onEof(token)
  }

  override _endTagOutsideForeignContent(token: Token.TagToken): void {
    if ((this.insertionMode as number) === IN_ROW && GROUP_ENDS.has(token.tagID) && !this.openElements.hasInTableScope(token.tagID)) return
    if (token.tagID === htmlSpec.TAG_ID.FORM && BODY_RULE_MODES.has(this.insertionMode as number) && this.openElements.tmplCount > 0) {
      this.endTagAsAnyOther(htmlSpec.TAG_ID.FORM)
      return
    }
    super._endTagOutsideForeignContent(token)
  }

  /** The standard's "any other end tag" in the body: the nearest open element of the tag closes, unless a special element is open above it. */
  private endTagAsAnyOther(tagID: htmlSpec.TAG_ID): void {
    const stack = this.openElements
    for (let i = stack.stackTop; i > 0; i--) {
      const element = stack.items[i] as Spec.Element
      const id = stack.tagIDs[i]!
      if (id === tagID && defaultTreeAdapter.getNamespaceURI(element) === HTML_NS) {
        stack.generateImpliedEndTagsWithExclusion(tagID)
        if (stack.stackTop >= i) stack.shortenToLength(i)
        return
      }
      if (this._isSpecialElement(element, id)) return
    }
  }

  override _adoptNodes(donor: Spec.ParentNode, recipient: Spec.ParentNode): void {
    const children = donor.childNodes
    donor.childNodes = []
    for (const child of children) {
      child.parentNode = recipient
      recipient.childNodes.push(child)
    }
  }
}

/**
 * parse5's options with an element and a work budget. The standard re-creates
 * every formatting element a block closed in each block after it, so N
 * differently attributed <b> closed by a </div> and then N paragraphs make
 * N x N elements (an 18 KB page makes a million, a 56 KB one runs out of
 * memory), and it compares each new <b> with every open one. A start tag
 * accounts for a few elements (its own, an implied <tbody> and <tr>, a
 * reopened <b>), and pages read about 0.05 element names per tag (at most
 * 0.13 on 120 captured pages); past four elements or twenty names per `<`,
 * or more attributes than half the page's length (each reopened element
 * copies its own; pages make at most 0.012 per character), the page is parsed
 * by linkedom instead.
 */
function budgeted(html: string): ParserOptions<DefaultTreeAdapterMap> {
  let tags = 0
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i + 1)) tags++
  let elements = 4 * tags + 1000
  let reads = 20 * tags + 10_000
  let attributes = html.length / 2 + 1000
  return {
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement(tagName, namespaceURI, attrs) {
        attributes -= attrs.length
        if (--elements < 0 || attributes < 0) throw TOO_MANY
        return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs)
      },
      getTagName(element) {
        if (--reads < 0) throw TOO_MANY
        return defaultTreeAdapter.getTagName(element)
      },
      // A later <html> or <body> start tag adds its attributes to the first one's element.
      adoptAttributes(recipient, attrs) {
        attributes -= attrs.length
        if (attributes < 0 || recipient.attrs.length + attrs.length > MAX_ATTRIBUTES) throw TOO_MANY
        defaultTreeAdapter.adoptAttributes(recipient, attrs)
      },
    },
  }
}

function parseFragment(html: string, options: ParserOptions<DefaultTreeAdapterMap>): Spec.DocumentFragment {
  const parser = StandardParser.getFragmentParser<DefaultTreeAdapterMap>(null, options)
  parser.tokenizer.write(html, true)
  return parser.getFragment()
}

/**
 * A page as a browser builds it. `fragment`: the HTML is part of a page (the
 * main content the converter is given, for example), read as a <template>'s
 * content would be, so a row or cell of a table stays one; it goes in the body.
 */
export function parse(html: string, fragment = false): DomDoc {
  try {
    return parseStandard(html, fragment)
  } catch (error) {
    if (error !== TOO_MANY) throw error
    // A page whose <noscript> went past what its tree left of the budget: it is parsed so every time.
    const built = fragment ? undefined : recentPages.find((page) => page.html === html)
    if (built !== undefined) built.tree = null
    // linkedom's own parser: no formatting element is reopened, so its tree stays as large as the page.
    const body = fragment ? BODY.exec(html) : null
    const page = fragment
      ? `<html><head></head>${body !== null ? `<body${body[1]}>${body[2]}</body>` : `<body>${html}</body>`}</html>`
      : /<html[\s>]/i.test(html) ? html : /<body[\s>]/i.test(html) ? `<html>${html}</html>` : `<html><head></head><body>${html}</body></html>`
    const { document } = parseHTML(page) as unknown as { document: Document }
    return { document, close: () => {} }
  }
}

/**
 * A fragment written as one `<body …>…</body>` (a selection): its body's
 * attributes and what it holds. Parsed as a <template>'s content, a <body>
 * tag would switch to the body's rules and drop the rows and cells after it.
 */
const BODY = /^\s*<body((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>([\s\S]*)<\/body>\s*$/i

/**
 * The last two pages parse5 built, the latest first. One request reads its
 * page several times (main-content selection, the Markdown, `tables`, links,
 * images), and the tree is only read when copied, so a page parsed again is
 * copied from it. Two, because the browser lane reads two by turns: the page
 * as rendered for selection, Markdown and tables, the body as received for
 * links and images. They are held only until the next task: a server does not
 * keep a large page's tree after the request, and a loop over pages keeps two.
 * (A WeakRef would not do: what one synchronous job creates is kept until it
 * ends, so a loop over thousands of pages would keep every tree.)
 */
const recentPages: { html: string; tree: Spec.Document | null }[] = []
const RECENT_PAGES = 2
let clearing = false

/** The tree parse5 builds from a page, or null when it is past the budget. */
function specPage(html: string, options: () => ParserOptions<DefaultTreeAdapterMap>): Spec.Document | null {
  const recent = recentPages.find((page) => page.html === html)
  if (recent !== undefined) return recent.tree
  let tree: Spec.Document | null
  try {
    tree = StandardParser.parse<DefaultTreeAdapterMap>(html, options())
  } catch (error) {
    if (error !== TOO_MANY) throw error
    tree = null
  }
  recentPages.unshift({ html, tree })
  recentPages.length = Math.min(recentPages.length, RECENT_PAGES)
  if (!clearing) {
    clearing = true
    setTimeout(() => {
      recentPages.length = 0
      clearing = false
    }, 0)
  }
  return tree
}

function parseStandard(html: string, fragment: boolean): DomDoc {
  let budget: ParserOptions<DefaultTreeAdapterMap> | undefined
  const options = (): ParserOptions<DefaultTreeAdapterMap> => (budget ??= budgeted(html))
  const { document } = parseHTML('<html><head></head><body></body></html>') as unknown as { document: Document }
  // A loop, not recursion: a page may be thousands of elements deep.
  const copy = (top: Spec.ParentNode, into: Node): void => {
    const work: [Spec.ParentNode, Node][] = [[top, into]]
    for (let next = work.pop(); next !== undefined; next = work.pop()) {
      const [from, to] = next
      // An HTML <template>'s children are its content; an svg <template> has none.
      const content = from.nodeName === 'template' ? (from as Spec.Template).content : undefined
      let nodes = content !== undefined ? content.childNodes : from.childNodes
      // A browser running scripts reads a <noscript>'s content as text; its elements are kept
      // (the images and links in it are the page's), parsed as the fragment they are.
      if (from.nodeName === 'noscript' && (from as Spec.Element).namespaceURI === HTML_NS && nodes.length === 1 && nodes[0]!.nodeName === '#text') {
        nodes = parseFragment((nodes[0] as Spec.TextNode).value, options()).childNodes
      }
      for (const node of nodes) {
        if (node.nodeName === '#text') to.appendChild(document.createTextNode((node as Spec.TextNode).value))
        else if (node.nodeName === '#comment') to.appendChild(document.createComment((node as Spec.CommentNode).data))
        else if ('tagName' in node) {
          const el = node.namespaceURI === HTML_NS ? document.createElement(node.tagName) : document.createElementNS(node.namespaceURI, node.tagName)
          setAttributes(el, node.attrs)
          to.appendChild(el)
          work.push([node, el])
        }
      }
    }
  }
  const body = fragment ? BODY.exec(html) : null
  if (body !== null) {
    const attrs = StandardParser.parse<DefaultTreeAdapterMap>(`<html><body${body[1]}></body></html>`, options()).childNodes
      .find((node): node is Spec.Element => node.nodeName === 'html')?.childNodes.find((node): node is Spec.Element => node.nodeName === 'body')?.attrs ?? []
    setAttributes(document.body, attrs)
    copy(parseFragment(body[2]!, options()), document.body)
  } else if (fragment) copy(parseFragment(html, options()), document.body)
  else {
    const root = document.documentElement
    while (root.firstChild !== null) root.removeChild(root.firstChild)
    const tree = specPage(html, options)
    if (tree === null) throw TOO_MANY
    const page = tree.childNodes.find((node): node is Spec.Element => node.nodeName === 'html')
    if (page !== undefined) {
      setAttributes(root, page.attrs)
      copy(page, root)
    }
  }
  return {
    document,
    close: () => {},
  }
}

function setAttributes(el: Element, attrs: { name: string; value: string; prefix?: string }[]): void {
  // linkedom puts a new attribute first: set them last to first, so they keep the page's order.
  for (let i = attrs.length - 1; i >= 0; i--) {
    const attr = attrs[i]!
    try {
      el.setAttribute(attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, attr.value)
    } catch {
      // A name no DOM takes (a stray quote in it): a browser keeps it, but nothing reads it.
    }
  }
}

/** All elements matching a CSS selector, in document order. */
export function qsa(scope: ParentNode, selector: string): Element[] {
  try {
    return Array.from(scope.querySelectorAll(selector))
  } catch {
    // Invalid selector: the caller's problem, surfaced as "no match".
    return []
  }
}

export function qs(scope: ParentNode, selector: string): Element | null {
  try {
    return scope.querySelector(selector)
  } catch {
    return null
  }
}

let probe: Document | undefined

/** The DOM layer's complaint about a CSS selector it cannot parse or compile, or null when it can. */
export function selectorSyntaxError(selector: string): string | null {
  try {
    probe ??= parse('<html><body></body></html>').document
    probe.querySelector(selector)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Serialize an element back to HTML. */
export function outerHtml(el: Element): string {
  return el.outerHTML
}

/** Detach a node from the tree (deletion, not hiding). */
export function detach(node: Node): void {
  node.parentNode?.removeChild(node)
}

/**
 * Detach elements a caller named, each with all it holds. A document's root
 * element is emptied instead: linkedom's `head` and `body` getters throw on
 * a document that has none (see `parse`).
 */
export function detachAll(elements: Iterable<Element>): void {
  for (const el of elements) {
    if (el === el.ownerDocument?.documentElement) el.replaceChildren()
    else detach(el)
  }
}

export function textOf(el: Element): string {
  return el.textContent ?? ''
}

/** All element children of a node. */
export function children(el: Element): Element[] {
  return Array.from(el.children)
}

/** Tag name, lower-cased. */
export function tagOf(el: Element): string {
  return el.tagName.toLowerCase()
}

/**
 * Lowest element that contains both `a` and `b`, or null when they are in
 * different trees. Used wherever a strategy must widen from a single anchor
 * node (a heading, a price) to the region that actually holds the content.
 */
export function commonAncestor(a: Element, b: Element): Element | null {
  const ancestors = new Set<Element>()
  let p: Element | null = a.parentElement
  while (p) {
    ancestors.add(p)
    p = p.parentElement
  }
  p = b
  while (p) {
    if (ancestors.has(p)) return p
    p = p.parentElement
  }
  return null
}

/**
 * A table that lays out other tables: the tables nested in it hold at least
 * half of its text (Hacker News puts its header, story list and footer in
 * one). A data table with a small table in one of its cells is not one.
 */
export function isLayoutTable(table: Element): boolean {
  const nested = qsa(table, 'table').filter((inner) => inner.parentElement?.closest('table') === table)
  if (nested.length === 0) return false
  const length = (el: Element): number => (el.textContent ?? '').replace(/\s+/g, '').length
  return nested.reduce((sum, inner) => sum + length(inner), 0) * 2 >= length(table)
}
