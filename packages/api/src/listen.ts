import { hostedNetworkPolicy, localNetworkPolicy, type NetworkPolicy } from '@w2l/contracts'

export type ApiMode = 'local' | 'hosted'

export interface ListenConfig {
  mode: ApiMode
  host: string
  port: number
  token: string | null
  networkPolicy: NetworkPolicy
  defaultMaxPages: number | null
}

export function parseListen(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): ListenConfig {
  const hosted = argv.includes('--hosted') || env['W2L_API_MODE'] === 'hosted'
  const port = parsePort(argv, env)
  const token = readFlag(argv, '--token') ?? env['W2L_API_TOKEN'] ?? null
  if (hosted) {
    if (token === null || token.length === 0) {
      throw new Error('hosted mode requires --token or W2L_API_TOKEN')
    }
    return {
      mode: 'hosted',
      host: readFlag(argv, '--host') ?? env['W2L_API_HOST'] ?? '0.0.0.0',
      port,
      token,
      networkPolicy: hostedNetworkPolicy(),
      defaultMaxPages: 100,
    }
  }
  return {
    mode: 'local',
    host: readFlag(argv, '--host') ?? env['W2L_API_HOST'] ?? '127.0.0.1',
    port,
    token,
    networkPolicy: localNetworkPolicy(),
    defaultMaxPages: null,
  }
}

export function parsePort(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): number {
  const raw = readFlag(argv, '--port') ?? env['W2L_API_PORT'] ?? '8787'
  const port = Number(raw)
  if (!Number.isFinite(port) || port < 1) throw new Error('--port must be a positive integer')
  return port
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 1)
  const idx = argv.indexOf(name)
  if (idx >= 0 && argv[idx + 1] !== undefined) return argv[idx + 1]
  return undefined
}
