export interface SettlePage {
  evaluate(expression: string): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
}

export interface SettleOptions {
  maxMs?: number
  minMs?: number
  sampleMs?: number
}

/**
 * Wait for a minimum observation window, then require two equal snapshots of
 * both rendered text and DOM size. A stable loading shell must not finish the
 * wait before the minimum window, while long-polling pages remain bounded.
 */
export async function waitForRenderedStability(
  page: SettlePage,
  options: SettleOptions = {},
): Promise<void> {
  const maxMs = options.maxMs ?? 1_500
  const minMs = Math.min(options.minMs ?? 500, maxMs)
  const sampleMs = options.sampleMs ?? 100
  const deadline = Date.now() + maxMs
  let previous = ''
  let stableRounds = 0

  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(`(() => {
      const root = document.documentElement
      const body = document.body
      return JSON.stringify({
        size: root?.outerHTML.length ?? 0,
        text: body?.innerText ?? '',
      })
    })()`)
    const current = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)
    if (current === previous) stableRounds++
    else stableRounds = 0
    previous = current

    const elapsed = maxMs - Math.max(0, deadline - Date.now())
    if (elapsed >= minMs && stableRounds >= 2) return
    await page.waitForTimeout(Math.min(sampleMs, Math.max(1, deadline - Date.now())))
  }
}
