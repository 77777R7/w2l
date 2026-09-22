import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

// Captures the supplied working tree without committing or publishing it.
// Run only after the review snapshot is frozen; extraction needs no Git metadata.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const root = git('rev-parse', '--show-toplevel')
process.chdir(root)
const output = resolve(process.argv[2] ?? '.w2l/gate4-handoff')
await mkdir(output, { recursive: true, mode: 0o700 })
const staging = await mkdtemp(join(output, '.staging-'))
const archive = join(output, 'w2l-review-source.tar.gz')
const nulList = (args) => execFileSync('git', args).toString('utf8').split('\0').filter(Boolean)
const tracked = nulList(['ls-files', '--cached', '-z'])
const untracked = nulList(['ls-files', '--others', '--exclude-standard', '-z'])
const approvedEvidence = new Set([
  'research/gate2-process-recovery.generated.json',
  'research/gate2-claim-race.generated.json',
  'research/gate3-https-delivery.generated.json',
])
const allowedNew = (path) => (/^(?:packages\/|scripts\/section-b\/|examples\/|docs\/)/.test(path) || approvedEvidence.has(path)) && !/ 2(?:\.[^/]*)?$/.test(path)
const excluded = (path) => /(?:^|\/)(?:\.git|node_modules|\.w2l|dist|coverage)(?:\/|$)/.test(path)
  || /(?:^|\/)(?:\.env(?:\..*)?|(?:secrets?|credentials?)(?:\.[^/]*)?|[^/]*\.(?:key|p12|pfx))$/i.test(path)
const paths = [...new Set([...tracked, ...untracked.filter(allowedNew)])].filter((path) => !excluded(path)).sort()
const files = []
try {
  for (const path of paths) {
    if (isAbsolute(path) || path.split('/').includes('..')) throw new Error(`Unsafe archive path: ${path}`)
    const source = join(root, path)
    const destination = join(staging, path)
    let stat
    try { stat = await lstat(source) } catch (error) {
      if (error.code === 'ENOENT') continue // Respect tracked deletions in the supplied tree.
      throw error
    }
    await mkdir(dirname(destination), { recursive: true })
    if (stat.isSymbolicLink()) {
      const target = await readlink(source)
      const resolved = relative(root, resolve(dirname(source), target))
      if (isAbsolute(target) || resolved === '..' || resolved.startsWith('../')) throw new Error(`External symlink excluded from source handoff: ${path}`)
      await symlink(target, destination)
      files.push({ path, type: 'symlink', target, sha256: createHash('sha256').update(target).digest('hex') })
    } else if (stat.isFile()) {
      const content = await readFile(source)
      // Never distribute a private key or an environment file from an accidental addition.
      if (/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/.test(content.toString('utf8'))) throw new Error(`Private key material found in ${path}; remove it from handoff scope`)
      await writeFile(destination, content, { mode: stat.mode & 0o777 })
      files.push({ path, type: 'file', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') })
    }
  }
  const manifest = { format: 'w2l-review-source/v1', capturedAt: new Date().toISOString(),
    repository: 'https://github.com/77777R7/w2l.git', branch: git('branch', '--show-current') || '(detached)',
    baseSha: git('rev-parse', 'HEAD'), workingTreeSnapshot: true, committed: false, published: false,
    fileCount: files.length, files }
  const manifestText = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(join(staging, 'handoff-manifest.json'), manifestText)
  execFileSync('tar', ['-czf', archive, '-C', staging, '.'])
  await chmod(archive, 0o600)
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(join(output, 'SHA256SUMS'), `${sha256}  w2l-review-source.tar.gz\n`)
  await writeFile(join(output, 'handoff-manifest.json'), manifestText)
  console.log(JSON.stringify({ archive, sha256, fileCount: files.length, branch: manifest.branch,
    baseSha: manifest.baseSha, committed: false, published: false }, null, 2))
} finally {
  await rm(staging, { recursive: true, force: true })
}
