#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
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
const receiverLabel='dev.w2l.local-receiver'
const receiverPlist=join(homedir(),'Library','LaunchAgents',`${receiverLabel}.plist`)
const receiverRoot=join(root,'.w2l/local-receiver')
const receiverCert=join(receiverRoot,'receiver.crt')
const receiverKey=join(receiverRoot,'receiver.key')
const secretFile=join(root,'.w2l/local-mcp.env')
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const launch=(...args)=>execFileSync('launchctl',args,{encoding:'utf8'})

if(command==='install') {
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('W2L_LOCAL_MCP_PORT must be 1..65535')
  const allowLocalDelivery=process.env.W2L_LOCAL_DELIVERY_LOOPBACK==='1'
  if(allowLocalDelivery&&!readable(receiverCert))throw new Error('install the local HTTPS receiver first')
  const extraEnv=allowLocalDelivery
    ? `<key>W2L_LOCAL_DELIVERY_LOOPBACK</key><string>1</string><key>W2L_DELIVERY_CA_FILE</key><string>${xml(receiverCert)}</string>`
    : ''
  const monitorPoll=process.env.W2L_LOCAL_MONITOR_POLL_MS
  const pollEnv=monitorPoll?`<key>W2L_LOCAL_MONITOR_POLL_MS</key><string>${xml(monitorPoll)}</string>`:''
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
<key>EnvironmentVariables</key><dict><key>W2L_TASK_ROOT</key><string>${xml(taskRoot)}</string><key>W2L_LOCAL_MCP_PORT</key><string>${port}</string>${extraEnv}${pollEnv}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(root,'.w2l/local-mcp.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(root,'.w2l/local-mcp.stderr.log'))}</string>
</dict></plist>
`,{mode:0o600})
  launch('bootstrap',domain,plist)
  console.log(JSON.stringify({installed:true,url:`http://127.0.0.1:${port}/mcp`,plist,taskRoot,localHttpsDelivery:allowLocalDelivery}))
} else if(command==='install-receiver') {
  mkdirSync(dirname(receiverPlist),{recursive:true})
  mkdirSync(receiverRoot,{recursive:true,mode:0o700})
  if(!existsSync(secretFile))writeFileSync(secretFile,`W2L_WEBHOOK_SECRET_DEMO=${randomBytes(32).toString('hex')}\n`,{mode:0o600})
  else if(statSync(secretFile).mode & 0o077)throw new Error(`${secretFile} must be owner-readable only (chmod 600)`)
  if(!readable(receiverCert)||!readable(receiverKey)) {
    if(readable(receiverCert)||readable(receiverKey))throw new Error('receiver certificate and key must either both exist or both be absent')
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','365','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',receiverKey,'-out',receiverCert],{stdio:'ignore'})
    chmodSync(receiverKey,0o600)
  }
  if(readable(receiverPlist)) {
    if(!readFileSync(receiverPlist,'utf8').includes(`<string>${receiverLabel}</string>`))throw new Error(`refusing to replace ${receiverPlist}`)
    try{launch('bootout',domain,receiverPlist)}catch{}
  }
  const ackLossTest=process.env.W2L_RECEIVER_ACK_LOSS_ONCE==='1'
  const ackLoss=ackLossTest ? '<key>WEBHOOK_ACK_LOSS_ONCE</key><string>1</string>' : ''
  writeFileSync(receiverPlist,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${receiverLabel}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>--import</string><string>tsx</string><string>${xml(join(root,'scripts/section-c/local-receiver-cli.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>${ackLoss}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(root,'.w2l/local-receiver.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(root,'.w2l/local-receiver.stderr.log'))}</string>
</dict></plist>
`,{mode:0o600})
  launch('bootstrap',domain,receiverPlist)
  console.log(JSON.stringify({installed:true,url:'https://127.0.0.1:8788/webhook',plist:receiverPlist,ackLossTest}))
} else if(command==='restart') {
  launch('kickstart','-k',`${domain}/${label}`)
  console.log(JSON.stringify({restarted:true}))
} else if(command==='restart-receiver') {
  launch('kickstart','-k',`${domain}/${receiverLabel}`)
  console.log(JSON.stringify({restarted:true}))
} else if(command==='status') {
  const url=`http://127.0.0.1:${port}/healthz`
  const response=await fetch(url,{signal:AbortSignal.timeout(3000)}).catch(()=>null)
  console.log(JSON.stringify({installed:readable(plist),url:`http://127.0.0.1:${port}/mcp`,healthy:response?.ok??false,status:response?.status??null}))
  if(!response?.ok)process.exitCode=1
} else if(command==='status-receiver') {
  const status=await new Promise(resolve=>{
    const req=httpsGet('https://127.0.0.1:8788/health',{ca:readFileSync(receiverCert),timeout:3000},res=>{res.resume();resolve(res.statusCode??0)})
    req.once('error',()=>resolve(0))
    req.once('timeout',()=>{req.destroy();resolve(0)})
  })
  console.log(JSON.stringify({installed:readable(receiverPlist),url:'https://127.0.0.1:8788/webhook',healthy:status===200,status:status||null}))
  if(status!==200)process.exitCode=1
} else if(command==='uninstall') {
  if(readable(plist)) {
    try{launch('bootout',domain,plist)}catch{}
    rmSync(plist)
  }
  console.log(JSON.stringify({installed:false}))
} else if(command==='uninstall-receiver') {
  if(readable(receiverPlist)) {
    try{launch('bootout',domain,receiverPlist)}catch{}
    rmSync(receiverPlist)
  }
  console.log(JSON.stringify({installed:false}))
} else throw new Error('usage: local-service.mjs install|status|restart|uninstall|install-receiver|status-receiver|restart-receiver|uninstall-receiver')

function readable(path){try{readFileSync(path);return true}catch{return false}}
