#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPreviewServer } from './server.js'
import { firestoreQuotaFromEnv } from './quota.js'
import { firestoreAmazonGateFromEnv } from './amazonGate.js'
import { validateAmazonPublicState } from './preview.js'

if (process.env.W2L_CAPTURE_RAW_DIR) throw new Error('Anonymous preview cannot persist raw capture artifacts')
const stateFile = process.env.W2L_AMAZON_PUBLIC_STATE_FILE
const amazonState = stateFile ? readFileSync(stateFile, 'utf8') : null
if (amazonState !== null) validateAmazonPublicState(amazonState)
const port = Number(process.env.PORT ?? '8080')
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be a TCP port')
const server = createPreviewServer({
  quota: firestoreQuotaFromEnv(),
  amazonGate: firestoreAmazonGateFromEnv(),
  staticDir: resolve(process.env.W2L_PUBLIC_WEB_DIST ?? 'apps/public-web/dist'),
  amazonState,
  enabled: process.env.W2L_PREVIEW_ENABLED !== 'false',
  visitorCookieSecret: process.env.W2L_QUOTA_HASH_KEY,
  evalToken: process.env.W2L_EVAL_TOKEN,
  sourceCommit: process.env.W2L_SOURCE_COMMIT,
})
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ service: 'w2l-public-preview', port, anonymousPreviewEnabled: process.env.W2L_PREVIEW_ENABLED !== 'false' }))
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => server.close(() => process.exit(0)))
