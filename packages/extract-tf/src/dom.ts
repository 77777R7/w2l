/**
 * Thin DOM adapter over linkedom. The bake-off (research/dom_bakeoff.md)
 * settled on linkedom as the parse layer; this module keeps every linkedom
 * touchpoint in one file so the implementation can be swapped for jsdom as a
 * regression oracle without touching the cascade.
 */

import { parseHTML } from 'linkedom'

export interface DomDoc {
  document: Document
  /** Release resources when available (no-op for linkedom). */
  close(): void
}

export function parse(html: string): DomDoc {
  let { document } = parseHTML(html)
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

/** Serialize an element back to HTML. */
export function outerHtml(el: Element): string {
  return el.outerHTML
}

/** Detach a node from the tree (deletion, not hiding). */
export function detach(node: Node): void {
  node.parentNode?.removeChild(node)
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
