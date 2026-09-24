/** Bind a completed local MCP batch to the saved raw HTML without trusting
 * the emitted product JSON. Keeps the original transport report intact. */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseHTML } from 'linkedom'

const reportPath=process.argv[2]
if(!reportPath)throw new Error('usage: link-amazon-raw-evidence.mjs REPORT_JSON')
const report=JSON.parse(await readFile(reportPath,'utf8'))
if(report.records?.length!==100||report.kind!=='dual-flow-final-path-local-diagnostic')throw new Error('expected frozen 100-product MCP diagnostic')
const root=dirname(resolve(reportPath))
const rawDir=join(root,'raw')
const paths=(await readdir(rawDir)).filter(name=>name.endsWith('.html'))
if(paths.length!==100)throw new Error(`expected 100 raw HTML files, found ${paths.length}`)
const rawBySelectedAsin=new Map()
for(const name of paths){
  const path=join(rawDir,name)
  const bytes=await readFile(path)
  const hash=createHash('sha256').update(bytes).digest('hex')
  if(name!==`${hash}.html`)throw new Error(`raw HTML filename/hash mismatch: ${name}`)
  const doc=parseHTML(bytes.toString()).document
  const selected=doc.querySelector('input[name="ASIN"], #ASIN')?.getAttribute('value')?.toUpperCase()??null
  if(!selected||rawBySelectedAsin.has(selected))throw new Error(`missing or duplicate selected ASIN in raw HTML: ${selected}`)
  rawBySelectedAsin.set(selected,{path,hash})
}
for(const record of report.records){
  const raw=rawBySelectedAsin.get(record.asin)
  if(!raw)throw new Error(`no raw HTML selected subject for requested ${record.asin}`)
  record.snapshot={...record.snapshot,rawBodySha256:raw.hash,artifacts:[raw.path]}
}
const linkedPath=join(root,'linked-report.json')
report.rawBinding={method:'independent input[name="ASIN"] selected-subject match plus SHA256 filename/content check',rawFilesVerified:paths.length,linkedAt:new Date().toISOString()}
await writeFile(linkedPath,JSON.stringify(report,null,2))
console.log(JSON.stringify({linkedPath,rawFilesVerified:paths.length,requestedSubjectsMatched:report.records.length}))
