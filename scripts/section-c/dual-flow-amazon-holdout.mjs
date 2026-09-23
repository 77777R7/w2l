/** Frozen 100-product diagnostic through the candidate hosted MCP transport.
 * Auth is injected locally; this cannot stand in for Render/WorkOS acceptance.
 * Run only from a clean source commit with W2L_AMAZON_PUBLIC_STATE_FILE set.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHostedService } from '../../packages/mcp/dist/host.js'

const manifestPath='research/amazon-product-holdout-100-sg.v1.json'
const schemaPath='research/amazon-product-schema.v1.json'
const statePath=process.env.W2L_AMAZON_PUBLIC_STATE_FILE
if(!statePath)throw new Error('W2L_AMAZON_PUBLIC_STATE_FILE is required')
const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()
if(dirty)throw new Error('commit the candidate source before the final-path diagnostic')
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const npm=execFileSync('npm',['--version'],{encoding:'utf8'}).trim()
const manifestBytes=await readFile(manifestPath)
const schemaBytes=await readFile(schemaPath)
const stateBytes=await readFile(statePath)
const manifest=JSON.parse(manifestBytes.toString())
if(manifest.urls?.length!==100 || new Set(manifest.urls).size!==100)throw new Error('expected the frozen 100 distinct URLs')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const startedAt=new Date().toISOString()
const outputDir=resolve(`.w2l/dual-flow-final-100/${startedAt.replaceAll(':','-').replaceAll('.','-')}`)
await mkdir(outputDir,{recursive:true})
process.env.W2L_CAPTURE_RAW_DIR=resolve(outputDir,'raw')

const probe=createServer()
probe.listen(0,'127.0.0.1');await once(probe,'listening')
const port=probe.address().port
await new Promise(done=>probe.close(done))
const service=createHostedService({mcpUrl:`https://127.0.0.1:${port}/mcp`,issuer:'https://auth.example',ownerSubject:'diagnostic-owner',receiverUrl:'https://receiver.example/webhook',amazonPublicState:stateBytes.toString(),taskRoot:resolve(outputDir,'tasks'),port,host:'127.0.0.1',verifyToken:async()=>({sub:'diagnostic-owner',scope:'openid'})})
if(!service.server.listening)await once(service.server,'listening')
const client=new Client({name:'w2l-frozen-100-diagnostic',version:'1.0.0'})
const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{authorization:'Bearer diagnostic'}}})
const call=async(name,args)=>{
  const response=await client.callTool({name,arguments:args})
  const block=response.content?.find(item=>item.type==='text')
  if(!block||block.type!=='text')throw new Error(`${name} returned no JSON text`)
  if(response.isError)throw new Error(`${name} failed: ${block.text.slice(0,500)}`)
  return JSON.parse(block.text)
}
const percentile=(values,ratio)=>{
  if(!values.length)return null
  const sorted=[...values].sort((a,b)=>a-b)
  return sorted[Math.max(0,Math.ceil(sorted.length*ratio)-1)]
}
const source={commit,dirty:false,node:process.version,npm,manifest:manifestPath,manifestSha256:sha(manifestBytes),schema:schemaPath,
  schemaSha256:sha(JSON.stringify(JSON.parse(schemaBytes.toString()))),schemaFileSha256:sha(schemaBytes),anonymousStateSha256:sha(stateBytes),anonymousStateFile:statePath,
  baselineLane:'local-hosted-streamable-http-mcp',concurrency:2,egressLabel:manifest.egressLabel,identity:manifest.identity,language:manifest.language,workosVerified:false,renderVerified:false}
let taskId=null
let terminal=null
let pages=[]
let batchClientMs=null
let failure=null
let details=null
const began=performance.now()
try {
  await client.connect(transport)
  const accepted=await call('batch_products',{urls:manifest.urls})
  taskId=accepted.taskId
  if(typeof taskId!=='string')throw new Error('batch_products returned no taskId')
  for(let poll=0;poll<120;poll++){
    terminal=await call('wait_batch',{id:taskId,timeoutMs:30_000})
    if(['completed','failed','cancelled'].includes(terminal.status))break
  }
  batchClientMs=performance.now()-began
  if(!terminal || !['completed','failed','cancelled'].includes(terminal.status))throw new Error('batch did not become terminal within 60 minutes')
  let cursor
  do {
    const page=await call('get_batch_items',{id:taskId,limit:50,...(cursor?{cursor}:{})})
    pages.push(...(page.items??[]))
    cursor=page.nextCursor??undefined
  }while(cursor)
  details=await service.engine.getCrawlWithSteps(taskId)
}catch(error){failure=String(error)}
finally{
  if(taskId && details===null)details=await service.engine.getCrawlWithSteps(taskId).catch(()=>null)
  await client.close().catch(()=>{})
  await service.close()
}

const stepsByUrl=new Map((details?.steps??[]).map(step=>[step.url,step]))
const pagesByUrl=new Map(pages.map(page=>[page.url,page]))
const records=manifest.urls.map((url,index)=>{
  const asin=url.match(/\/dp\/([A-Z0-9]{10})/)?.[1]??null
  const page=pagesByUrl.get(url)
  const step=stepsByUrl.get(url)
  const result=step?.result
  return {round:1,index:index+1,asin,url,finalUrl:result?.finalUrl??null,clientMs:page?.usage?.wallMs??null,responseBytes:null,
    discovery:false,comparable:true,comparisonStatus:page?.status==='success'?'same-region-candidate':'capture_failed',
    region:page?.json?.data?.deliveryLocation?.startsWith('Singapore')?'Singapore':null,
    locationText:page?.json?.data?.deliveryLocation??null,currency:page?.json?.data?.currency??null,finalHost:result?.finalUrl?new URL(result.finalUrl).hostname:null,
    outcome:{status:page?.status??'missing',lane:page?.lane??null,failureReason:page?.failureReason??null,blockReason:page?.blockReason??null},
    snapshot:{capturedAt:step?.updatedAt??null,rawBodySha256:result?.snapshot?.rawBodySha256??null,artifacts:result?.snapshot?.artifacts??[],httpStatus:result?.snapshot?.httpStatus??null},
    usage:page?.usage??null,structured:page?.json??null}
})
const times=records.map(item=>item.usage?.wallMs).filter(value=>typeof value==='number')
const report={kind:'dual-flow-final-path-local-diagnostic',startedAt,endedAt:new Date().toISOString(),source,taskId,
  terminalStatus:terminal?.status??null,batchClientMs,paginationItems:pages.length,uniquePaginationItems:pagesByUrl.size,stepItems:stepsByUrl.size,
  summary:{requestSuccesses:records.filter(item=>item.outcome.status==='success').length,structuredComplete:records.filter(item=>item.structured?.status==='complete').length,
    requestedAsinMatch:records.filter(item=>item.structured?.data?.asin===item.asin).length,
    singaporeLocation:records.filter(item=>item.locationText?.includes('Singapore 238823')).length,
    visibleQuoteSgd:records.filter(item=>item.structured?.data?.price!==null&&item.structured?.data?.price!==undefined).every(item=>item.currency==='SGD'),
    statusRetryCount:records.reduce((sum,item)=>sum+(item.usage?.statusRetryCount??0),0),navigationFollowupCount:records.reduce((sum,item)=>sum+(item.usage?.navigationFollowupCount??0),0),
    pageTotalMs:{p50:percentile(times,.5),p95:percentile(times,.95),max:times.length?Math.max(...times):null},
    externalCostUsd:null,externalCostStatus:'unknown',failure},records}
const reportPath=resolve(outputDir,'report.json')
await writeFile(reportPath,JSON.stringify(report,null,2))
console.log(JSON.stringify({reportPath,taskId,terminalStatus:report.terminalStatus,batchClientMs,paginationItems:pages.length,summary:report.summary},null,2))
if(failure||terminal?.status!=='completed'||pages.length!==100||pagesByUrl.size!==100||report.summary.structuredComplete!==100||report.summary.requestedAsinMatch!==100)process.exitCode=1
