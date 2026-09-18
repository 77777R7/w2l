#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { pathToFileURL } from 'node:url'
import { W2L } from '@w2l/sdk'
import { createMcpServer } from './server.js'

export function parseBaseUrl(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  const flag = argv.find((arg) => arg.startsWith('--base-url='))
  if (flag !== undefined) return flag.slice('--base-url='.length)
  const idx = argv.indexOf('--base-url')
  if (idx >= 0 && argv[idx + 1] !== undefined) return argv[idx + 1]!
  return env['W2L_API_URL'] ?? 'http://127.0.0.1:8787'
}

async function main(): Promise<void> {
  const baseUrl = parseBaseUrl(process.argv.slice(2), process.env)
  const server = createMcpServer(new W2L({ baseUrl }))
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
