import { describe, expect, it } from 'vitest'
import { parseListen } from '../src/listen.js'

describe('parseListen', () => {
  it('defaults to loopback local mode without a token', () => {
    const listen = parseListen([], {})
    expect(listen).toMatchObject({
      mode: 'local',
      host: '127.0.0.1',
      port: 8787,
      token: null,
      defaultMaxPages: null,
    })
    expect(listen.networkPolicy.privateAllowlist.length).toBeGreaterThan(0)
  })

  it('refuses hosted mode without a token', () => {
    expect(() => parseListen(['--hosted'], {})).toThrow(/W2L_API_TOKEN/)
  })

  it('hosted mode binds 0.0.0.0, requires a token, and denies private ranges', () => {
    const listen = parseListen(['--hosted', '--token', 'secret'], {})
    expect(listen.mode).toBe('hosted')
    expect(listen.host).toBe('0.0.0.0')
    expect(listen.token).toBe('secret')
    expect(listen.defaultMaxPages).toBe(100)
    expect(listen.networkPolicy.privateAllowlist).toEqual([])
  })
})
