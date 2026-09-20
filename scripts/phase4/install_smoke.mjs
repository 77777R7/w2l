import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const started = Date.now()
const commands = [
  ['node', ['--version']],
  ['npm', ['--version']],
]
const output = []
for (const [command, args] of commands) {
  try { output.push({ command, args, ok: true, stdout: execFileSync(command, args, { encoding: 'utf8' }).trim() }) }
  catch (error) { output.push({ command, args, ok: false, error: String(error) }) }
}
const report = { protocol: 'phase4-second-developer-install', status: 'operator_not_verified', generatedAt: new Date().toISOString(), elapsedMs: Date.now() - started, commands: output, note: 'Run this from a clean clone by a second developer; this script does not claim authorship independence.' }
await writeFile('output/phase4/install-smoke.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
