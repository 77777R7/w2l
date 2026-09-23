import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, createApiEngine } from '@w2l/api'
import type { NetworkPolicy } from '@w2l/contracts'
import { hostedNetworkPolicy } from '@w2l/contracts'
import { DeliveryStore, DeliveryWorker } from '@w2l/runtime'
import { W2L } from '@w2l/sdk'

export interface ManagedRuntimeOptions {
  taskRoot: string
  networkPolicy: NetworkPolicy
  deliveryNetworkPolicy?: NetworkPolicy
  httpOnly?: boolean
  defaultMaxPages?: number | null
  monitorPollMs?: number
  deliveryPollMs?: number
}

/** The REST API stays in-process; both MCP transports share these durable workers. */
export function createManagedRuntime(options: ManagedRuntimeOptions) {
  const engine = createApiEngine({taskRoot:options.taskRoot,networkPolicy:options.networkPolicy,httpOnly:options.httpOnly,defaultMaxPages:options.defaultMaxPages})
  const api = createApp(engine)
  const client = new W2L({baseUrl:'http://w2l.internal',fetch:async(input,init)=>api.fetch(new Request(input,init))})
  const deliveryStore = DeliveryStore.open(join(options.taskRoot,'section-b-control.sqlite'))
  const worker = new DeliveryWorker(deliveryStore,{networkPolicy:options.deliveryNetworkPolicy ?? hostedNetworkPolicy(),ca:process.env.W2L_DELIVERY_CA_FILE ? readFileSync(process.env.W2L_DELIVERY_CA_FILE) : undefined})
  const controller = new AbortController()
  let monitorTick = Date.now(), deliveryTick = Date.now(), fault: string | null = null, closing: Promise<void> | null = null
  const sleep = (ms:number) => new Promise<void>(resolve=>{
    let timer:ReturnType<typeof setTimeout>
    const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve()}
    timer=setTimeout(done,ms)
    controller.signal.addEventListener('abort',done,{once:true})
  })
  const monitorLoop = (async () => {
    while (!controller.signal.aborted) {
      monitorTick=Date.now()
      const due=engine.listMonitors().filter(view=>view.enabled && (view.nextRunAt<=Date.now() || view.runs.some(run=>run.state==='running' && (run.leaseUntil ?? Infinity)<=Date.now())))
      let index=0
      await Promise.all(Array.from({length:Math.min(4,due.length)},async()=>{
        while (index<due.length && !controller.signal.aborted) {
          const view=due[index++]!
          try {await engine.runMonitor(view.revision.monitorId,undefined,{signal:controller.signal})}
          catch (error) {console.error(JSON.stringify({component:'monitor',id:view.revision.monitorId,error:String(error)}))}
        }
      }))
      await sleep(options.monitorPollMs ?? 1000)
    }
  })().catch(error=>{fault=String(error);console.error(error)})
  const deliveryLoop = (async () => {
    while (!controller.signal.aborted) {
      deliveryTick=Date.now()
      const didWork=await worker.processOne(controller.signal)
      if (!didWork) await sleep(options.deliveryPollMs ?? 500)
    }
  })().catch(error=>{fault=String(error);console.error(error)})
  return {
    engine,client,
    health:()=>({ok:!fault && Date.now()-monitorTick<360_000 && Date.now()-deliveryTick<30_000,monitorLoop:Date.now()-monitorTick<360_000,deliveryLoop:Date.now()-deliveryTick<30_000,fault}),
    close:()=>{
      if (closing) return closing
      controller.abort(new DOMException('service shutdown','ShutdownError'))
      closing=(async()=>{
        await Promise.all([monitorLoop,deliveryLoop])
        await engine.close({cancelActive:true})
        deliveryStore.close()
      })()
      return closing
    },
  }
}
