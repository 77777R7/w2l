import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export const listingSeeds = Object.freeze([
  'electronics', 'home-garden', 'beauty', 'pet-supplies',
  'sporting-goods', 'office-products', 'toys-and-games', 'automotive',
  'computers', 'kitchen', 'health', 'baby-products',
  'fashion', 'grocery', 'books', 'video-games',
].map(category => `https://www.amazon.sg/gp/bestsellers/${category}`))

export function asinFromProductUrl(link) {
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' || !/(^|\.)amazon\.sg$/i.test(url.hostname)) return null
    return url.pathname.match(/^\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() ?? null
  } catch { return null }
}

export function isListingUrl(link) {
  try {
    const url = new URL(link)
    return url.protocol === 'https:' && url.hostname === 'www.amazon.sg'
      && /^\/gp\/bestsellers\/[a-z0-9-]+\/?$/i.test(url.pathname)
  } catch { return false }
}

export function asinsInText(source) {
  const ids = new Set()
  for (const match of source.matchAll(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#"'\s]|$)/gi)) ids.add(match[1].toUpperCase())
  for (const match of source.matchAll(/"(?:asin|requestedAsin|selectedAsin|productAsin|parentAsin)"\s*:\s*"([A-Z0-9]{10})"/gi)) ids.add(match[1].toUpperCase())
  // Older human-review notes sometimes contain bare B0-prefixed ASINs.
  // Requiring the digit avoids ordinary ten-letter words such as "background".
  for (const match of source.matchAll(/\bB0[0-9A-Z]{8}\b/gi)) ids.add(match[0].toUpperCase())
  return ids
}

const textSuffix = /\.(?:json|jsonl|md|html|txt|csv|ts|tsx|mjs|js)$/i
const ignoredDirs = new Set(['node_modules', 'dist', 'raw', 'coverage', '.git'])

async function walk(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirs.has(entry.name)) files.push(...await walk(join(dir, entry.name)))
    else if (entry.isFile() && textSuffix.test(entry.name)) files.push(join(dir, entry.name))
  }
  return files
}

/**
 * The exclusion ledger is intentionally conservative. It scans all tracked
 * text files (including fixtures), local ignored JSON/Markdown reports, and
 * optional archived evidence directories. Raw captured HTML is skipped: its
 * recommendation links are not prior evaluation targets, and the report row
 * already records each evaluated request URL/ASIN.
 */
export async function buildExclusionLedger(root, additionalDirs = []) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
    .toString('utf8').split('\0').filter(path => textSuffix.test(path))
    .map(path => resolve(root, path))
  const localDir = resolve(root, '.w2l')
  const localFiles = await stat(localDir).then(() => walk(localDir), () => [])
  const archiveFiles = (await Promise.all(additionalDirs.map(async dir => walk(resolve(dir))))).flat()
  const files = [...new Set([...tracked, ...localFiles, ...archiveFiles])].sort()
  const sources = []
  const excluded = new Set()
  for (const file of files) {
    const bytes = await readFile(file)
    const ids = asinsInText(bytes.toString('utf8'))
    if (ids.size === 0) continue
    for (const id of ids) excluded.add(id)
    sources.push({ path: file.startsWith(`${root}/`) ? relative(root, file) : file,
      sha256: sha256(bytes), asinCount: ids.size })
  }
  const excludedAsins = [...excluded].sort()
  return { sources, excludedAsins,
    excludedAsinsSha256: sha256(Buffer.from(excludedAsins.join('\n') + '\n')),
    sourcesSha256: sha256(Buffer.from(JSON.stringify(sources))),
  }
}

export function registeredWorktreeEvidenceDirs(root) {
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length))
  return worktrees.map(path => join(path, '.w2l'))
}

export function selectUnseenHundred(seedRows, exclusions) {
  const excluded = new Set(exclusions)
  const candidates = seedRows.map(row => ({ ...row,
    ids: row.status === 'success'
      ? [...new Set(row.links.map(asinFromProductUrl).filter(id => id && !excluded.has(id)))]
      : [],
  }))
  const selected = []
  const seen = new Set()
  let index = 0
  while (selected.length < 100 && candidates.some(row => index < row.ids.length)) {
    for (const row of candidates) {
      const asin = row.ids[index]
      if (!asin || seen.has(asin)) continue
      seen.add(asin)
      selected.push({ asin, sourceListing: row.seed,
        url: `https://www.amazon.sg/dp/${asin}` })
      if (selected.length === 100) break
    }
    index++
  }
  return selected
}
