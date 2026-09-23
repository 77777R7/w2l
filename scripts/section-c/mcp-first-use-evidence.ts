/** Real public-doc capture and independent HTTPS delivery through the MCP HTTP protocol. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const root=resolve(process.env.W2L_C2_EVIDENCE_ROOT ?? `.w2l/c2-first-use-${Date.now()}`)
await mkdir(root,{recursive:true})
const secret=randomBytes(32).toString('hex')
const oldSecret=process.env.W2L_WEBHOOK_SECRET_DEMO
process.env.W2L_WEBHOOK_SECRET_DEMO=secret
const children=new Set<ChildProcess>()
const logs=new Map<ChildProcess,string>()
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
function spawnLogged(command:string,args:string[],env:NodeJS.ProcessEnv=process.env):ChildProcess {
  const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});children.add(child);logs.set(child,'')
  for(const output of [child.stdout,child.stderr]) output?.on('data',chunk=>logs.set(child,(logs.get(child)??'')+String(chunk)))
  return child
}
async function waitFor<T>(read:()=>Promise<T|null>|T|null,timeoutMs=60_000):Promise<T> {
  const until=Date.now()+timeoutMs
  while(Date.now()<until){const found=await read();if(found!==null)return found;await sleep(200)}
  throw new Error('timed out waiting for first-use step')
}
async function stop(child:ChildProcess):Promise<void> {
  if(child.exitCode!==null || child.signalCode!==null)return
  const ended=once(child,'close');child.kill('SIGTERM');await Promise.race([ended,sleep(4000).then(()=>child.kill('SIGKILL'))]);children.delete(child)
}
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening')
const port=(probe.address() as AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()))
let service:ChildProcess|undefined
let client:Client|undefined
async function connect(receiverUrl:string,pollMs:number):Promise<void> {
  service=spawnLogged(process.execPath,['--import','tsx','scripts/section-c/host-process.ts'],{...process.env,W2L_C2_ROOT:root,W2L_C2_RECEIVER_URL:receiverUrl,W2L_C2_PORT:String(port),W2L_C2_POLL_MS:String(pollMs)})
  await waitFor(()=>logs.get(service!)?.includes('"host":"ready"') ? true : null,15_000)
  const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{authorization:'Bearer local-test-token'}}})
  client=new Client({name:'w2l-first-use-evidence',version:'1.0.0'})
  await client.connect(transport)
}
async function disconnect(crash=false):Promise<void> {
  await client?.close();client=undefined
  if(service) {
    if(crash) {const ended=once(service,'close');service.kill('SIGKILL');await ended;children.delete(service)}
    else await stop(service)
    service=undefined
  }
}
async function call<T>(name:string,args:Record<string,unknown>={}):Promise<T> {
  const response=await client!.callTool({name,arguments:args})
  const item=response.content?.find(entry=>entry.type==='text')
  if(item?.type!=='text')throw new Error(`no text result for ${name}`)
  if(response.isError)throw new Error(`${name}: ${item.text}`)
  return JSON.parse(item.text) as T
}

try {
  const receiver=spawnLogged(process.execPath,['--import','tsx','examples/webhook-receiver.ts'],{...process.env,WEBHOOK_SECRET:secret,WEBHOOK_DB:join(root,'receiver.sqlite'),WEBHOOK_PORT:'0'})
  const local=await waitFor(()=>/"receiver":"(http:\/\/127\.0\.0\.1:\d+\/webhook)"/.exec(logs.get(receiver)??'')?.[1]??null,15_000)
  const tunnel=spawnLogged(process.env.CLOUDFLARED_BIN??'cloudflared',['tunnel','--no-autoupdate','--protocol','http2','--url',new URL(local).origin])
  const origin=await waitFor(()=>/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(logs.get(tunnel)??'')?.[0]??null)
  await waitFor(async()=>{try{return (await fetch(`${origin}/health`,{signal:AbortSignal.timeout(4000)})).ok ? true : null}catch{return null}},70_000)
  const receiverUrl=`${origin}/webhook`
  await connect(receiverUrl,200)
  const sample=await call<{assessment:{quality:string;reasons:string[];evidence:unknown[]}}> ('preview_monitor',{preset:'firecrawl-introduction'})
  assert.equal(sample.assessment.quality,'valid',JSON.stringify(sample.assessment.reasons))
  assert.ok(sample.assessment.evidence.length>0)
  await call('create_monitor',{preset:'firecrawl-introduction'})
  const paused=await call<{enabled:boolean}>('get_monitor',{id:'firecrawl-introduction'})
  assert.equal(paused.enabled,false)
  await call('create_delivery_destination',{id:'c2-https-receiver',monitorId:'firecrawl-introduction',url:receiverUrl,secretEnv:'W2L_WEBHOOK_SECRET_DEMO',enabled:false})
  await call('resume_monitor',{id:'firecrawl-introduction'})
  const first=await waitFor(async()=>{const view=await call<{latestRun?:{id:string;state:string;quality:string};latestEvent?:{id:string}|null}>('get_monitor',{id:'firecrawl-introduction'});return view.latestRun?.state==='completed' ? view : null},45_000)
  assert.equal(first.latestRun?.quality,'valid')
  assert.ok(first.latestEvent?.id)
  const pending=await call<{items:{id:string;eventId:string;state:string}[]}>('list_deliveries',{monitorId:'firecrawl-introduction'})
  assert.equal(pending.items[0]?.state,'pending')
  assert.equal(pending.items[0]?.eventId,first.latestEvent!.id)
  await disconnect(true)
  await connect(receiverUrl,200)
  await call('resume_delivery_destination',{id:'c2-https-receiver'})
  const delivered=await waitFor(async()=>{const page=await call<{items:{id:string;eventId:string;state:string}[]}>('list_deliveries',{monitorId:'firecrawl-introduction'});return page.items[0]?.state==='delivered' ? page.items[0] : null},60_000)
  assert.equal(delivered.id,pending.items[0]!.id)
  assert.equal(delivered.eventId,first.latestEvent!.id)
  const receiverStatus=await (await fetch(`${origin}/status`,{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10_000)})).json() as {receipts:{eventId:string}[];projections:{eventId:string}[]}
  assert.equal(receiverStatus.receipts.length,1)
  assert.equal(receiverStatus.projections[0]?.eventId,delivered.eventId)
  await disconnect()
  await connect(receiverUrl,60_000)
  const queued=await call<{runId:string;state:string}>('run_monitor',{id:'firecrawl-introduction',triggerKey:'restart-proof'})
  assert.equal(queued.state,'queued')
  await disconnect(true)
  await connect(receiverUrl,200)
  const recovered=await waitFor(async()=>{const detail=await call<{run:{id:string;state:string;change:string}}> ('get_monitor_run',{id:'firecrawl-introduction',runId:queued.runId});return detail.run.state==='completed' ? detail.run : null},45_000)
  assert.equal(recovered.id,queued.runId)
  assert.equal(recovered.change,'unchanged')
  const view=await call<{latestEvent:{id:string};enabled:boolean}>('get_monitor',{id:'firecrawl-introduction'})
  assert.equal(view.latestEvent.id,delivered.eventId)
  await call('pause_monitor',{id:'firecrawl-introduction'})
  assert.equal((await call<{enabled:boolean}>('get_monitor',{id:'firecrawl-introduction'})).enabled,false)
  const evidence={generatedAt:new Date().toISOString(),passed:true,source:'https://docs.firecrawl.dev/introduction',receiver:receiverUrl,receiverLifetime:'temporary HTTPS tunnel',auth:'local test verifier; production WorkOS OAuth remains untested',mcpTransport:'Streamable HTTP via SDK client',processCrash:'SIGKILL with pending delivery, then SIGKILL with queued Monitor run',sampleQuality:sample.assessment.quality,eventId:delivered.eventId,deliveryId:delivered.id,receiverReceipts:receiverStatus.receipts.length,runIdAfterRestart:recovered.id,runChangeAfterRestart:recovered.change,paused:true}
  await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2)+'\n')
  console.log(JSON.stringify({passed:true,root,eventId:delivered.eventId,runId:recovered.id}))
} finally {
  await disconnect()
  for(const child of children)await stop(child)
  if(oldSecret===undefined)delete process.env.W2L_WEBHOOK_SECRET_DEMO;else process.env.W2L_WEBHOOK_SECRET_DEMO=oldSecret
}
