import { createHash } from 'node:crypto'
import type { BackendRecipe, NetworkPolicy, RecipeRun, RecipeStep, SessionGrant } from '@w2l/contracts'
import { RecipeStore } from '@w2l/runtime'
import { BrowserControl, type ControlledPage } from './routing/browserControl.js'
import { SessionBroker } from './routing/sessionBroker.js'
import { RobotsOriginCache } from './robotsLookup.js'
import { assertSafeUrl } from './egress.js'

export class RecipeExecutor {
  private readonly browser: BrowserControl
  constructor(private readonly store: RecipeStore, private readonly broker: SessionBroker, root: string, private readonly policy: NetworkPolicy) {
    this.browser = new BrowserControl(root, broker, policy)
  }
  async run(input: { recipeId: string; revision: number; workspaceId: string; accountRef: string; sessionRef: string; triggerKey: string }, resumeId?: string): Promise<RecipeRun> {
    const recipe = this.store.recipe(input.recipeId, input.revision)
    const access = await this.broker.grant({ ...input, origin: recipe.origin })
    if (access.kind !== 'granted') throw new Error(`session_${access.kind}`)
    const grant = access.grant
    const release = await this.browser.acquire(grant)
    let page: ControlledPage | undefined
    let run: RecipeRun | undefined
    let effectStarted = false
    try {
      if (resumeId) {
        const previous = this.store.get(resumeId)
        if (previous.workspaceId !== input.workspaceId || previous.accountRef !== input.accountRef || previous.sessionRef !== input.sessionRef || previous.recipeId !== recipe.id || previous.revision !== recipe.revision) throw new Error('resume scope mismatch')
        run = this.store.resume(resumeId,grant.grantEpoch)
      } else {
        const claim = this.store.begin({ ...input, grantEpoch: grant.grantEpoch })
        if (!claim.fresh) return claim.run
        run = claim.run
      }
      const deadline = Date.now() + recipe.limits.timeoutMs
      page = await this.browser.open(grant,deadline)
      const output: Record<string,string> = {}
      const robots = new RobotsOriginCache(this.policy)
      let verified = false
      for (const step of recipe.steps) {
        await page.check()
        page.page.setDefaultTimeout(Math.max(1,deadline-Date.now()))
        if (step.op !== 'navigate') {
          await this.account(page, recipe, input.accountRef)
          verified = true
        }
        this.store.step(run,step.id,step.op,'started')
        if (step.op === 'navigate') {
          await assertSafeUrl(step.url,this.policy)
          const ua = await page.page.evaluate(() => navigator.userAgent)
          const rules = await robots.lookup(step.url,ua)
          if (robots.decision(rules,step.url,ua).decision === 'disallowed') throw new Error('robots_disallowed')
          const response = await page.page.goto(step.url,{ waitUntil: 'domcontentloaded', timeout: Math.max(1,deadline-Date.now()) })
          if (response?.status() === 401 || response?.status() === 403) throw new Error('authentication_required')
          if (!response?.ok()) throw new Error('navigation_failed')
          verified = false
        } else if (step.op !== 'assertAccount') {
          if (!verified) throw new Error('account_not_verified')
          const locator = page.page.locator(step.target.css)
          if (await locator.count() !== 1) throw new Error('ambiguous_target')
          if (step.op === 'fill') await locator.fill(step.value)
          if (step.op === 'query') {
            page.allowQuery(step.request)
            effectStarted = true
            await locator.click()
            const post = page.page.locator(step.postcondition.target.css)
            await post.waitFor({ state: 'visible' })
            if (await post.count() !== 1 || (await post.innerText()).trim() !== step.postcondition.text) throw new Error('postcondition_failed')
            page.allowQuery(null)
          }
          if (step.op === 'extract') {
            const value = (await locator.innerText()).trim()
            if (!value) throw new Error('empty_field')
            output[step.field] = value
          }
          if (step.op === 'download') {
            // Restrict download to a reviewed same-origin link; bounded fetch avoids unbounded disk writes.
            const href = await locator.getAttribute('href')
            if (!href) throw new Error('download_requires_link')
            const url = new URL(href,page.page.url())
            if (url.origin !== grant.originScope) throw new Error('download_scope_violation')
            effectStarted = true
            const bytes = await page.page.evaluate(async ({ url, max }) => {
              const response = await fetch(url,{ credentials: 'same-origin', redirect: 'error' })
              if (!response.ok || !response.body) throw new Error('download failed')
              const reader = response.body.getReader(); const chunks: number[] = []
              try {
                for (;;) { const { done,value } = await reader.read(); if (done) break; if (chunks.length + value.length > max) throw new Error('download too large'); for (const b of value) chunks.push(b) }
              } finally { await reader.cancel() }
              return chunks
            },{ url: url.href, max: recipe.limits.maxDownloadBytes })
            output[step.field] = JSON.stringify({ bytes: bytes.length, sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'), base64: Buffer.from(bytes).toString('base64') })
          }
        }
        await page.check()
        if (step.op !== 'navigate') await this.account(page,recipe,input.accountRef)
        if (Buffer.byteLength(JSON.stringify(output)) > recipe.limits.maxOutputBytes) throw new Error('output_budget_exceeded')
        this.store.step(run,step.id,step.op,'completed')
        effectStarted = false
      }
      await page.check()
      return this.store.finish(run,'completed',null,output)
    } catch (error) {
      if (!run) throw error
      const message = error instanceof Error ? error.message : ''
      const authentication = ['authentication_required','account_mismatch'].includes(message)
      // Raw Playwright errors can contain selector text, input values and debug endpoints.
      const reason = authentication ? message : effectStarted ? 'effect_unknown' : 'execution_stopped'
      if (authentication && await this.broker.validateGrant(grant)) await this.broker.requestHandoff(grant.sessionRef,`recipe:${run.id}:${reason}`)
      return this.store.finish(run,effectStarted ? 'effect_unknown' : authentication ? 'waiting_user' : 'failed',reason)
    } finally {
      try { await page?.close() } finally { await release() }
    }
  }
  private async account(control: ControlledPage, recipe: BackendRecipe, account: string): Promise<void> {
    if (await control.page.locator(recipe.login.css).count()) throw new Error('authentication_required')
    const marker = control.page.locator(recipe.account.css)
    if (await marker.count() !== 1 || (await marker.innerText()).trim() !== account) throw new Error('account_mismatch')
  }
}
