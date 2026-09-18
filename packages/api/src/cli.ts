#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { createApiEngine } from './engine.js'

export function parsePort(argv: readonly string[]): number {
  const flag = argv.find((arg) => arg.startsWith('--port=')) ?? (argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : undefined)
  if (flag === undefined) return 8787
  const value = flag.startsWith('--port=') ? flag.slice('--port='.length) : flag
  const port = Number(value)
  if (!Number.isFinite(port) || port < 1) throw new Error('--port must be a positive integer')
  return port
}

async function main(): Promise<void> {
  const port = parsePort(process.argv.slice(2))
  const engine = createApiEngine()
  const app = createApp(engine)
  serve({ fetch: app.fetch, port })
  console.log(`w2l-api listening on http://127.0.0.1:${port}`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
