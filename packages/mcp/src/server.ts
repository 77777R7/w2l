import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { W2L } from '@w2l/sdk'
import { callTool, TOOLS } from './tools.js'

export function createMcpServer(client: W2L): Server {
  const server = new Server({ name: 'w2l', version: '0.3.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(client, request.params.name, request.params.arguments ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })
  return server
}
