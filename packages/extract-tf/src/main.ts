/**
 * Main-content selection: score ancestor containers by the text blocks they
 * contain, prefer semantic containers (article/main), and fall back to the
 * longest run of consecutive blocks when no container dominates.
 */

import { qsa, tagOf } from './dom.js'
import type { TextBlock } from './classify.js'

interface Candidate {
  el: Element
  score: number
  blockCount: number
}

/** Small bonus per heading, so container quality beats raw size on tie. */
const HEADING_BONUS = 60
const SEMANTIC_BONUS = 200

function headingCount(container: Element): number {
  return qsa(container, 'h1,h2,h3,h4,h5,h6').length
}

/**
 * Pick the container (or container-like run) that represents main content.
 * Returns the element whose HTML should be emitted.
 */
export function selectMain(doc: Document, blocks: TextBlock[]): Element | null {
  if (blocks.length === 0) return null

  // Explicit semantic container: if article/main holds a reasonable share of
  // the blocks, trust it outright.
  for (const sel of ['article', 'main']) {
    const el = doc.querySelector(sel)
    if (!el) continue
    const inside = blocks.filter((b) => el.contains(b.el))
    if (inside.length >= blocks.length * 0.5) return el
  }

  // Score every container that holds at least one block.
  const candidates = new Map<Element, Candidate>()
  for (const block of blocks) {
    let el: Element | null = block.el.parentElement
    while (el && el !== doc.body && el !== doc.documentElement) {
      const cand = candidates.get(el) ?? { el, score: 0, blockCount: 0 }
      cand.blockCount++
      cand.score += block.length
      candidates.set(el, cand)
      el = el.parentElement
    }
  }

  // Fold in bonuses.
  const list = Array.from(candidates.values())
  for (const c of list) {
    const tag = tagOf(c.el)
    if (tag === 'article' || tag === 'main') c.score += SEMANTIC_BONUS
    c.score += headingCount(c.el) * HEADING_BONUS
  }

  list.sort((a, b) => b.score - a.score)
  const best = list[0]
  if (!best) return null

  // A container wins when it holds most blocks or dominates the runner-up.
  const second = list[1]?.score ?? 0
  if (best.blockCount >= blocks.length * 0.5 || second === 0 || best.score >= second * 1.4) {
    return best.el
  }

  // No dominant container: longest run of consecutive blocks (document order).
  return longestRun(blocks)
}

/**
 * Longest run of blocks sharing a common parent, or single longest block.
 */
function longestRun(blocks: TextBlock[]): Element | null {
  // Blocks arrive in document order (querySelectorAll order).
  let bestRun: TextBlock[] = []
  let run: TextBlock[] = []
  let prevParent: Element | null = null
  for (const b of blocks) {
    if (prevParent === b.el.parentElement) {
      run.push(b)
    } else {
      run = [b]
      prevParent = b.el.parentElement
    }
    if (run.length > bestRun.length) bestRun = run
  }
  if (bestRun.length === 0) return null
  // Emit the common ancestor of the run.
  const parent = bestRun[0]!.el.parentElement
  return parent ?? bestRun[0]!.el
}
