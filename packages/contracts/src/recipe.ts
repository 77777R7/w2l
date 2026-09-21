/** Operator-reviewed, data-only recipes. No script/evaluate/write operation. */
export interface RecipeLocator { css: string }
export interface RecipeCondition { target: RecipeLocator; text: string }
export type RecipeStep =
  | { id: string; op: 'navigate'; url: string }
  | { id: string; op: 'assertAccount' }
  | { id: string; op: 'fill'; target: RecipeLocator; value: string }
  | { id: string; op: 'query'; target: RecipeLocator; postcondition: RecipeCondition; request: { method: 'GET' | 'POST'; path: string } }
  | { id: string; op: 'extract'; field: string; target: RecipeLocator }
  | { id: string; op: 'download'; target: RecipeLocator; field: string }
export interface BackendRecipe {
  id: string
  revision: number
  origin: string
  account: RecipeLocator
  login: RecipeLocator
  steps: RecipeStep[]
  limits: { timeoutMs: number; maxSteps: number; maxOutputBytes: number; maxDownloadBytes: number }
}
export type RecipeState = 'running' | 'completed' | 'failed' | 'waiting_user' | 'effect_unknown' | 'cancelled'
export interface RecipeRun {
  id: string
  recipeId: string
  revision: number
  recipeHash: string
  sessionRef: string
  workspaceId: string
  accountRef: string
  triggerKey: string
  grantEpoch: number
  state: RecipeState
  attempt: number
  createdAt: number
  updatedAt: number
  reason: string | null
  output: Record<string, string>
}

export function validateRecipe(value: unknown): BackendRecipe {
  const r = value as BackendRecipe
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096
  const locator = (v: unknown) => v && text((v as RecipeLocator).css) && Object.keys(v).every((k) => k === 'css')
  if (!r || !text(r.id) || !Number.isSafeInteger(r.revision) || r.revision < 1 || !text(r.origin)) throw new Error('invalid recipe identity')
  const origin = new URL(r.origin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== r.origin) throw new Error('recipe requires exact HTTP(S) origin')
  if (!locator(r.account) || !locator(r.login)) throw new Error('recipe requires account and login locators')
  if (!r.limits || !Object.values(r.limits).every((v) => Number.isSafeInteger(v) && v > 0) || r.limits.timeoutMs > 120_000 || r.limits.maxSteps > 50 || r.limits.maxOutputBytes > 1_000_000 || r.limits.maxDownloadBytes > 10_000_000) throw new Error('invalid recipe limits')
  for (const key of ['timeoutMs', 'maxSteps', 'maxOutputBytes', 'maxDownloadBytes'] as const) if (!Number.isSafeInteger(r.limits[key])) throw new Error('missing recipe limit')
  if (!Array.isArray(r.steps) || r.steps.length < 3 || r.steps.length > r.limits.maxSteps || r.steps[0]?.op !== 'navigate' || r.steps[1]?.op !== 'assertAccount') throw new Error('recipe must navigate and verify account first')
  const ids = new Set<string>()
  const fields = new Set<string>()
  for (const s of r.steps) {
    if (!s || !text(s.id) || ids.has(s.id)) throw new Error('invalid/duplicate step ID')
    ids.add(s.id)
    const allowed: Record<string, string[]> = { navigate: ['id','op','url'], assertAccount: ['id','op'], fill: ['id','op','target','value'], query: ['id','op','target','postcondition','request'], extract: ['id','op','target','field'], download: ['id','op','target','field'] }
    if (!allowed[s.op] || Object.keys(s).some((k) => !allowed[s.op]!.includes(k))) throw new Error('unsupported recipe operation/property')
    if ('target' in s && !locator(s.target)) throw new Error('invalid locator')
    if (s.op === 'navigate') {
      const u = new URL(s.url)
      if (u.origin !== r.origin || u.username || u.password) throw new Error('navigation outside recipe scope')
    }
    if (s.op === 'fill' && !text(s.value)) throw new Error('invalid fill value')
    if (s.op === 'query' && (!s.postcondition || !locator(s.postcondition.target) || !text(s.postcondition.text) || !s.request || !['GET','POST'].includes(s.request.method) || !text(s.request.path) || !s.request.path.startsWith('/') || new URL(s.request.path, r.origin).origin !== r.origin)) throw new Error('query requires reviewed request and postcondition')
    if ('field' in s) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(s.field) || ['constructor','prototype','__proto__'].includes(s.field) || fields.has(s.field)) throw new Error('invalid/duplicate field')
      fields.add(s.field)
    }
  }
  if (!fields.size) throw new Error('recipe requires output')
  return structuredClone(r)
}
