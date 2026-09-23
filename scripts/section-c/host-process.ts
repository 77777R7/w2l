/** Test-only child process for the real crash/restart evidence. Never deployed. */
import { once } from 'node:events'
import { createHostedService } from '../../packages/mcp/src/host.js'

const root=process.env.W2L_C2_ROOT
const receiverUrl=process.env.W2L_C2_RECEIVER_URL
const port=Number(process.env.W2L_C2_PORT)
const pollMs=Number(process.env.W2L_C2_POLL_MS)
if (!root || !receiverUrl || !Number.isSafeInteger(port) || !Number.isSafeInteger(pollMs)) throw new Error('missing C2 process fixture configuration')
const service=createHostedService({mcpUrl:`https://127.0.0.1:${port}/mcp`,issuer:'https://auth.example',ownerSubject:'local-test-user',receiverUrl,taskRoot:root,port,host:'127.0.0.1',monitorPollMs:pollMs,verifyToken:async token=>{
  if(token!=='local-test-token') throw new Error('invalid local test token')
  return {sub:'local-test-user',scope:'openid profile'}
}})
if(!service.server.listening)await once(service.server,'listening')
console.log(JSON.stringify({host:'ready',port}))
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{void service.close().catch(error=>{console.error(error);process.exitCode=1})})
