#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if(process.platform!=='darwin')throw new Error('Local background management uses macOS launchd; use npm run local:mcp on other systems')
const command=process.argv[2]??'status'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const label='dev.w2l.local-mcp'
const domain=`gui/${process.getuid()}`
const plist=join(homedir(),'Library','LaunchAgents',`${label}.plist`)
const port=Number(process.env.W2L_LOCAL_MCP_PORT??8791)
const taskRoot=resolve(process.env.W2L_TASK_ROOT??join(root,'.w2l/api'))
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const launch=(...args)=>execFileSync('launchctl',args,{encoding:'utf8'})

if(command==='install') {
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('W2L_LOCAL_MCP_PORT must be 1..65535')
  mkdirSync(dirname(plist),{recursive:true})
  mkdirSync(join(root,'.w2l'),{recursive:true})
  if(readable(plist)) {
    if(!readFileSync(plist,'utf8').includes(`<string>${label}</string>`))throw new Error(`refusing to replace ${plist}`)
    try{launch('bootout',domain,plist)}catch{}
  }
  writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(root,'packages/mcp/dist/localHostCli.js'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>W2L_TASK_ROOT</key><string>${xml(taskRoot)}</string><key>W2L_LOCAL_MCP_PORT</key><string>${port}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(root,'.w2l/local-mcp.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(root,'.w2l/local-mcp.stderr.log'))}</string>
</dict></plist>
`,{mode:0o600})
  launch('bootstrap',domain,plist)
  console.log(JSON.stringify({installed:true,url:`http://127.0.0.1:${port}/mcp`,plist,taskRoot}))
} else if(command==='restart') {
  launch('kickstart','-k',`${domain}/${label}`)
  console.log(JSON.stringify({restarted:true}))
} else if(command==='status') {
  const url=`http://127.0.0.1:${port}/healthz`
  const response=await fetch(url,{signal:AbortSignal.timeout(3000)}).catch(()=>null)
  console.log(JSON.stringify({installed:readable(plist),url:`http://127.0.0.1:${port}/mcp`,healthy:response?.ok??false,status:response?.status??null}))
  if(!response?.ok)process.exitCode=1
} else if(command==='uninstall') {
  if(readable(plist)) {
    try{launch('bootout',domain,plist)}catch{}
    rmSync(plist)
  }
  console.log(JSON.stringify({installed:false}))
} else throw new Error('usage: local-service.mjs install|status|restart|uninstall')

function readable(path){try{readFileSync(path);return true}catch{return false}}
