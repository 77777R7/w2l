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

export function parseToken(argv: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
  const flag = argv.find((arg) => arg.startsWith('--token='))
  if (flag !== undefined) return flag.slice('--token='.length)
  const idx = argv.indexOf('--token')
  if (idx >= 0 && argv[idx + 1] !== undefined) return argv[idx + 1]
  const envToken = env['W2L_API_TOKEN']
  return envToken !== undefined && envToken.length > 0 ? envToken : undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const baseUrl = parseBaseUrl(argv, process.env)
  const token = parseToken(argv, process.env)
  const server = createMcpServer(new W2L({ baseUrl, token }))
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
