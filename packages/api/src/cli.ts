#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { createApiEngine } from './engine.js'
import { parseListen, parsePort } from './listen.js'

export { parseListen, parsePort }

async function main(): Promise<void> {
  const listen = parseListen(process.argv.slice(2), process.env)
  const engine = createApiEngine({
    networkPolicy: listen.networkPolicy,
    defaultMaxPages: listen.defaultMaxPages,
  })
  const app = createApp(engine, { token: listen.token })
  serve({ fetch: app.fetch, hostname: listen.host, port: listen.port })
  console.log(`w2l-api ${listen.mode} listening on http://${listen.host}:${listen.port}`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
