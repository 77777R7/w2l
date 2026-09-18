/**
 * Identity bundle: the anti-bot layer we can actually own.
 *
 * FP-Inconsistent (IMC 2025) showed that bots which "escape" DataDome/BotD
 * still leak because they rewrite fingerprint fields that no longer agree
 * with each other. 2606.30119 showed JS stealth often *increases*
 * detectability. So the product rule is: one coherent identity, fail closed
 * on contradiction. This is not disguise — it is refusing to ship a lie.
 */

import { BROWSER_FINGERPRINT, modeIdentity, type CrawlMode, type ModeIdentity } from './compliance.js'

export interface IdentityBundle {
  userAgent: string
  clientHints: Readonly<Record<string, string>>
  locale: string
  timezoneId: string
  viewport: { width: number; height: number }
  screen: { width: number; height: number }
}

const LOCALE_RE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/

function chromeMajorFromUa(ua: string): number | null {
  const m = /(?:Chrome|Chromium)\/(\d+)/.exec(ua)
  return m ? Number(m[1]) : null
}

function chromeMajorFromHints(hints: Readonly<Record<string, string>>): number | null {
  const ch = hints['sec-ch-ua']
  if (!ch) return null
  const m = /(?:Chromium|Google Chrome)";v="(\d+)"/.exec(ch)
  return m ? Number(m[1]) : null
}

function platformFromUa(ua: string): 'macOS' | 'Windows' | 'Linux' | 'Android' | null {
  if (/\bAndroid\b/i.test(ua)) return 'Android'
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return 'macOS'
  if (/\bWindows NT\b/.test(ua)) return 'Windows'
  if (/\bLinux\b/.test(ua)) return 'Linux'
  return null
}

function platformFromHints(hints: Readonly<Record<string, string>>): string | null {
  const raw = hints['sec-ch-ua-platform']
  if (!raw) return null
  return raw.replace(/"/g, '')
}

/** Problems in a bundle. Empty means the identity is internally coherent. */
export function identityBundleIssues(bundle: IdentityBundle): string[] {
  const issues: string[] = []
  const { userAgent: ua, clientHints, locale, timezoneId, viewport, screen } = bundle

  if (viewport.width <= 0 || viewport.height <= 0) {
    issues.push(`viewport must be positive, got ${viewport.width}x${viewport.height}`)
  }
  if (screen.width < viewport.width || screen.height < viewport.height) {
    issues.push(
      `screen ${screen.width}x${screen.height} smaller than viewport ${viewport.width}x${viewport.height}`,
    )
  }
  if (!LOCALE_RE.test(locale)) {
    issues.push(`locale "${locale}" is not a language tag`)
  }
  if (!timezoneId.includes('/')) {
    issues.push(`timezoneId "${timezoneId}" is not an IANA zone`)
  }
  if (/\bHeadlessChrome\b/.test(ua)) {
    issues.push('user-agent contains HeadlessChrome — that is a bug, not a mode')
  }

  const uaMajor = chromeMajorFromUa(ua)
  const hintMajor = chromeMajorFromHints(clientHints)
  if (uaMajor !== null && hintMajor !== null && uaMajor !== hintMajor) {
    issues.push(`Chrome major mismatch: UA ${uaMajor} vs sec-ch-ua ${hintMajor}`)
  }

  const uaPlatform = platformFromUa(ua)
  const hintPlatform = platformFromHints(clientHints)
  if (uaPlatform && hintPlatform && uaPlatform !== hintPlatform) {
    issues.push(`platform mismatch: UA ${uaPlatform} vs sec-ch-ua-platform ${hintPlatform}`)
  }

  const claimsBrowser =
    clientHints['sec-ch-ua'] !== undefined || clientHints['sec-ch-ua-platform'] !== undefined
  if (/\bw2l-research\b/.test(ua) && claimsBrowser) {
    issues.push('research UA must not send Chromium client hints')
  }
  if (uaMajor !== null && Object.keys(clientHints).length === 0) {
    issues.push('browser UA is missing aligned client hints')
  }

  return issues
}

/**
 * L4 / vendor wire identity. We never inject our Chrome bundle into a vendor
 * browser — we measure theirs. This check is: does what they actually send
 * contradict the *mode* we claimed, or contradict itself?
 *
 * Missing client hints are allowed (most vendors do not surface them).
 * HeadlessChrome, research-mode Chromium, and UA/hint disagreement are not.
 */
export function vendorIdentityIssues(
  mode: CrawlMode,
  userAgent: string,
  clientHints: Readonly<Record<string, string>> = {},
): string[] {
  const issues: string[] = []
  if (/\bHeadlessChrome\b/.test(userAgent)) {
    issues.push('user-agent contains HeadlessChrome — that is a bug, not a mode')
  }
  const looksLikeChrome =
    /(?:Chrome|Chromium)\//.test(userAgent) ||
    clientHints['sec-ch-ua'] !== undefined ||
    clientHints['sec-ch-ua-platform'] !== undefined
  if (mode === 'research' && looksLikeChrome) {
    issues.push('research mode must not look like Chrome on the vendor wire')
  }
  const uaMajor = chromeMajorFromUa(userAgent)
  const hintMajor = chromeMajorFromHints(clientHints)
  if (uaMajor !== null && hintMajor !== null && uaMajor !== hintMajor) {
    issues.push(`Chrome major mismatch: UA ${uaMajor} vs sec-ch-ua ${hintMajor}`)
  }
  const uaPlatform = platformFromUa(userAgent)
  const hintPlatform = platformFromHints(clientHints)
  if (uaPlatform && hintPlatform && uaPlatform !== hintPlatform) {
    issues.push(`platform mismatch: UA ${uaPlatform} vs sec-ch-ua-platform ${hintPlatform}`)
  }
  return issues
}

export function assertIdentityBundle(bundle: IdentityBundle): void {
  const issues = identityBundleIssues(bundle)
  if (issues.length > 0) {
    throw new Error(`identity bundle inconsistent:\n- ${issues.join('\n- ')}`)
  }
}

/**
 * Wire headers implied by a bundle. Asserts first: a contradictory bundle
 * never becomes bytes. HTTP subjects send this object verbatim.
 */
export function headersFromIdentity(bundle: IdentityBundle): Record<string, string> {
  assertIdentityBundle(bundle)
  return {
    'user-agent': bundle.userAgent,
    ...bundle.clientHints,
  }
}

/**
 * Route extras (proxy, cookies, vendor resume) that MUST NOT retune the face.
 * Changing IP ≠ changing identity.
 */
export interface RouteAccess {
  proxy?: unknown
  session?: unknown
  resume?: unknown
}

export type IdentityOverride = Partial<
  Pick<IdentityBundle, 'userAgent' | 'clientHints' | 'locale' | 'timezoneId' | 'viewport' | 'screen'>
>

/**
 * The identity a fetch presents, given a mode and optional user route.
 * `access` is accepted so callers cannot "forget" it — it is ignored.
 * An override that would retune timezone/locale/viewport to a proxy geo is
 * refused: that is fingerprint spoofing wearing a routing costume.
 */
export function identityForRoute(
  mode: CrawlMode,
  access: RouteAccess | null | undefined = null,
  chromeMajor?: number,
  override?: IdentityOverride | null,
): IdentityBundle {
  void access
  if (override !== undefined && override !== null && Object.keys(override).length > 0) {
    throw new Error(
      'identity override refused: changing IP or session is not changing identity. ' +
        'Do not retune timezone/locale/viewport to a proxy geo.',
    )
  }
  return identityBundleFrom(modeIdentity(mode, chromeMajor))
}

export function identityBundleFrom(
  identity: ModeIdentity,
  fingerprint: typeof BROWSER_FINGERPRINT = BROWSER_FINGERPRINT,
): IdentityBundle {
  return {
    userAgent: identity.userAgent,
    clientHints: identity.clientHints,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezoneId,
    viewport: fingerprint.viewport,
    screen: fingerprint.screen,
  }
}

/** One-line identity for CLI stdout. Never empty for a coherent bundle. */
export function formatIdentitySummary(bundle: IdentityBundle): string {
  if (/\bw2l-research\b/.test(bundle.userAgent)) {
    return `w2l-research · ${bundle.locale}`
  }
  const major = chromeMajorFromUa(bundle.userAgent)
  const platform =
    platformFromUa(bundle.userAgent) ?? platformFromHints(bundle.clientHints) ?? 'unknown'
  const chrome = major !== null ? `Chrome/${major}` : 'browser'
  return `${chrome} · ${platform} · ${bundle.locale}`
}
