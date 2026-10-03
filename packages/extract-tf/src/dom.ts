/**
 * Thin DOM adapter over linkedom. The bake-off (research/dom_bakeoff.md)
 * settled on linkedom as the parse layer; this module keeps every linkedom
 * touchpoint in one file so the implementation can be swapped for jsdom as a
 * regression oracle without touching the cascade.
 */

import { parseHTML } from 'linkedom'
import { normalizeTableTags } from './tableTags.js'

export interface DomDoc {
  document: Document
  /** Release resources when available (no-op for linkedom). */
  close(): void
}

/**
 * `whole`: the HTML is a page, read as a browser reads one (see
 * normalizeTableTags); by default when it has an `<html>` tag or a doctype.
 */
export function parse(html: string, whole?: boolean): DomDoc {
  // htmlparser2 builds tables otherwise than a browser where an end tag is stray (see tableTags.ts).
  let { document } = parseHTML(normalizeTableTags(html, whole))
  // linkedom parses '' (and whitespace-only input) to a document whose
  // documentElement is null; its head/body getters then THROW on access.
  // Real crawls hit empty 200 bodies constantly (the empty-body fixture),
  // so normalize to a minimal empty document instead.
  if ((document as unknown as { documentElement: unknown }).documentElement == null) {
    ;({ document } = parseHTML('<html><head></head><body></body></html>'))
  }
  return {
    document: document as unknown as Document,
    close: () => {},
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
