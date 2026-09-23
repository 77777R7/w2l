import { createServer, type Server as HttpServer } from 'node:http'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import type { ApiEngine } from '@w2l/api'
import { FIRECRAWL_INTRO_URL, hostedNetworkPolicy, type NetworkPolicy } from '@w2l/contracts'
import { createMcpServer } from './server.js'
import { createManagedRuntime } from './managedRuntime.js'

const REMOTE_TOOLS = new Set(['preview_monitor','create_monitor','list_monitors','get_monitor','run_monitor','get_monitor_run','pause_monitor','resume_monitor','cancel_monitor_run','create_delivery_destination','list_delivery_destinations','pause_delivery_destination','resume_delivery_destination','list_deliveries','get_delivery','retry_dead_letter'])

export interface HostedConfig {
  mcpUrl: string
  issuer: string
  ownerSubject: string
  receiverUrl: string
  taskRoot: string
  port: number
  host?: string
  monitorPollMs?: number
  deliveryPollMs?: number
  networkPolicy?: NetworkPolicy
  /** A test seam. Production always verifies WorkOS JWKS signatures. */
  verifyToken?: (token: string) => Promise<JWTPayload>
}

export function hostedConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  for (const key of ['W2L_MCP_URL','WORKOS_ISSUER','W2L_OWNER_SUBJECT','W2L_RECEIVER_URL','W2L_WEBHOOK_SECRET_DEMO']) if (!env[key]) throw new Error(`${key} is required for hosted MCP`)
  const port = Number(env.PORT ?? 8787)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535')
  return {mcpUrl:env.W2L_MCP_URL!,issuer:env.WORKOS_ISSUER!,ownerSubject:env.W2L_OWNER_SUBJECT!,receiverUrl:env.W2L_RECEIVER_URL!,taskRoot:env.W2L_TASK_ROOT ?? '/var/data/w2l',port,host:'0.0.0.0'}
}

export function createHostedService(config: HostedConfig): {server: HttpServer; close: () => Promise<void>; engine: ApiEngine} {
  const mcpUrl = new URL(config.mcpUrl)
  const issuer = new URL(config.issuer)
  const receiverUrl = new URL(config.receiverUrl)
  if (mcpUrl.protocol !== 'https:' || mcpUrl.pathname !== '/mcp' || mcpUrl.search || mcpUrl.hash) throw new Error('mcpUrl must be an HTTPS /mcp URL')
  if (issuer.protocol !== 'https:' || issuer.pathname !== '/' || issuer.search || issuer.hash) throw new Error('issuer must be an HTTPS origin')
  if (receiverUrl.protocol !== 'https:' || receiverUrl.pathname !== '/webhook' || receiverUrl.search || receiverUrl.hash) throw new Error('receiverUrl must be an HTTPS /webhook URL')
  if (!config.ownerSubject.trim()) throw new Error('ownerSubject is required')
  const policy = config.networkPolicy ?? hostedNetworkPolicy()
  const runtime = createManagedRuntime({taskRoot:config.taskRoot,networkPolicy:policy,defaultMaxPages:10,httpOnly:true,monitorPollMs:config.monitorPollMs,deliveryPollMs:config.deliveryPollMs})
  const {engine,client} = runtime
  const jwks = createRemoteJWKSet(new URL('/oauth2/jwks',issuer))
  const verifyToken = config.verifyToken ?? (async (token:string) => (await jwtVerify(token,jwks,{issuer:issuer.origin,audience:config.mcpUrl})).payload)
  let closing: Promise<void> | null = null
  const metadataUrl = `${mcpUrl.origin}/.well-known/oauth-protected-resource`
  const sendJson = (res: import('node:http').ServerResponse,status:number,body:unknown,headers:Record<string,string>={}) => {
    res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}).end(JSON.stringify(body))
  }
  const server = createServer(async (req,res) => {
    try {
      const pathname = new URL(req.url ?? '/',mcpUrl.origin).pathname
      if (req.method === 'GET' && pathname === '/healthz') {
        const health=runtime.health()
        try {engine.listMonitors()} catch {sendJson(res,503,{ok:false});return}
        sendJson(res,health.ok ? 200 : 503,health);return
      }
      if (req.method === 'GET' && pathname === '/.well-known/oauth-protected-resource') {
        sendJson(res,200,{resource:config.mcpUrl,authorization_servers:[issuer.origin],bearer_methods_supported:['header'],scopes_supported:['openid']});return
      }
      if (pathname !== '/mcp') {sendJson(res,404,{error:'not found'});return}
      if (req.headers.host !== mcpUrl.host) {sendJson(res,403,{error:'invalid host'});return}
      if (req.headers.origin && req.headers.origin !== mcpUrl.origin) {sendJson(res,403,{error:'invalid origin'});return}
      if (!['POST','GET','DELETE'].includes(req.method ?? '')) {sendJson(res,405,{error:'method not allowed'});return}
      const version=req.headers['mcp-protocol-version']
      if (version && (typeof version !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.includes(version))) {sendJson(res,400,{error:'unsupported MCP protocol version'});return}
      const header = req.headers.authorization ?? ''
      const token = /^Bearer (\S+)$/.exec(header)?.[1]
      const challenge = `Bearer resource_metadata="${metadataUrl}", scope="openid"`
      if (!token) {sendJson(res,401,{error:'unauthorized'},{'www-authenticate':challenge});return}
      let payload: JWTPayload
      try { payload = await verifyToken(token) }
      catch {sendJson(res,401,{error:'invalid token'},{'www-authenticate':challenge});return}
      if (payload.sub !== config.ownerSubject || typeof payload.scope !== 'string' || !payload.scope.split(/\s+/).includes('openid')) {sendJson(res,403,{error:'forbidden'});return}
      if (req.method === 'GET' || req.method === 'DELETE') {sendJson(res,405,{error:'stream and session management unavailable'});return}
      const size = Number(req.headers['content-length'] ?? 0)
      if (size > 262_144) {sendJson(res,413,{error:'request too large'});return}
      const chunks: Buffer[] = []
      let bodyBytes = 0
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bodyBytes += bytes.byteLength
        if (bodyBytes > 262_144) {sendJson(res,413,{error:'request too large'});return}
        chunks.push(bytes)
      }
      let parsedBody: unknown
      try {parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))}
      catch {sendJson(res,400,{error:'invalid JSON'});return}
      const mcp = createMcpServer(client,{allowedTools:REMOTE_TOOLS,authorizeCall:(name,args) => {
        const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string,unknown> : {}
        if (name === 'preview_monitor' || name === 'create_monitor') {
          if (input.preset !== 'firecrawl-introduction' || Object.keys(input).some(key=>!['preset','enabled'].includes(key))) throw new Error(`remote pilot only supports ${FIRECRAWL_INTRO_URL}`)
        }
        if (name === 'create_delivery_destination' && (input.url !== config.receiverUrl || input.secretEnv !== 'W2L_WEBHOOK_SECRET_DEMO')) throw new Error('remote pilot only supports the controlled HTTPS receiver and configured secret reference')
      }})
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
      try {await mcp.connect(transport);await transport.handleRequest(req,res,parsedBody)}
      finally {await mcp.close()}
    } catch (error) {
      if (!res.headersSent) sendJson(res,500,{error:error instanceof Error ? error.message : 'internal error'})
      else res.end()
    }
  })
  server.requestTimeout = 120_000
  server.listen(config.port,config.host ?? '127.0.0.1')
  return {server,engine,close:()=>{
    if (closing) return closing
    closing=(async()=>{
      await new Promise<void>(resolve=>server.close(()=>resolve()))
      await runtime.close()
    })()
    return closing
  }}
}
