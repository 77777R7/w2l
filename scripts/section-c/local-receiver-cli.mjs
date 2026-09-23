#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const privateDir=join(root,'.w2l/local-receiver')
const secretFile=join(root,'.w2l/local-mcp.env')
if(statSync(secretFile).mode & 0o077)throw new Error(`${secretFile} must be owner-readable only`)
const secret=/^W2L_WEBHOOK_SECRET_DEMO=(.+)$/m.exec(readFileSync(secretFile,'utf8'))?.[1]
if(!secret)throw new Error('W2L_WEBHOOK_SECRET_DEMO is missing from the private local file')
process.env.WEBHOOK_SECRET=secret
process.env.WEBHOOK_DB=join(privateDir,'receiver.sqlite')
process.env.WEBHOOK_HOST='127.0.0.1'
process.env.WEBHOOK_PORT='8788'
process.env.TLS_CERT_FILE=join(privateDir,'receiver.crt')
process.env.TLS_KEY_FILE=join(privateDir,'receiver.key')
await import('../../examples/webhook-receiver.ts')
