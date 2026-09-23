import { afterEach, expect, it } from 'vitest'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLocalService } from '../src/localHost.js'

let close:(()=>Promise<void>)|undefined
let root:string|undefined
afterEach(async()=>{await close?.();close=undefined;if(root)await rm(root,{recursive:true,force:true});root=undefined})

it('serves all tools on loopback and preserves Monitor state across MCP connections',async()=>{
  const probe=createServer()
  probe.listen(0,'127.0.0.1');await once(probe,'listening')
  const port=(probe.address() as AddressInfo).port
  await new Promise<void>(done=>probe.close(()=>done()))
  root=await mkdtemp(join(tmpdir(),'w2l-local-host-'))
  const service=createLocalService({taskRoot:root,port})
  close=service.close
  if(!service.server.listening)await once(service.server,'listening')
  const base=`http://127.0.0.1:${port}`
  expect((await fetch(`${base}/healthz`)).status).toBe(200)
  expect((await fetch(`${base}/mcp`,{method:'GET'})).status).toBe(405)
  expect((await fetch(`${base}/healthz`,{headers:{origin:'https://evil.example'}})).status).toBe(403)
  const wrongHost=await new Promise<number>((done,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path:'/healthz',headers:{host:'evil.example'}},res=>{res.resume();done(res.statusCode??0)})
    req.once('error',reject);req.end()
  })
  expect(wrongHost).toBe(403)
  const connect=async()=>{
    const client=new Client({name:'w2l-local-test',version:'1.0.0'})
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))
    return client
  }
  const first=await connect()
  try {
    const tools=await first.listTools()
    expect(tools.tools.map(tool=>tool.name)).toContain('scrape')
    expect(tools.tools.map(tool=>tool.name)).toContain('create_monitor')
    expect(tools.tools.map(tool=>tool.name)).toContain('list_deliveries')
    const created=await first.callTool({name:'create_monitor',arguments:{preset:'firecrawl-introduction'}})
    expect(created.isError).not.toBe(true)
  } finally {await first.close()}
  const second=await connect()
  try {
    const view=await second.callTool({name:'get_monitor',arguments:{id:'firecrawl-introduction'}})
    const item=view.content?.find(entry=>entry.type==='text')
    expect(item?.type).toBe('text')
    if(item?.type==='text')expect(JSON.parse(item.text)).toMatchObject({enabled:false})
  } finally {await second.close()}
})
