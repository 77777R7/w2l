#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { localConfigFromEnv, createLocalService } from './localHost.js'

// A LaunchAgent does not inherit an interactive shell's secrets. The optional
// local file is private and contains literal KEY=value lines, never shell code.
const secretFile=resolve(process.env.W2L_LOCAL_SECRETS_FILE ?? '.w2l/local-mcp.env')
if(existsSync(secretFile)) {
  if(statSync(secretFile).mode & 0o077)throw new Error(`${secretFile} must be owner-readable only (chmod 600)`)
  for(const line of readFileSync(secretFile,'utf8').split(/\r?\n/)) {
    if(!line.trim() || line.trimStart().startsWith('#'))continue
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if(!match)throw new Error(`invalid local secret line in ${secretFile}`)
    if(process.env[match[1]!]===undefined)process.env[match[1]!]=match[2]!
  }
}
const config=localConfigFromEnv()
const service=createLocalService(config)
service.server.once('listening',()=>console.log(JSON.stringify({service:'w2l-local-mcp',url:`http://127.0.0.1:${config.port}/mcp`,taskRoot:config.taskRoot})))
service.server.once('error',error=>{console.error(error);process.exitCode=1;void service.close()})
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{
  void service.close().catch(error=>{console.error(error);process.exitCode=1})
})
