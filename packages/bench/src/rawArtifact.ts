import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Opt-in raw snapshot capture for reproducible adapter baselines. */
export async function captureRawHtml(body: string, sha256: string): Promise<readonly string[]> {
  const root = process.env.W2L_CAPTURE_RAW_DIR?.trim()
  if (!root) return []
  await mkdir(root, { recursive: true })
  const path = join(root, `${sha256}.html`)
  try { await writeFile(path, body, { flag: 'wx' }) } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  return [path]
}
