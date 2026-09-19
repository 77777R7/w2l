import { mkdir, writeFile } from 'node:fs/promises'
import { bindSuite, startFixtureServer } from '@w2l/fixtures'

const out = process.env.W2L_PHASE3_MANIFEST ?? 'output/phase3-gate/manifest.json'
const baseUrl = process.env.W2L_PHASE3_FIXTURE_BASE_URL
const server = baseUrl === undefined ? await startFixtureServer(Number(process.env.FIXTURE_PORT ?? 8787), process.env.FIXTURE_HOST ?? '127.0.0.1') : null
try {
  const suite = bindSuite(baseUrl ?? server!.url)
  await mkdir(out.split('/').slice(0, -1).join('/') || '.', { recursive: true })
  await writeFile(out, JSON.stringify({ suite, fixtureBaseUrl: baseUrl ?? server!.url }, null, 2) + '\n')
  process.stdout.write(`manifest=${out}\nbase=${baseUrl ?? server!.url}\ncases=${suite.cases.length}\n`)
} finally {
  if (server !== null) await server.close()
}
