/** Public HTTPS acceptance: our signed receiver, real public document, lost ACK and process restart. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createApiEngine } from '../../packages/api/src/engine.js'
import { DeliveryStore, DeliveryWorker, createHttpsWebhookTransport } from '../../packages/runtime/src/index.js'
const root = resolve(process.env.W2L_GATE3_ROOT ?? `.w2l/gate3-https-${Date.now()}`)
const deliveryProxyUrl = process.env.W2L_DELIVERY_PROXY_URL
await mkdir(root,{recursive:true})
const secret = randomBytes(32).toString('hex')
const children = new Set<ChildProcess>()
const logs: Record<string,string> = {}
const sleep = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
function launch(label:string, command:string, args:string[], env:NodeJS.ProcessEnv = process.env) {
  const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});children.add(child);logs[label]=''
  child.stdout!.on('data',chunk=>{logs[label]+=String(chunk)})
  child.stderr!.on('data',chunk=>{logs[label]+=String(chunk)})
  return child
}
async function waitFor(label:string, predicate:(log:string)=>string|undefined, timeoutMs=60_000):Promise<string> {
  const deadline=Date.now()+timeoutMs
  while(Date.now()<deadline){const result=predicate(logs[label]??'');if(result)return result;await sleep(100)}
  throw new Error(`Timed out waiting for ${label}: ${(logs[label]??'').slice(-1500)}`)
}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'close');child.kill('SIGTERM');await Promise.race([exited,sleep(3000).then(()=>child.kill('SIGKILL'))]);children.delete(child)}
let engine:ReturnType<typeof createApiEngine>|undefined
let store:DeliveryStore|undefined
try {
  const env={...process.env,WEBHOOK_SECRET:secret,WEBHOOK_PORT:'0',WEBHOOK_DB:join(root,'receiver.sqlite')}
  let receiver=launch('receiver',process.execPath,['--import','tsx','examples/webhook-receiver.ts'],env)
  const local=await waitFor('receiver',log=>/"receiver":"(http:\/\/127\.0\.0\.1:\d+\/webhook)"/.exec(log)?.[1],15_000)
  const localUrl=new URL(local)
  const tunnel=launch('tunnel',process.env.CLOUDFLARED_BIN??'cloudflared',['tunnel','--no-autoupdate','--protocol','http2','--url',localUrl.origin])
  const origin=await waitFor('tunnel',log=>/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0])
  console.log(JSON.stringify({stage:'https-endpoint',origin}))
  let healthy=false
  const healthAttempts: unknown[] = []
  for(let i=0;i<65;i++){
    try{const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(4000)});if(response.ok){healthy=true;break};healthAttempts.push({status:response.status,body:(await response.text()).slice(0,180)})}catch(error){healthAttempts.push({error:String(error),cause:String((error as Error & {cause?:Error}).cause)});if(i===0)console.log(JSON.stringify({stage:'health-retry',failure:healthAttempts.at(-1)}))}
    await sleep(1000)
  }
  assert.ok(healthy,'public HTTPS receiver health: '+JSON.stringify(healthAttempts.slice(-3)))
  engine=createApiEngine({taskRoot:root})
  engine.configureMonitor({monitorId:'firecrawl-live-https',revision:1,url:'https://docs.firecrawl.dev/introduction',ruleVersion:'firecrawl-delivery/v1',intervalMs:86_400_000,staleAfterMs:172_800_000,createdAt:Date.now(),config:{adapter:'markdown-sections/v1',workspaceId:'acceptance',entityKey:'firecrawl:introduction',viewKey:'public',expectedTitle:'Introduction',schemaVersion:'firecrawl-delivery/v1',captureMode:'http',conditionalRequests:false,fields:[{name:'introduction',heading:'Introduction',type:'text',required:true}]}})
  engine.createDeliveryDestination({id:'controlled-https',monitorId:'firecrawl-live-https',url:origin+'/webhook',secretEnv:'W2L_WEBHOOK_SECRET_ACCEPTANCE'})
  const view=await engine.runMonitor('firecrawl-live-https','https-initialization')
  assert.equal(view.runs[0]?.quality,'valid',JSON.stringify(view.runs[0]))
  assert.equal(view.events.length,1)
  const eventId=view.events[0]!.id
  store=DeliveryStore.open(join(root,'section-b-control.sqlite'))
  const wire=createHttpsWebhookTransport(undefined,undefined,deliveryProxyUrl)
  const firstWorker=new DeliveryWorker(store,{retryBaseMs:50,secrets:{W2L_WEBHOOK_SECRET_ACCEPTANCE:secret},transport:async input=>{
    const response=await wire(input)
    if(response.status>=200&&response.status<300)throw new Error('injected ACK loss after actual HTTPS acceptance')
    return response
  }})
  await firstWorker.processOne()
  const pending=store.listDeliveries()[0]!
  assert.equal(pending.state,'pending',JSON.stringify(pending))
  const status=async()=>{const response=await fetch(origin+'/status',{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10_000)});assert.equal(response.status,200);return await response.json() as {receipts:unknown[];projections:{eventId:string}[]}}
  const before=await status();assert.equal(before.receipts.length,1);assert.equal(before.projections[0]?.eventId,eventId)
  store.close();store=undefined
  await engine.close();engine=undefined
  await stop(receiver)
  receiver=launch('receiver-restarted',process.execPath,['--import','tsx','examples/webhook-receiver.ts'],{...env,WEBHOOK_PORT:localUrl.port})
  await waitFor('receiver-restarted',log=>log.includes('"receiver"')?'ready':undefined,15_000)
  await sleep(Math.max(0,pending.nextAttemptAt-Date.now()+30))
  const worker=launch('worker-restarted',process.execPath,['--import','tsx','scripts/section-b/delivery-worker.ts','--once'],{...process.env,W2L_TASK_ROOT:root,W2L_WEBHOOK_SECRET_ACCEPTANCE:secret})
  const [code]=await once(worker,'close');children.delete(worker);assert.equal(code,0,logs['worker-restarted'])
  store=DeliveryStore.open(join(root,'section-b-control.sqlite'))
  const delivered=store.getDelivery(pending.id)!,after=await status()
  assert.equal(delivered.state,'delivered',JSON.stringify(delivered))
  assert.equal(delivered.eventId,eventId)
  assert.equal(delivered.attemptCount,2)
  assert.equal(after.receipts.length,1)
  assert.equal(after.projections.length,1)
  assert.equal(after.projections[0]!.eventId,eventId)
  const evidence={generatedAt:new Date().toISOString(),passed:true,root,sourceUrl:view.revision.url,httpsEndpoint:origin+'/webhook',endpointLifetime:'temporary acceptance tunnel, stopped after test',realPublicSource:true,baselineVersion:view.baseline!.version,eventId,deliveryId:delivered.id,attempts:store.attempts(delivered.id),receiverRestarted:true,senderWorkerNewProcess:true,receiverReceipts:after.receipts.length,downstreamProjections:after.projections.length,duplicateBusinessUpdates:0,signature:'HMAC-SHA256; ephemeral secret not persisted',tls:'public certificate verified; no insecure override',deliveryTransport:deliveryProxyUrl?'explicit operator CONNECT proxy to validated target IP; original hostname TLS verification':'direct pinned HTTPS'}
  const output=resolve('research/gate3-https-delivery.generated.json')
  await writeFile(output,JSON.stringify(evidence,null,2)+'\n')
  console.log(JSON.stringify({passed:true,eventId,attempts:delivered.attemptCount,receiverReceipts:after.receipts.length,output,root}))
  await stop(tunnel)
} finally {
  store?.close();await engine?.close({cancelActive:true})
  for(const child of children)await stop(child)
  for(const [label,log]of Object.entries(logs))await writeFile(join(root,`${label}.log`),log.replaceAll(secret,'[redacted]'))
}
