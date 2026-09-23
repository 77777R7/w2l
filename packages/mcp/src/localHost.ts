import { createServer, type Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import { localNetworkPolicy, type NetworkPolicy } from '@w2l/contracts'
import { createManagedRuntime } from './managedRuntime.js'
import { createMcpServer } from './server.js'

export interface LocalConfig {
  taskRoot: string
  port: number
  monitorPollMs?: number
  deliveryPollMs?: number
  networkPolicy?: NetworkPolicy
}

export function localConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  const port = Number(env.W2L_LOCAL_MCP_PORT ?? 8791)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('W2L_LOCAL_MCP_PORT must be 1..65535')
  const monitorPollMs=Number(env.W2L_LOCAL_MONITOR_POLL_MS ?? 1000)
  const deliveryPollMs=Number(env.W2L_LOCAL_DELIVERY_POLL_MS ?? 500)
  if (!Number.isSafeInteger(monitorPollMs) || monitorPollMs<10 || monitorPollMs>300_000) throw new Error('W2L_LOCAL_MONITOR_POLL_MS must be 10..300000')
  if (!Number.isSafeInteger(deliveryPollMs) || deliveryPollMs<10 || deliveryPollMs>300_000) throw new Error('W2L_LOCAL_DELIVERY_POLL_MS must be 10..300000')
  return {taskRoot:resolve(env.W2L_TASK_ROOT ?? '.w2l/api'),port,monitorPollMs,deliveryPollMs}
}

/** Single-user local service. It never binds a public interface or exposes REST. */
export function createLocalService(config: LocalConfig): {server: HttpServer; close: () => Promise<void>} {
  if (!Number.isSafeInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('port must be 0..65535')
  const runtime=createManagedRuntime({taskRoot:config.taskRoot,networkPolicy:config.networkPolicy ?? localNetworkPolicy(),monitorPollMs:config.monitorPollMs,deliveryPollMs:config.deliveryPollMs})
  let closing:Promise<void>|null=null
  const sendJson=(res:import('node:http').ServerResponse,status:number,body:unknown)=>{
    res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(body))
  }
  const server=createServer(async(req,res)=>{
    try {
      const address=server.address()
      const port=typeof address==='object' && address ? address.port : config.port
      const origin=`http://127.0.0.1:${port}`
      const pathname=new URL(req.url ?? '/',origin).pathname
      // Host and Origin checks prevent DNS rebinding and browser-origin access.
      if (req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin)) {sendJson(res,403,{error:'invalid local origin'});return}
      if (pathname==='/healthz' && req.method==='GET') {
        const health=runtime.health()
        try {runtime.engine.listMonitors()} catch {sendJson(res,503,{ok:false});return}
        sendJson(res,health.ok?200:503,health);return
      }
      if (pathname!=='/mcp') {sendJson(res,404,{error:'not found'});return}
      if (req.method==='GET' || req.method==='DELETE') {sendJson(res,405,{error:'stream and session management unavailable'});return}
      if (req.method!=='POST') {sendJson(res,405,{error:'method not allowed'});return}
      const version=req.headers['mcp-protocol-version']
      if (version && (typeof version!=='string' || !SUPPORTED_PROTOCOL_VERSIONS.includes(version))) {sendJson(res,400,{error:'unsupported MCP protocol version'});return}
      const size=Number(req.headers['content-length'] ?? 0)
      if (size>262_144) {sendJson(res,413,{error:'request too large'});return}
      const chunks:Buffer[]=[]
      let bodyBytes=0
      for await (const chunk of req) {
        const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)
        bodyBytes+=bytes.byteLength
        if (bodyBytes>262_144) {sendJson(res,413,{error:'request too large'});return}
        chunks.push(bytes)
      }
      let body:unknown
      try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
      catch {sendJson(res,400,{error:'invalid JSON'});return}
      const mcp=createMcpServer(runtime.client)
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
      try {await mcp.connect(transport);await transport.handleRequest(req,res,body)}
      finally {await mcp.close()}
    } catch(error) {
      if (!res.headersSent) sendJson(res,500,{error:error instanceof Error?error.message:'internal error'})
      else res.end()
    }
  })
  server.requestTimeout=120_000
  server.listen(config.port,'127.0.0.1')
  return {server,close:()=>{
    if(closing)return closing
    closing=(async()=>{
      await new Promise<void>(done=>server.close(()=>done()))
      await runtime.close()
    })()
    return closing
  }}
}
