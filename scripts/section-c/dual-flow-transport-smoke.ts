/** Local transport diagnostic for the hosted code path. It exercises the
 * official MCP client and real W2L capture, but injects a test token verifier;
 * it is never evidence of WorkOS login or Render egress. */
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHostedService } from '../../packages/mcp/src/host.js'

const stateFile=process.env.W2L_AMAZON_PUBLIC_STATE_FILE
if (!stateFile) throw new Error('W2L_AMAZON_PUBLIC_STATE_FILE is required')
const probe=createServer()
probe.listen(0,'127.0.0.1');await once(probe,'listening')
const port=(probe.address() as AddressInfo).port
await new Promise<void>(resolve=>probe.close(()=>resolve()))
const root=await mkdtemp(join(tmpdir(),'w2l-dual-flow-'))
const service=createHostedService({mcpUrl:`https://127.0.0.1:${port}/mcp`,issuer:'https://auth.example',ownerSubject:'diagnostic-owner',receiverUrl:'https://receiver.example/webhook',amazonPublicState:readFileSync(stateFile,'utf8'),taskRoot:root,port,host:'127.0.0.1',verifyToken:async()=>({sub:'diagnostic-owner',scope:'openid'})})
if (!service.server.listening) await once(service.server,'listening')
const client=new Client({name:'w2l-dual-flow-smoke',version:'1.0.0'})
const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{authorization:'Bearer diagnostic'}}})
const call=async(name:string,args:Record<string,unknown>)=>{
  const started=performance.now()
  const result=await client.callTool({name,arguments:args})
  const content=result.content?.find(item=>item.type==='text')
  if (!content || content.type!=='text') throw new Error(`${name} returned no text`)
  return {data:JSON.parse(content.text) as Record<string,unknown>,clientMs:performance.now()-started}
}
try {
  await client.connect(transport)
  const tools=await client.listTools()
  const names=tools.tools.map(tool=>tool.name)
  if (!['preview_monitor','scrape_product','batch_products','get_batch_items'].every(name=>names.includes(name))) throw new Error('dual-flow tool list is incomplete')
  const preview=await call('preview_monitor',{preset:'firecrawl-introduction'})
  const scrape=await call('scrape_product',{url:'https://www.amazon.sg/dp/B000VW9PIK'})
  const json=scrape.data.json as Record<string,unknown> | undefined
  const product=json?.data as Record<string,unknown> | undefined
  const batchStarted=performance.now()
  const batch=await call('batch_products',{urls:['https://www.amazon.sg/dp/B000VW9PIK','https://www.amazon.sg/dp/B0CFV1W66Y']})
  const taskId=batch.data.taskId
  if (typeof taskId!=='string') throw new Error('batch did not return taskId')
  let status:Record<string,unknown>={}
  for (let i=0;i<20;i++) {
    status=(await call('wait_batch',{id:taskId,timeoutMs:10_000})).data
    if (['completed','failed','cancelled'].includes(String(status.status))) break
  }
  const items=await call('get_batch_items',{id:taskId,limit:10})
  const batchWallMs=performance.now()-batchStarted
  const batchItems=((items.data.items ?? []) as Array<Record<string,unknown>>).map(item=>{
    const result=item.json as Record<string,unknown> | undefined
    const data=result?.data as Record<string,unknown> | undefined
    const usage=item.usage as Record<string,unknown> | undefined
    return {url:item.url,status:item.status,structuredStatus:result?.status,asin:data?.asin,deliveryLocation:data?.deliveryLocation,currency:data?.currency,
      failureReason:item.failureReason,blockReason:item.blockReason,totalMs:usage?.wallMs,attemptCount:usage?.attemptCount,statusRetryCount:usage?.statusRetryCount,navigationFollowupCount:usage?.navigationFollowupCount}
  })
  console.log(JSON.stringify({kind:'local-hosted-transport-diagnostic',tools:names.length,
    preview:{status:preview.data.status,assessment:(preview.data.assessment as Record<string,unknown>)?.quality,clientMs:preview.clientMs},
    scrape:{status:scrape.data.status,lane:scrape.data.lane,structuredStatus:json?.status,asin:product?.asin,deliveryLocation:product?.deliveryLocation,currency:product?.currency,clientMs:scrape.clientMs,usage:scrape.data.usage},
    batch:{taskId,status:status.status,requested:status.requested,completed:status.completed,batchWallMs,items:batchItems,clientMs:batch.clientMs},
    workosVerified:false,renderVerified:false},null,2))
} finally {
  await client.close().catch(()=>{})
  await service.close()
  await rm(root,{recursive:true,force:true})
}
