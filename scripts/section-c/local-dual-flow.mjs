#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

if(process.platform!=='darwin')throw new Error('managed local first use currently requires macOS; use npm run local:mcp elsewhere')
const root=resolve('.')
const plist=join(homedir(),'Library/LaunchAgents/dev.w2l.local-mcp.plist')
if(existsSync(plist) && !readFileSync(plist,'utf8').includes(`${root}/packages/mcp/dist/localHostCli.js`)) {
  throw new Error(`another checkout owns ${plist}; run this entry from that checkout or stop its service first`)
}
const receiverPlist=join(homedir(),'Library/LaunchAgents/dev.w2l.local-receiver.plist')
if(existsSync(receiverPlist) && !readFileSync(receiverPlist,'utf8').includes(`${root}/scripts/section-c/local-receiver-cli.mjs`)) {
  throw new Error(`another checkout owns ${receiverPlist}; run this entry from that checkout or stop its receiver first`)
}
try {
  const current=execFileSync('codex',['mcp','get','w2l-local'],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
  if(!current.includes('http://127.0.0.1:8791/mcp'))throw new Error('existing w2l-local MCP points to a different URL')
} catch(error) {
  if(error instanceof Error && error.message.includes('different URL'))throw error
}
const stateFile=resolve('.w2l/amazon-sg-public-state.json')
const run=(binary,args,env=process.env)=>execFileSync(binary,args,{stdio:'inherit',env})
run('npm',['run','typecheck'])
run('npx',['playwright','install','chromium'])
run(process.execPath,['scripts/section-c/ensure-amazon-sg-state.mjs'],{...process.env,W2L_AMAZON_PUBLIC_STATE_FILE:stateFile})
run('npm',['run','local:receiver:install'])
run('npm',['run','local:mcp:install'],{...process.env,W2L_AMAZON_PUBLIC_STATE_FILE:stateFile,W2L_LOCAL_DELIVERY_LOOPBACK:'1'})
let codexConnected=false
try {
  const current=execFileSync('codex',['mcp','get','w2l-local'],{encoding:'utf8'})
  if(!current.includes('http://127.0.0.1:8791/mcp'))throw new Error('existing w2l-local MCP points to a different URL')
  codexConnected=true
} catch(error) {
  if(error instanceof Error && error.message.includes('different URL'))throw error
  try {run('codex',['mcp','add','w2l-local','--url','http://127.0.0.1:8791/mcp']);codexConnected=true}
  catch {codexConnected=false}
}
console.log(JSON.stringify({localMcp:'http://127.0.0.1:8791/mcp',receiver:'https://127.0.0.1:8788/webhook',amazonStateReady:existsSync(stateFile),codexConnected,next:'Open a new Codex task and follow docs/dual-flow-first-use.md'}))
