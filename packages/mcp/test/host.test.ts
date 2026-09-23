import { afterEach, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHostedService } from '../src/host.js'

let close: (()=>Promise<void>) | undefined
let root: string | undefined
afterEach(async()=>{await close?.();close=undefined;if(root) await rm(root,{recursive:true,force:true});root=undefined})

it('speaks real Streamable HTTP and enforces origin, bearer subject and scope',async()=>{
  const probe=createServer()
  probe.listen(0,'127.0.0.1');await once(probe,'listening')
  const port=(probe.address() as AddressInfo).port
  await new Promise<void>(resolve=>probe.close(()=>resolve()))
  root=await mkdtemp(join(tmpdir(),'w2l-hosted-mcp-'))
  const amazonPublicState=JSON.stringify({cookies:[{name:'i18n-prefs',value:'SGD',domain:'.amazon.sg',path:'/',expires:-1,httpOnly:false,secure:true,sameSite:'Lax'}],origins:[]})
  const service=createHostedService({mcpUrl:`https://127.0.0.1:${port}/mcp`,issuer:'https://auth.example',ownerSubject:'user-howard',receiverUrl:'https://receiver.example/webhook',amazonPublicState,taskRoot:root,port,host:'127.0.0.1',verifyToken:async token=>({sub:token==='other' ? 'user-other' : 'user-howard',scope:token==='no-scope' ? 'profile' : 'openid profile'})})
  close=service.close
  if (!service.server.listening) await once(service.server,'listening')
  const url=`http://127.0.0.1:${port}`
  expect((await fetch(`${url}/healthz`)).status).toBe(200)
  const metadata=await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json()
  expect(metadata).toMatchObject({resource:`https://127.0.0.1:${port}/mcp`,authorization_servers:['https://auth.example']})
  const anonymous=await fetch(`${url}/mcp`,{method:'GET'})
  expect(anonymous.status).toBe(401)
  expect(anonymous.headers.get('www-authenticate')).toContain('resource_metadata=')
  expect((await fetch(`${url}/mcp`,{method:'GET',headers:{authorization:'Bearer valid',origin:'https://evil.example'}})).status).toBe(403)
  expect((await fetch(`${url}/mcp`,{method:'GET',headers:{authorization:'Bearer other'}})).status).toBe(403)
  expect((await fetch(`${url}/mcp`,{method:'GET',headers:{authorization:'Bearer no-scope'}})).status).toBe(403)
  expect((await fetch(`${url}/mcp`,{method:'GET',headers:{authorization:'Bearer valid'}})).status).toBe(405)
  expect((await fetch(`${url}/mcp`,{method:'GET',headers:{authorization:'Bearer valid','mcp-protocol-version':'not-a-version'}})).status).toBe(400)
  const transport=new StreamableHTTPClientTransport(new URL(`${url}/mcp`),{requestInit:{headers:{authorization:'Bearer valid'}}})
  const client=new Client({name:'w2l-test-client',version:'1.0.0'})
  try {
    await client.connect(transport)
    const tools=await client.listTools()
    expect(tools.tools.map(tool=>tool.name)).toContain('create_monitor')
    expect(tools.tools.map(tool=>tool.name)).toContain('scrape')
    expect(tools.tools.map(tool=>tool.name)).toContain('batch_scrape')
    expect(tools.tools.map(tool=>tool.name)).toContain('scrape_product')
    expect(tools.tools.map(tool=>tool.name)).toContain('batch_products')
    expect(tools.tools.map(tool=>tool.name)).not.toContain('crawl')
    const result=await client.callTool({name:'list_monitors',arguments:{}})
    expect(result.content).toMatchObject([{type:'text',text:'[]'}])
    await expect(client.callTool({name:'preview_monitor',arguments:{url:'https://elsewhere.example'}})).rejects.toThrow('allowlist')
    await expect(client.callTool({name:'scrape',arguments:{url:'https://127.0.0.1/dp/B000VW9PIK'}})).rejects.toThrow('Amazon.sg')
    await expect(client.callTool({name:'batch_scrape',arguments:{urls:['https://www.amazon.com/dp/B000VW9PIK']}})).rejects.toThrow('Amazon.sg')
    await expect(client.callTool({name:'create_delivery_destination',arguments:{monitorId:'firecrawl-introduction',url:'https://elsewhere.example/webhook'}})).rejects.toThrow('remote pilot only supports')
  } finally {await client.close()}
})
