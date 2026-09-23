import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { W2L } from '@w2l/sdk'
import { callTool, TOOLS } from './tools.js'

export interface McpServerOptions {
  allowedTools?: ReadonlySet<string>
  authorizeCall?: (name: string, args: unknown) => void
}

export function createMcpServer(client: W2L, options: McpServerOptions = {}): Server {
  const server = new Server({ name: 'w2l', version: '0.3.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.filter(tool => options.allowedTools === undefined || options.allowedTools.has(tool.name)) }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (options.allowedTools && !options.allowedTools.has(request.params.name)) throw new Error('tool not available in this deployment')
    options.authorizeCall?.(request.params.name,request.params.arguments ?? {})
    const result = await callTool(client, request.params.name, request.params.arguments ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })
  return server
}
