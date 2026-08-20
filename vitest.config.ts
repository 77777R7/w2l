import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Workspace packages resolve to source, not dist: a stale build must never
  // silently test old code (dist/ is gitignored and rebuilt separately).
  resolve: {
    alias: {
      '@w2l/contracts': resolve(root, 'packages/contracts/src/index.ts'),
      '@w2l/extract-tf': resolve(root, 'packages/extract-tf/src/index.ts'),
      '@w2l/fixtures': resolve(root, 'packages/fixtures/src/index.ts'),
      '@w2l/http-core': resolve(root, 'packages/http-core/src/index.ts'),
      '@w2l/bench': resolve(root, 'packages/bench/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
