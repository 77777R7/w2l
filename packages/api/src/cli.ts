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
    taskRoot: process.env.W2L_TASK_ROOT ?? '.w2l/api',
    networkPolicy: listen.networkPolicy,
    defaultMaxPages: listen.defaultMaxPages,
  })
  const app = createApp(engine, { token: listen.token })
  const server = serve({ fetch: app.fetch, hostname: listen.host, port: listen.port })
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (stopping) return
    stopping = true
    server.close()
    void engine.close({cancelActive: true}).catch((error) => { console.error(error); process.exitCode = 1 })
  })
  console.log(`w2l-api ${listen.mode} listening on http://${listen.host}:${listen.port}`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
