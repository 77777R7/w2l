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
import { defaultTreeAdapter, foreignContent, html as htmlSpec, Parser, Tokenizer } from 'parse5'
import type { DefaultTreeAdapterMap, DefaultTreeAdapterTypes as Spec, ParserOptions, Token } from 'parse5'

export interface DomDoc {
  document: Document
  /** Release resources when available (no-op for linkedom). */
  close(): void
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

const GROUP_ENDS = new Set([htmlSpec.TAG_ID.TBODY, htmlSpec.TAG_ID.TFOOT, htmlSpec.TAG_ID.THEAD])
/** parse5 8.0.1's InsertionMode values, which it does not export (the version is pinned). */
const MODE = {
  BEFORE_HEAD: 2, IN_HEAD: 3, AFTER_HEAD: 5, IN_BODY: 6, IN_TABLE: 8, IN_TABLE_TEXT: 9, IN_CAPTION: 10, IN_COLUMN_GROUP: 11,
  IN_TABLE_BODY: 12, IN_ROW: 13, IN_CELL: 14, IN_SELECT: 15, IN_SELECT_IN_TABLE: 16, IN_TEMPLATE: 17, AFTER_BODY: 18,
  IN_FRAMESET: 19, AFTER_AFTER_BODY: 21,
} as const
const IN_ROW = MODE.IN_ROW
const IN_BODY = MODE.IN_BODY
const IN_TEMPLATE = MODE.IN_TEMPLATE
/** The head's tags Chromium reads in a template by the body's rules (it keeps <link>, <meta>, <script>, <style> and <template> to the head's). */
const BODY_IN_TEMPLATE = new Set([htmlSpec.TAG_ID.TITLE, htmlSpec.TAG_ID.BASE, htmlSpec.TAG_ID.BASEFONT, htmlSpec.TAG_ID.BGSOUND, htmlSpec.TAG_ID.NOFRAMES])
const IN_TABLE_TEXT = MODE.IN_TABLE_TEXT
const IN_COLUMN_GROUP = MODE.IN_COLUMN_GROUP
/** The modes that read a <form> by the table's rules. */
const TABLE_MODES = new Set<number>([MODE.IN_TABLE, MODE.IN_TABLE_BODY, IN_ROW])
/** The modes that read an end tag the table's rules leave to the body's rules by the body's. */
const BODY_RULE_MODES = new Set<number>([IN_BODY, MODE.IN_TABLE, MODE.IN_CAPTION, MODE.IN_TABLE_BODY, IN_ROW, MODE.IN_CELL])
const T = htmlSpec.TAG_ID
/** The formatting elements' end tags: the adoption agency's, "any other end tag" when no such element is in the list of active formatting elements. */
const FORMATTING_ENDS = new Set([T.A, T.B, T.BIG, T.CODE, T.EM, T.FONT, T.I, T.NOBR, T.S, T.SMALL, T.STRIKE, T.STRONG, T.TT, T.U])
/** End tags parse5 8.0.1 reads by a rule of their own in BODY_RULE_MODES; every other one is "any other end tag". */
const OWN_END_RULES = new Set([
  ...FORMATTING_ENDS, T.P, T.DL, T.UL, T.OL, T.DIR, T.DIV, T.NAV, T.PRE, T.MAIN, T.MENU, T.ASIDE, T.BUTTON, T.CENTER, T.FIGURE,
  T.FOOTER, T.HEADER, T.HGROUP, T.DIALOG, T.ADDRESS, T.ARTICLE, T.DETAILS, T.SEARCH, T.SECTION, T.SUMMARY, T.LISTING,
  T.FIELDSET, T.BLOCKQUOTE, T.FIGCAPTION, T.LI, T.DD, T.DT, T.H1, T.H2, T.H3, T.H4, T.H5, T.H6, T.BR, T.BODY, T.HTML, T.FORM,
  T.APPLET, T.OBJECT, T.MARQUEE, T.TEMPLATE, T.TABLE, T.CAPTION, T.COL, T.COLGROUP, T.TBODY, T.TD, T.TFOOT, T.TH, T.THEAD, T.TR,
])

/** The deepest chain of copied options selected in turn that is followed; past it the page is parsed by linkedom. */
const MAX_COPY_DEPTH = 100

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

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
/** The bounds of the standard's scopes since <select> became one of them (2025); parse5 8.0.1 does not count it. */
const SCOPE_BOUNDS_HTML = new Set([T.APPLET, T.CAPTION, T.HTML, T.MARQUEE, T.OBJECT, T.SELECT, T.TABLE, T.TD, T.TEMPLATE, T.TH])
const SCOPE_BOUNDS_SVG = new Set([T.FOREIGN_OBJECT, T.DESC, T.TITLE])
const SCOPE_BOUNDS_MATHML = new Set([T.ANNOTATION_XML, T.MI, T.MN, T.MO, T.MS, T.MTEXT])
const LIST_ITEM_BOUNDS = new Set([T.OL, T.UL])
const BUTTON_BOUNDS = new Set([T.BUTTON])
const HEADINGS = new Set([T.H1, T.H2, T.H3, T.H4, T.H5, T.H6])

/**
 * Whether an HTML element of `target` (a tag ID, or any of a set) is open in
 * scope, with `extra` bounds for list item or button scope.
 */
function scoped(stack: Parser<DefaultTreeAdapterMap>['openElements'], target: htmlSpec.TAG_ID | ReadonlySet<htmlSpec.TAG_ID>, extra?: ReadonlySet<htmlSpec.TAG_ID>): boolean {
  const items = stack.items as Spec.Element[]
  const ids = stack.tagIDs
  for (let i = stack.stackTop; i >= 0; i--) {
    const ns = items[i]!.namespaceURI
    const id = ids[i]!
    if (ns === HTML_NS) {
      if (typeof target === 'number' ? id === target : target.has(id)) return true
      if (SCOPE_BOUNDS_HTML.has(id) || (extra !== undefined && extra.has(id))) return false
    } else if (ns === SVG_NS ? SCOPE_BOUNDS_SVG.has(id) : ns === MATHML_NS && SCOPE_BOUNDS_MATHML.has(id)) return false
  }
  return false
}

/** The tags the standard reads by rules of their own while a <select> is open in scope (2025). */
const SELECT_STARTS = new Set([T.SELECT, T.OPTION, T.OPTGROUP, T.HR, T.INPUT])
/** The modes whose "anything else" reads a tag by the body's rules with foster parenting. */
const FOSTER_MODES = new Set<number>([MODE.IN_TABLE, MODE.IN_TABLE_BODY, IN_ROW])

/** A <select>'s state for <selectedcontent>: its options, the selected one, and the <selectedcontent> elements it fills. */
interface SelectState {
  /** The last option inserted with a selected attribute, or else the first enabled one, until it is taken out. */
  selected: Spec.Element | null
  /** Its options in the order they were inserted, each with whether it or its <optgroup> is disabled. */
  options: { option: Spec.Element; disabled: boolean }[]
  /** No option before this index can be selected again: each is disabled or was taken out, which lasts. */
  firstCandidate: number
  members: Set<Spec.Element>
  contents: Spec.Element[]
  /** Each <selectedcontent>'s <optgroup> elements around it in the select, and whether one is disabled, for the options its copies hold. */
  contentGroups: Map<Spec.Element, { groups: number; disabled: boolean }>
  /** Options and <selectedcontent> elements a copy took out of the tree. */
  removed: Set<Spec.Element>
  /** A multiple select copies none, nor does one in another select, an <option> or a <selectedcontent>; a list box (size above 1) selects none by default. */
  noCopies: boolean
  listBox: boolean
}

function hasAttribute(element: Spec.Element, name: string): boolean {
  return element.attrs.some((attr) => attr.name === name)
}

function selectState(select: Spec.Element, nested: boolean): SelectState {
  const size = /^[\t\n\f\r ]*\+?(\d+)/.exec(select.attrs.find((attr) => attr.name === 'size')?.value ?? '')
  return { selected: null, options: [], firstCandidate: 0, members: new Set(), contents: [], contentGroups: new Map(), removed: new Set(), noCopies: nested || hasAttribute(select, 'multiple'), listBox: size !== null && Number(size[1]) > 1 }
}

function hiddenInput(token: Token.TagToken): boolean {
  return token.attrs.find((attr) => attr.name === 'type')?.value.toLowerCase() === 'hidden'
}

class StandardTokenizer extends Tokenizer {
  protected override _leaveAttrName(): void {
    const token = this.currentToken
    if (token !== null && 'attrs' in token && token.attrs.length >= MAX_ATTRIBUTES) throw TOO_MANY
    super._leaveAttrName()
  }
}

/**
 * parse5 with twelve changes:
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
 * - An end tag in svg or math is matched to an open element by its exact
 *   name, as in Chromium: in svg it first takes svg's spelling (</foreignObject>,
 *   </clipPath>), in math it keeps its own. One that meets an HTML element
 *   first is then read by the HTML rules, where a name svg respelled matches
 *   nothing. The standard compares names lowercased, so </foreignObject>
 *   closed an HTML <foreignobject> or math's, and the content after it left
 *   the svg or math it stays in in Chromium.
 * - "Any other end tag" closes HTML elements only (endTagAsAnyOther), and
 *   resetting the insertion mode reads HTML elements only (_resetInsertionMode),
 *   as the standard and Chromium say; parse5 also took an svg or math element
 *   of the tag's name, such as a <desc>, <mi> or <tfoot>.
 * - <select> is read by the standard's rules since 2025, as Chromium reads it:
 *   no "in select" modes (the insertionMode property below), <select> as a
 *   bound of every scope (scoped), the rules for <select>, <option>,
 *   <optgroup>, <hr> and <input> while one is open (inSelect), and </select>
 *   as one of the body's block end tags. So a select holds <div>, <b>, <p>,
 *   tables and svg as a browser shows them, where parse5 dropped their tags.
 * - In a template, a <title>, <base>, <basefont>, <bgsound> or <noframes>
 *   switches the template to the body's rules, as any start tag but <link>,
 *   <meta>, <script>, <style> and <template> does in Chromium, so rows, cells
 *   and columns after it are dropped and their text kept. The standard reads
 *   them by the head's rules, which leave the template's mode as it was.
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
  /** Open HTML <select> elements, so a page without one never walks the stack to look for one. */
  private openSelects = 0
  /** Each <select>'s selectedness and <selectedcontent> elements, and the <select> each option is one of. */
  private selects = new Map<Spec.Element, SelectState>()
  private optionSelects = new Map<Spec.Element, SelectState>()
  private drained = false

  constructor(...args: ConstructorParameters<typeof Parser<DefaultTreeAdapterMap>>) {
    super(...args)
    this.tokenizer = new StandardTokenizer(this.options, this)
    const stack = this.openElements
    stack.hasInTableScope = (tagID) => tableScoped(stack, (id) => id === tagID)
    stack.hasTableBodyContextInTableScope = () => tableScoped(stack, (id) => GROUP_ENDS.has(id))
    stack.hasInScope = (tagID) => scoped(stack, tagID)
    stack.hasInListItemScope = (tagID) => scoped(stack, tagID, LIST_ITEM_BOUNDS)
    stack.hasInButtonScope = (tagID) => scoped(stack, tagID, BUTTON_BOUNDS)
    stack.hasNumberedHeaderInScope = () => scoped(stack, HEADINGS)
  }

  override _startTagOutsideForeignContent(token: Token.TagToken): void {
    if ((this.insertionMode as number) === IN_TEMPLATE && BODY_IN_TEMPLATE.has(token.tagID)) {
      const body = IN_BODY as typeof this.insertionMode
      this.tmplInsertionModeStack[0] = body
      this.insertionMode = body
    }
    if (SELECT_STARTS.has(token.tagID) && this.openSelects > 0 && BODY_RULE_MODES.has(this.insertionMode as number) && this.openElements.hasInScope(T.SELECT) && this.inSelect(token)) return
    // In table text or a column group parse5 first leaves the mode and sends the tag here again.
    if (token.tagID === htmlSpec.TAG_ID.FORM && TABLE_MODES.has(this.insertionMode as number) && this.openElements.tmplCount > 0) {
      this._insertElement(token, htmlSpec.NS.HTML)
      this.openElements.pop()
      return
    }
    super._startTagOutsideForeignContent(token)
  }

  /**
   * The standard's rules (2025) for a <select>, <option>, <optgroup>, <hr> or
   * <input> while a <select> is open in scope; false leaves the tag to parse5
   * (an <input> after its <select> is closed). In the table's modes it is
   * read as the body reads it, with foster parenting, as their "anything else".
   */
  private inSelect(token: Token.TagToken): boolean {
    const stack = this.openElements
    const mode = this.insertionMode as number
    switch (token.tagID) {
      case T.SELECT:
        stack.popUntilTagNamePopped(T.SELECT)
        return true
      case T.INPUT:
        // The table's own rule for a hidden <input> does not look at the <select>.
        if (!FOSTER_MODES.has(mode) || !hiddenInput(token)) stack.popUntilTagNamePopped(T.SELECT)
        return false
      case T.OPTION:
        stack.generateImpliedEndTagsWithExclusion(T.OPTGROUP)
        break
      case T.OPTGROUP:
        stack.generateImpliedEndTags()
        break
      default:
        if (stack.hasInButtonScope(T.P)) this._closePElement()
        stack.generateImpliedEndTags()
    }
    const fostering = this.fosterParentingEnabled
    if (FOSTER_MODES.has(mode)) this.fosterParentingEnabled = true
    if (token.tagID === T.HR) {
      this._appendElement(token, htmlSpec.NS.HTML)
      this.framesetOk = false
      token.ackSelfClosing = true
    } else {
      this._reconstructActiveFormattingElements()
      this._insertElement(token, htmlSpec.NS.HTML)
    }
    this.fosterParentingEnabled = fostering
    return true
  }

  override onEndTag(token: Token.TagToken): void {
    // </p> and </br> leave svg and math first, in Chromium as in parse5.
    if (!this.currentNotInHTML || token.tagID === htmlSpec.TAG_ID.P || token.tagID === htmlSpec.TAG_ID.BR) {
      super.onEndTag(token)
      return
    }
    this.skipNextNewLine = false
    this.currentToken = token
    const stack = this.openElements
    const svg = defaultTreeAdapter.getNamespaceURI(stack.current as Spec.Element) === SVG_NS
    const name = (svg ? foreignContent.SVG_TAG_NAMES_ADJUSTMENT_MAP.get(token.tagName) : undefined) ?? token.tagName
    for (let i = stack.stackTop; i > 0; i--) {
      const element = stack.items[i] as Spec.Element
      if (defaultTreeAdapter.getNamespaceURI(element) === HTML_NS) {
        if (name === token.tagName) this._endTagOutsideForeignContent(token)
        // A respelled name matches no HTML element; after the body it still returns to the body's rules.
        else if ((this.insertionMode as number) === MODE.AFTER_BODY || (this.insertionMode as number) === MODE.AFTER_AFTER_BODY) {
          this.insertionMode = IN_BODY as typeof this.insertionMode
        }
        return
      }
      // Read through the budgeted adapter, as parse5 does: each end tag may walk every open svg or math element.
      if (this.treeAdapter.getTagName(element) === name) {
        stack.shortenToLength(i)
        return
      }
    }
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
    // The parser pops every element left open when it stops (parse5 leaves them): an option still open closes then.
    if (this.stopped && !this.drained) {
      this.drained = true
      const stack = this.openElements
      for (let i = stack.stackTop; i >= 0; i--) {
        const element = stack.items[i] as Spec.Element
        if (element.tagName === 'option' && defaultTreeAdapter.getNamespaceURI(element) === HTML_NS) this.optionClosed(element)
      }
    }
  }

  override _endTagOutsideForeignContent(token: Token.TagToken): void {
    if ((this.insertionMode as number) === IN_ROW && GROUP_ENDS.has(token.tagID) && !this.openElements.hasInTableScope(token.tagID)) return
    const mode = this.insertionMode as number
    if (token.tagID === T.FORM && BODY_RULE_MODES.has(mode) && this.openElements.tmplCount > 0) {
      this.endTagAsAnyOther(token)
      return
    }
    // After the body, an end tag but </html> is read by the body's rules.
    if ((mode === MODE.AFTER_BODY && token.tagID !== T.HTML) || mode === MODE.AFTER_AFTER_BODY) {
      this.insertionMode = IN_BODY as typeof this.insertionMode
      this._endTagOutsideForeignContent(token)
      return
    }
    // </select> is one of the body's block end tags since 2025.
    if (token.tagID === T.SELECT && BODY_RULE_MODES.has(mode)) {
      if (this.openSelects > 0 && this.openElements.hasInScope(T.SELECT)) {
        this.openElements.generateImpliedEndTags()
        this.openElements.popUntilTagNamePopped(T.SELECT)
      }
      return
    }
    if (BODY_RULE_MODES.has(mode) && (!OWN_END_RULES.has(token.tagID)
      || (FORMATTING_ENDS.has(token.tagID) && this.activeFormattingElements.getElementEntryInScopeWithTagName(token.tagName) === null))) {
      this.endTagAsAnyOther(token)
      return
    }
    super._endTagOutsideForeignContent(token)
  }

  /**
   * The standard's "any other end tag" in the body: the nearest open HTML
   * element of the tag closes, unless a special element is open above it.
   * parse5 also closed an svg or math element of that name (a </desc> or </mi>
   * written in HTML inside it), which Chromium and the standard do not.
   */
  private endTagAsAnyOther(token: Token.TagToken): void {
    const stack = this.openElements
    for (let i = stack.stackTop; i > 0; i--) {
      const element = stack.items[i] as Spec.Element
      const id = stack.tagIDs[i]!
      if (id === token.tagID && defaultTreeAdapter.getNamespaceURI(element) === HTML_NS
        && (id !== T.UNKNOWN || this.treeAdapter.getTagName(element) === token.tagName)) {
        stack.generateImpliedEndTagsWithExclusion(id)
        if (stack.stackTop >= i) stack.shortenToLength(i)
        return
      }
      if (this._isSpecialElement(element, id)) return
    }
  }

  /**
   * The standard's "reset the insertion mode appropriately", which reads HTML
   * elements only. parse5 also read svg and math elements of those names, so
   * an svg <tfoot> made the parser read what followed as a row group's.
   */
  override _resetInsertionMode(): void {
    const stack = this.openElements
    for (let i = stack.stackTop; i >= 0; i--) {
      const context = i === 0 && this.fragmentContext !== null
      if (!context && defaultTreeAdapter.getNamespaceURI(stack.items[i] as Spec.Element) !== HTML_NS) continue
      const mode = this.resetMode(context ? this.fragmentContextID : stack.tagIDs[i]!, i)
      if (mode !== undefined) {
        this.insertionMode = mode as typeof this.insertionMode
        return
      }
    }
    this.insertionMode = IN_BODY as typeof this.insertionMode
  }

  private resetMode(id: htmlSpec.TAG_ID, i: number): number | undefined {
    switch (id) {
      case T.TR: return IN_ROW
      case T.TBODY: case T.THEAD: case T.TFOOT: return MODE.IN_TABLE_BODY
      case T.CAPTION: return MODE.IN_CAPTION
      case T.COLGROUP: return MODE.IN_COLUMN_GROUP
      case T.TABLE: return MODE.IN_TABLE
      case T.BODY: return IN_BODY
      case T.FRAMESET: return MODE.IN_FRAMESET
      case T.TEMPLATE: return this.tmplInsertionModeStack[0]
      case T.HTML: return this.headElement ? MODE.AFTER_HEAD : MODE.BEFORE_HEAD
      case T.TD: case T.TH: return i > 0 ? MODE.IN_CELL : undefined
      case T.HEAD: return i > 0 ? MODE.IN_HEAD : undefined
      default: return undefined
    }
  }


  // parse5's stack reports the element it pushed only when it is the new top: its insertAfter (the adoption agency's, for a formatting element) reports the top.
  override onItemPush(node: Spec.ParentNode, tid: number, isTop: boolean): void {
    const element = node as Spec.Element
    if (isTop && defaultTreeAdapter.getNamespaceURI(element) === HTML_NS) {
      if (tid === T.SELECT) {
        this.openSelects++
        this.selects.set(element, selectState(element, this.inOptionOrSelectedContent(element)))
      } else if (this.openSelects > 0 && (tid === T.OPTION || (tid === T.UNKNOWN && element.tagName === 'selectedcontent'))) {
        this.selectItem(element, tid === T.OPTION)
      }
    }
    super.onItemPush(node, tid, isTop)
  }

  override onItemPop(node: Spec.ParentNode, isTop: boolean): void {
    const element = node as Spec.Element
    if (defaultTreeAdapter.getNamespaceURI(element) === HTML_NS) {
      if (element.tagName === 'select') this.openSelects--
      else if (element.tagName === 'option') this.optionClosed(element)
    }
    super.onItemPop(node, isTop)
  }

  /**
   * Counts one step of <selectedcontent> work against the parse's budget: a
   * select's <selectedcontent> elements are visited on every change of its
   * selected option, and options are walked for what they hold, which copies
   * of empty options (no nodes made) would not otherwise count.
   */
  private readonly visit = (): void => {
    (this.treeAdapter as { visit?: () => void }).visit?.()
  }

  private copyDepth = 0

  /** Whether `node` is still in `ancestor`, each step up counted as a visit. */
  private contains(ancestor: Spec.ParentNode, node: Spec.ChildNode): boolean {
    for (let parent: Spec.ParentNode | null = node.parentNode; parent !== null; parent = 'parentNode' in parent ? parent.parentNode ?? null : null) {
      this.visit()
      if (parent === ancestor) return true
    }
    return false
  }

  /** Whether what is parsed now is in the document: not in a fragment (read as a template's content) nor in a template's content. */
  private connected(): boolean {
    return this.fragmentContext === null && this.openElements.tmplCount === 0
  }

  /** An option closes: if it is still its select's selected option, it is copied into the select's <selectedcontent> elements. */
  private optionClosed(option: Spec.Element): void {
    const state = this.optionSelects.get(option)
    this.optionSelects.delete(option)
    if (state !== undefined && state.selected === option && !state.removed.has(option)) this.fill(state, option)
  }

  /**
   * An <option> or <selectedcontent> just inserted: the <select> it is in,
   * its nearest ancestor select, unless a <template> or <option> (for an
   * option, a <datalist> or a second <optgroup>; for a <selectedcontent>,
   * another one) comes first, or it is not in the tree (put in a part a copy
   * took out). Read up its ancestors rather than the stack of open elements:
   * an element fostered out of a table, or moved by the adoption agency, is
   * not where the stack would put it.
   */
  private selectItem(element: Spec.Element, option: boolean): void {
    let disabled = option && hasAttribute(element, 'disabled')
    let groups = 0
    for (let parent = element.parentNode; parent !== null; parent = (parent as Spec.Element).parentNode) {
      this.visit()
      if (!defaultTreeAdapter.isElementNode(parent)) return
      if (parent.namespaceURI !== HTML_NS) continue
      const name = parent.tagName
      if (name === 'select') {
        const state = this.selects.get(parent)
        if (state === undefined) return
        if (option) this.optionInserted(state, element, disabled)
        else this.contentInserted(state, element, groups, disabled)
        return
      }
      if (name === 'template' || name === 'option' || name === (option ? 'datalist' : 'selectedcontent')) return
      if (name === 'optgroup') {
        // An option in an optgroup in another one is not the select's, as in Chromium.
        if (++groups > 1 && option) return
        if (hasAttribute(parent, 'disabled')) disabled = true
      }
    }
  }

  /**
   * An option inserted in a select: one with a selected attribute is
   * selected, and so is the first enabled one while none is (not in a list
   * box). In the document, Chromium copies an option into the select's
   * <selectedcontent> elements as soon as it is selected, before its content
   * is parsed; when it closes it copies it again.
   */
  private optionInserted(state: SelectState, option: Spec.Element, disabled: boolean): void {
    this.optionSelects.set(option, state)
    state.options.push({ option, disabled })
    state.members.add(option)
    if (!hasAttribute(option, 'selected')) {
      // Selected by default only as the first enabled option still in the select. A taken-out copy being
      // copied (selected, but not the select's) does not count as a selection, as in Chromium.
      const current = state.selected !== null && state.members.has(state.selected) && !state.removed.has(state.selected) ? state.selected : null
      if (current !== null || state.listBox || disabled) return
      this.advanceCandidate(state)
      if (state.options[state.firstCandidate]?.option !== option) return
    }
    state.selected = option
    if (this.connected()) this.fill(state, option)
  }

  /** A <selectedcontent> inserted in a select: in the document it takes a copy of the option selected so far. */
  private contentInserted(state: SelectState, content: Spec.Element, groups: number, disabled: boolean): void {
    state.contents.push(content)
    state.contentGroups.set(content, { groups, disabled })
    const selected = state.selected
    this.visit()
    if (selected !== null && !state.noCopies && this.connected()) this.copyInto(state, selected, content)
  }

  /**
   * Copies `option` into each of the select's <selectedcontent> elements,
   * replacing what they held. What that takes out of the tree is no longer
   * the select's: if it held the selected option, the first enabled option
   * left is selected (none in a list box), without copying it, as in
   * Chromium.
   */
  private fill(state: SelectState, option: Spec.Element): void {
    if (state.contents.length === 0 || state.noCopies) return
    // A copied option selected in turn fills again, one level deeper; no real page nests a hundred selected options.
    if (++this.copyDepth > MAX_COPY_DEPTH) throw TOO_MANY
    try {
      for (const content of state.contents) {
        this.visit()
        if (!state.removed.has(content)) this.copyInto(state, option, content)
      }
    } finally {
      this.copyDepth--
    }
  }

  /**
   * Replaces a <selectedcontent>'s children with a copy of `option`'s. The
   * options the copy holds are then the select's, in tree order, by the
   * rules a parsed one follows (not in another select, a <datalist>, an
   * option or a second <optgroup>): one with a selected attribute is
   * selected, and in the document copied in turn, which takes it out again.
   * One an earlier one's copy already took out is still handled once, as
   * Chromium handles each node of an insertion: with a selected attribute it
   * is selected and copied, then it is out (not the select's, never selected
   * by default). Each such copy is of an option nested deeper, so this ends
   * (past MAX_COPY_DEPTH, in linkedom).
   */
  private copyInto(state: SelectState, option: Spec.Element, content: Spec.Element): void {
    const taken = content.childNodes
    this.copyChildren(option, content)
    this.takenOut(state, taken)
    const around = state.contentGroups.get(content)!
    const copies: { option: Spec.Element; disabled: boolean }[] = []
    const work: { node: Spec.ChildNode; groups: number; disabled: boolean }[] = []
    for (let i = content.childNodes.length - 1; i >= 0; i--) work.push({ node: content.childNodes[i]!, groups: around.groups, disabled: around.disabled })
    for (let next = work.pop(); next !== undefined; next = work.pop()) {
      const { node, groups, disabled } = next
      if (!defaultTreeAdapter.isElementNode(node)) continue
      this.visit()
      if (node.namespaceURI === HTML_NS) {
        if (node.tagName === 'select' || node.tagName === 'datalist' || node.tagName === 'template') continue
        if (node.tagName === 'option') {
          if (groups < 2) copies.push({ option: node, disabled: disabled || hasAttribute(node, 'disabled') })
          continue
        }
      }
      const group = node.namespaceURI === HTML_NS && node.tagName === 'optgroup'
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        work.push({ node: node.childNodes[i]!, groups: groups + (group ? 1 : 0), disabled: disabled || (group && hasAttribute(node, 'disabled')) })
      }
    }
    for (const copy of copies) {
      if (!state.removed.has(content) && this.contains(content, copy.option)) {
        this.optionInserted(state, copy.option, copy.disabled)
        continue
      }
      // Taken out again by an earlier one's copy: Chromium still selects one with a selected attribute and copies it, once, but it is not the select's.
      if (!hasAttribute(copy.option, 'selected')) continue
      state.selected = copy.option
      if (this.connected()) this.fill(state, copy.option)
      state.removed.add(copy.option)
      if (state.selected === copy.option) this.reselect(state)
    }
  }

  private takenOut(state: SelectState, nodes: Spec.ChildNode[]): void {
    const work = [...nodes]
    let lostSelected = false
    for (let node = work.pop(); node !== undefined; node = work.pop()) {
      if (!defaultTreeAdapter.isElementNode(node)) continue
      if (node.namespaceURI === HTML_NS && (state.members.has(node) || state.contentGroups.has(node))) {
        state.removed.add(node)
        if (node === state.selected) lostSelected = true
      }
      for (const child of node.childNodes) work.push(child)
    }
    if (lostSelected) this.reselect(state)
  }

  /** The selected option was taken out: the first enabled option left is selected (none in a list box), without a copy. */
  private reselect(state: SelectState): void {
    this.advanceCandidate(state)
    state.selected = state.listBox ? null : state.options[state.firstCandidate]?.option ?? null
  }

  /** Moves `firstCandidate` past options that are disabled or taken out, which lasts. */
  private advanceCandidate(state: SelectState): void {
    while (state.firstCandidate < state.options.length && (state.options[state.firstCandidate]!.disabled || state.removed.has(state.options[state.firstCandidate]!.option))) state.firstCandidate++
  }

  /** Whether a <select>, <option> or <selectedcontent> is an ancestor of `element` (up to a <template>, whose content is apart). */
  private inOptionOrSelectedContent(element: Spec.Element): boolean {
    for (let parent = element.parentNode; parent !== null; parent = (parent as Spec.Element).parentNode) {
      this.visit()
      if (!defaultTreeAdapter.isElementNode(parent)) return false
      if (parent.namespaceURI !== HTML_NS) continue
      if (parent.tagName === 'template') return false
      if (parent.tagName === 'select' || parent.tagName === 'option' || parent.tagName === 'selectedcontent') return true
    }
    return false
  }

  /** Replaces `target`'s children with copies of `source`'s, through the budgeted adapter. */
  private copyChildren(source: Spec.ParentNode, target: Spec.ParentNode): void {
    for (const child of target.childNodes) child.parentNode = null
    target.childNodes = []
    const work: [Spec.ParentNode, Spec.ParentNode][] = [[source, target]]
    for (let next = work.pop(); next !== undefined; next = work.pop()) {
      const [from, into] = next
      for (const child of from.childNodes) {
        if (defaultTreeAdapter.isTextNode(child)) defaultTreeAdapter.appendChild(into, this.treeAdapter.createTextNode(child.value))
        else if (defaultTreeAdapter.isCommentNode(child)) defaultTreeAdapter.appendChild(into, this.treeAdapter.createCommentNode(child.data))
        else if (defaultTreeAdapter.isElementNode(child)) {
          const copy = this.treeAdapter.createElement(child.tagName, child.namespaceURI, child.attrs.map((attr) => ({ ...attr })))
          defaultTreeAdapter.appendChild(into, copy)
          if (child.tagName === 'template' && child.namespaceURI === HTML_NS) {
            const content = defaultTreeAdapter.createDocumentFragment()
            defaultTreeAdapter.setTemplateContent(copy as Spec.Template, content)
            work.push([defaultTreeAdapter.getTemplateContent(child as Spec.Template), content])
          } else work.push([child, copy])
        }
      }
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

// The standard has had no "in select" modes since 2025 (Chromium 134 reads
// <select> so): a <select> leaves the insertion mode as it was, and what it
// holds is read by the body's rules. parse5 still switches to them, so those
// switches are dropped here.
Object.defineProperty(StandardParser.prototype, 'insertionMode', {
  get(this: { selectlessMode: number }) {
    return this.selectlessMode
  },
  set(this: { selectlessMode: number }, mode: number) {
    if (mode !== MODE.IN_SELECT && mode !== MODE.IN_SELECT_IN_TABLE) this.selectlessMode = mode
  },
})

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
  const treeAdapter = {
    ...defaultTreeAdapter,
    // Work the parser does for <selectedcontent> without making or reading nodes.
    visit() {
      if (--reads < 0) throw TOO_MANY
    },
    createElement(tagName, namespaceURI, attrs) {
      attributes -= attrs.length
      if (--elements < 0 || attributes < 0) throw TOO_MANY
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs)
    },
    // Comments, and the text and comments <selectedcontent> copies make, count as elements: a copy of an option of N nodes into M of them makes N x M.
    createCommentNode(data) {
      if (--elements < 0) throw TOO_MANY
      return defaultTreeAdapter.createCommentNode(data)
    },
    createTextNode(value) {
      if (--elements < 0) throw TOO_MANY
      return defaultTreeAdapter.createTextNode(value)
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
  } satisfies ParserOptions<DefaultTreeAdapterMap>['treeAdapter'] & { visit(): void }
  return { treeAdapter }
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
