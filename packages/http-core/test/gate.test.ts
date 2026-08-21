import { describe, expect, it } from 'vitest'
import {
  classifyGate,
  escalationForBlock,
  type GateBlockReason,
  type GateLane,
  type GateResponse,
} from '../src/gate.js'

/**
 * Gate classifier tests. Two obligations beyond "the happy cases work":
 *
 *  1. every reason the classifier declares must be reachable from a real
 *     response shape — the defect this whole change exists to fix was a
 *     contract declaring six reasons while the code could emit one. That the
 *     six below are exactly the contract's six is asserted in @w2l/bench,
 *     which is where both packages are legitimately visible (http-core stays
 *     dependency-free).
 *  2. the negative cases must stay negative. A classifier that labels every
 *     403 a bot gate is worse than no classifier, because it launders a guess
 *     as an observation.
 */

const ALL_REASONS: readonly GateBlockReason[] = [
  'cloudflare_challenge',
  'captcha',
  'rate_limit',
  'login_wall',
  'geo_restricted',
  'bot_detected_generic',
]

function res(overrides: Partial<GateResponse> & { body?: string }): GateResponse {
  const headers: Record<string, string> = {}
  return {
    status: 200,
    header: (name) => headers[name.toLowerCase()] ?? null,
    body: '',
    ...overrides,
  }
}

function withHeaders(
  headers: Record<string, string>,
  overrides: Partial<GateResponse> = {},
): GateResponse {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return res({ ...overrides, header: (name) => lower[name.toLowerCase()] ?? null })
}

const ARTICLE = `<!doctype html><html><head><title>How TLS works</title></head><body>
<article><h1>How TLS works</h1><p>A handshake negotiates cipher suites before any
application data flows. This paragraph is ordinary prose with no gate markers.</p>
</article></body></html>`

describe('classifyGate — statuses whose meaning is the gate', () => {
  it('classifies 429 as rate_limit from the status alone', () => {
    const v = classifyGate(res({ status: 429, body: '<h1>Too Many Requests</h1>' }))
    expect(v).toEqual({ reason: 'rate_limit', signals: ['status_429'] })
  })

  it('classifies 451 as geo_restricted', () => {
    expect(classifyGate(res({ status: 451 }))?.reason).toBe('geo_restricted')
  })

  it('classifies 401 as login_wall', () => {
    expect(classifyGate(res({ status: 401 }))?.reason).toBe('login_wall')
  })
})

describe('classifyGate — vendor headers are decisive', () => {
  it('names Cloudflare from cf-mitigated with no body evidence', () => {
    const v = classifyGate(withHeaders({ 'cf-mitigated': 'challenge' }, { status: 403 }))
    expect(v).toEqual({ reason: 'cloudflare_challenge', signals: ['header_cf_mitigated'] })
  })

  it('names a generic bot gate from x-datadome', () => {
    const v = classifyGate(withHeaders({ 'x-datadome': 'protected' }, { status: 403 }))
    expect(v?.reason).toBe('bot_detected_generic')
    expect(v?.signals).toContain('header_x_datadome')
  })

  it('matches vendor headers case-insensitively', () => {
    const v = classifyGate(withHeaders({ 'X-IInfo': '1-2-3' }, { status: 403 }))
    expect(v?.reason).toBe('bot_detected_generic')
  })
})

describe('classifyGate — Cloudflare interstitial', () => {
  it('names Cloudflare from the challenge-platform script path', () => {
    const v = classifyGate(
      res({ status: 403, body: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>' }),
    )
    expect(v?.reason).toBe('cloudflare_challenge')
    expect(v?.signals).toContain('cf_challenge_platform_script')
  })

  it('names Cloudflare from the interstitial copy pair on a 200', () => {
    const v = classifyGate(
      res({
        status: 200,
        body: '<title>Just a moment...</title><h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue.</p>',
      }),
    )
    expect(v).toEqual({ reason: 'cloudflare_challenge', signals: ['cf_interstitial_text'] })
  })

  it('does not name Cloudflare from half the copy pair alone', () => {
    // "Just a moment" without the JS/cookies line is only a weak signal, and a
    // 200 is not a gate-shaped status, so nothing should fire.
    expect(classifyGate(res({ status: 200, body: '<p>Just a moment, loading your cart…</p>' }))).toBeNull()
  })
})

describe('classifyGate — captcha widgets are distinct from interstitials', () => {
  it('classifies a standalone reCAPTCHA widget as captcha', () => {
    const v = classifyGate(
      res({ status: 403, body: '<div class="g-recaptcha" data-sitekey="abc"></div>' }),
    )
    expect(v?.reason).toBe('captcha')
  })

  it('classifies an hCaptcha widget as captcha', () => {
    expect(
      classifyGate(res({ status: 200, body: '<script src="https://hcaptcha.com/1/api.js"></script>' }))
        ?.reason,
    ).toBe('captcha')
  })

  it('prefers the Cloudflare verdict when a managed challenge also embeds Turnstile', () => {
    // Vendor plumbing wins over the widget: the interstitial is the gate, and
    // its escalation path (run the JS) differs from a widget needing a person.
    const v = classifyGate(
      res({
        status: 403,
        body: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script><div class="cf-turnstile"></div>',
      }),
    )
    expect(v?.reason).toBe('cloudflare_challenge')
  })
})

describe('classifyGate — login wall needs structure, not a keyword', () => {
  it('classifies a sign-in-to-continue page with a password field', () => {
    const v = classifyGate(
      res({
        status: 200,
        body: `<title>Sign in</title><h1>Sign in to continue reading</h1>
<form method="post"><input name="email"><input name="password" type="password"></form>`,
      }),
    )
    expect(v?.reason).toBe('login_wall')
    expect(v?.signals).toContain('input_password')
  })

  it('does not classify a login intent phrase without a password field', () => {
    // A teaser that says "sign in to continue" but ships no form is not the
    // wall itself; extraction may still have legitimately failed for other reasons.
    expect(
      classifyGate(res({ status: 200, body: '<p>Please sign in to continue.</p>' })),
    ).toBeNull()
  })

  it('does not classify a password field without login intent', () => {
    expect(
      classifyGate(res({ status: 200, body: '<form><input type="password"></form>' })),
    ).toBeNull()
  })
})

describe('classifyGate — geo restriction', () => {
  it('classifies a country block from body copy', () => {
    const v = classifyGate(
      res({ status: 200, body: '<h1>This video is not available in your country.</h1>' }),
    )
    expect(v?.reason).toBe('geo_restricted')
  })
})

describe('classifyGate — generic bot gate thresholds', () => {
  it('fires on a single strong refusal marker', () => {
    const v = classifyGate(res({ status: 403, body: '<h1>You have been blocked</h1>' }))
    expect(v?.reason).toBe('bot_detected_generic')
    expect(v?.signals).toEqual(['text_you_have_been_blocked'])
  })

  it('fires on two weak markers even with an ordinary status', () => {
    const v = classifyGate(
      res({ status: 200, body: '<p>Please wait</p><p>Security check in progress</p>' }),
    )
    expect(v?.reason).toBe('bot_detected_generic')
    expect(v?.signals.length).toBeGreaterThanOrEqual(2)
  })

  it('fires on one weak marker when the status is gate-shaped', () => {
    const v = classifyGate(res({ status: 403, body: '<p>Please wait</p>' }))
    expect(v?.reason).toBe('bot_detected_generic')
    expect(v?.signals).toContain('status_403')
  })

  it('does NOT fire on one weak marker with an ordinary status', () => {
    expect(classifyGate(res({ status: 200, body: '<p>Please wait</p>' }))).toBeNull()
  })

  it('classifies a 202 with an empty body as a swallowed request', () => {
    const v = classifyGate(res({ status: 202, body: '' }))
    expect(v?.reason).toBe('bot_detected_generic')
    expect(v?.signals).toEqual(['status_202_empty_body'])
  })

  it('does NOT classify a 202 that actually carries a page', () => {
    expect(classifyGate(res({ status: 202, body: ARTICLE.repeat(20) }))).toBeNull()
  })
})

describe('classifyGate — negatives that must stay negative', () => {
  it('returns null for a bare 403 with no gate evidence', () => {
    // The whole honesty rule in one test: 403 alone is indistinguishable from
    // an ordinary permission error, so the caller keeps reporting http_error.
    expect(classifyGate(res({ status: 403, body: '<h1>403 Forbidden</h1><hr>nginx' }))).toBeNull()
  })

  it('returns null for a 500', () => {
    expect(classifyGate(res({ status: 500, body: '<h1>Internal Server Error</h1>' }))).toBeNull()
  })

  it('returns null for a 404', () => {
    expect(classifyGate(res({ status: 404, body: '<h1>Not Found</h1>' }))).toBeNull()
  })

  it('returns null for an ordinary article', () => {
    expect(classifyGate(res({ status: 200, body: ARTICLE }))).toBeNull()
  })

  it('returns null when there was no response at all', () => {
    expect(classifyGate(res({ status: null, body: '' }))).toBeNull()
  })

  it('returns null for an empty 200', () => {
    expect(classifyGate(res({ status: 200, body: '' }))).toBeNull()
  })
})

describe('every declared BlockReason is reachable', () => {
  // The regression guard for the defect this change fixes: a vocabulary that
  // declares reasons the code cannot emit. If a reason is added without a
  // classification path, this fails.
  const REACHED: ReadonlyArray<readonly [GateBlockReason, GateResponse]> = [
    ['rate_limit', res({ status: 429 })],
    ['geo_restricted', res({ status: 451 })],
    ['login_wall', res({ status: 401 })],
    ['cloudflare_challenge', withHeaders({ 'cf-mitigated': 'challenge' }, { status: 403 })],
    ['captcha', res({ status: 403, body: '<div class="g-recaptcha"></div>' })],
    ['bot_detected_generic', res({ status: 403, body: '<h1>You have been blocked</h1>' })],
  ]

  it.each(REACHED.map(([reason, input]) => [reason, input] as const))(
    'emits %s from a real response shape',
    (reason, input) => {
      expect(classifyGate(input)?.reason).toBe(reason)
    },
  )

  it('covers every reason the classifier can name', () => {
    expect([...REACHED.map(([r]) => r)].sort()).toEqual([...ALL_REASONS].sort())
  })

  it('never returns an empty signal list', () => {
    for (const [, input] of REACHED) {
      expect(classifyGate(input)!.signals.length).toBeGreaterThan(0)
    }
  })
})

describe('escalationForBlock — legitimate paths only', () => {
  it('offers the browser lane for an http-lane interstitial', () => {
    expect(escalationForBlock('cloudflare_challenge', 'http')).toEqual({
      from: 'http',
      to: 'browser_local',
      trigger: 'blocked:cloudflare_challenge',
    })
  })

  it('offers the user-owned proxy once the browser lane is already blocked', () => {
    expect(escalationForBlock('cloudflare_challenge', 'browser_local')?.to).toBe('browser_proxy')
  })

  it('offers a human handoff for a captcha rather than solving it', () => {
    expect(escalationForBlock('captcha', 'http')?.to).toBe('browser_local_authed')
  })

  it('offers a human handoff for a login wall', () => {
    expect(escalationForBlock('login_wall', 'browser_local')?.to).toBe('browser_local_authed')
  })

  it('offers the user-owned proxy for a geo block', () => {
    expect(escalationForBlock('geo_restricted', 'http')?.to).toBe('browser_proxy')
  })

  it('offers NOTHING for a rate limit — slowing down is the fix, not a lane', () => {
    for (const lane of ['http', 'browser_local', 'browser_proxy'] as GateLane[]) {
      expect(escalationForBlock('rate_limit', lane)).toBeNull()
    }
  })

  it('stops offering escalations once the last lane is exhausted', () => {
    expect(escalationForBlock('cloudflare_challenge', 'browser_proxy')).toBeNull()
    expect(escalationForBlock('captcha', 'browser_local_authed')).toBeNull()
    expect(escalationForBlock('geo_restricted', 'browser_proxy')).toBeNull()
  })

  it('never routes an escalation through defeating the gate', () => {
    // Every target must be a lane we legitimately have: more capability of our
    // own, the user's session, or the user's network. No provider-solves-captcha
    // path, no fingerprint-patching lane.
    const targets = new Set<GateLane>()
    for (const reason of ALL_REASONS) {
      for (const lane of ['http', 'browser_local', 'browser_proxy', 'browser_local_authed'] as GateLane[]) {
        const e = escalationForBlock(reason, lane)
        if (e) targets.add(e.to)
      }
    }
    expect([...targets].sort()).toEqual(['browser_local', 'browser_local_authed', 'browser_proxy'])
  })
})
