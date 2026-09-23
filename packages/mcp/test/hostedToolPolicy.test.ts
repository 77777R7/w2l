import { describe, expect, it } from 'vitest'
import type { JsonSchema } from '@w2l/contracts'
import { hostedAmazonUrl, hostedDocumentUrl, normalizeHostedToolCall } from '../src/hostedToolPolicy.js'

const schema: JsonSchema = {type:'object',properties:{asin:{type:'string'}},required:['asin']}
const receiver = 'https://receiver.example/webhook'
const call = (name:string,args:unknown) => normalizeHostedToolCall(name,args,receiver,schema)

describe('single-owner hosted workflow policy', () => {
  it('canonicalizes only public Amazon.sg product URLs and fixes JSON extraction without model calls', () => {
    expect(hostedAmazonUrl('https://www.amazon.sg/dp/B000VW9PIK?tag=ref')).toBe('https://www.amazon.sg/dp/B000VW9PIK')
    expect(call('scrape',{url:'https://www.amazon.sg/dp/B000VW9PIK'})).toEqual({
      url:'https://www.amazon.sg/dp/B000VW9PIK',mode:'standard',formats:[{type:'json',schema,modelFallback:false}],debug:false,
    })
    expect(call('scrape_product',{url:'https://www.amazon.sg/dp/B000VW9PIK?tag=ref'})).toEqual({url:'https://www.amazon.sg/dp/B000VW9PIK',debug:false})
    expect(call('batch_products',{urls:['https://www.amazon.sg/dp/B000VW9PIK']})).toEqual({urls:['https://www.amazon.sg/dp/B000VW9PIK']})
    expect(call('batch_scrape',{urls:['https://www.amazon.sg/dp/B000VW9PIK']})).toEqual({
      urls:['https://www.amazon.sg/dp/B000VW9PIK'],mode:'standard',formats:[{type:'json',schema,modelFallback:false}],includeLinks:false,
    })
  })

  it('rejects other sources, sessions, custom schemas, duplicate ASINs and unbounded waits', () => {
    for (const source of ['http://www.amazon.sg/dp/B000VW9PIK','https://127.0.0.1/dp/B000VW9PIK','https://www.amazon.com/dp/B000VW9PIK','https://www.amazon.sg.evil.example/dp/B000VW9PIK']) {
      expect(() => hostedAmazonUrl(source)).toThrow()
    }
    expect(() => call('scrape',{url:'https://www.amazon.sg/dp/B000VW9PIK',mode:'authed'})).toThrow()
    expect(() => call('scrape',{url:'https://www.amazon.sg/dp/B000VW9PIK',formats:[{type:'json',schema}]})).toThrow()
    expect(() => call('batch_scrape',{urls:['https://www.amazon.sg/dp/B000VW9PIK','https://www.amazon.sg/dp/B000VW9PIK?tag=2']})).toThrow()
    expect(() => call('wait_batch',{id:'batch-1',timeoutMs:300_000})).toThrow()
  })

  it('allows reviewed public-document monitors with explicit HTTP capture and one receiver', () => {
    expect(hostedDocumentUrl('https://modelcontextprotocol.io/specification/2025-11-25')).toContain('modelcontextprotocol.io')
    expect(() => hostedDocumentUrl('https://localhost/guide')).toThrow()
    const monitor = {monitorId:'docs-test',revision:1,url:'https://docs.firecrawl.dev/introduction',ruleVersion:'docs-test/v1',intervalMs:900_000,staleAfterMs:1_800_000,config:{adapter:'markdown-sections/v1',workspaceId:'pilot',entityKey:'introduction',viewKey:'public',expectedTitle:'Introduction',schemaVersion:'1',conditionalRequests:true,captureMode:'http',fields:[{name:'intro',heading:'Introduction',type:'text',required:true}]}}
    expect(call('create_monitor',monitor)).toEqual(monitor)
    expect(() => call('create_monitor',{...monitor,intervalMs:1000})).toThrow()
    expect(() => call('create_monitor',{...monitor,config:{...monitor.config,captureMode:'ladder'}})).toThrow()
    expect(() => call('create_delivery_destination',{monitorId:'docs-test',url:receiver,secretEnv:'W2L_WEBHOOK_SECRET_DEMO'})).not.toThrow()
    expect(() => call('create_delivery_destination',{monitorId:'docs-test',url:'https://evil.example/webhook',secretEnv:'W2L_WEBHOOK_SECRET_DEMO'})).toThrow()
  })
})
