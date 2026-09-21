# Anti-Blocking Reliability Slice

## Scope

This slice improves compliant access reliability. It does not implement
fingerprint spoofing, CAPTCHA bypass, identity rotation, stealth CDP patching,
or proxy-pool evasion.

## Changes

- `Retry-After` accepts both integer seconds and HTTP-date values.
- 503 retries use bounded exponential backoff plus injectable jitter when the
  server does not provide a usable delay.
- The retry delay is capped; a server delay is never treated as permission to
  retry indefinitely.
- The HTTP subject records a per-host cooldown after 429/503 and waits before
  the next same-host request.
- Robots decisions, URL safety, per-host delay, and explicit identity remain
  hard gates.

## Verification

- Pure retry tests cover seconds, HTTP-date, invalid header fallback, cap, and
  429 non-retry behavior.
- Fixture integration verifies a 429 sets cooldown and the next same-host
  request waits before sending.
- Full project regression remains the acceptance check.

## Boundary

These changes reduce accidental repeat pressure and improve recovery after a
server-directed delay. They do not claim improved success against deliberate
anti-bot systems, and they do not bypass human verification.
