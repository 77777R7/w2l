import type { DocumentAssessment, FieldValue, MonitorRevision, FetchResult } from '@w2l/contracts'

/** Exact document identity + versioned Markdown sections. Not a general truth oracle. */
export function assessConfiguredDocument(result: FetchResult | null, revision: MonitorRevision): DocumentAssessment {
  const config = revision.config!
  const assessment: DocumentAssessment = { ruleVersion:revision.ruleVersion, quality:'unknown', reasons:[], fields:{}, evidence:[] }
  if (!result || result.status !== 'success' || result.truncated || !result.markdown?.trim()) {
    assessment.reasons.push('capture_incomplete')
    for (const f of config.fields) assessment.fields![f.name] = {state:'unobserved',reason:'capture_incomplete'}
    return assessment
  }
  if (result.evidence.httpStatus !== 200) return {...assessment, quality:'invalid', reasons:['unexpected_http_status'], fields:null}
  const actual = new URL(result.evidence.finalUrl); const expected = new URL(revision.url)
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) {
    return {...assessment, quality:'invalid',reasons:['wrong_document'],fields:null}
  }
  const md = result.markdown
  const headings: {title:string;level:number;start:number;end:number}[] = []
  let offset=0; let fence:string|null=null
  for (const line of md.split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (mark) { if (!fence) fence=mark; else if (mark[0]===fence[0] && mark.length>=fence.length) fence=null }
    else if (!fence) {
      const h=/^(#{1,6})\s+(.+)$/.exec(line)
      if (h) headings.push({level:h[1]!.length,title:h[2]!.replace(/\[[^\]]*\]\(#[^)]*\)/g,'').replace(/[\u200B-\u200D\uFEFF]/g,'').trim(),start:offset,end:offset+line.length})
    }
    offset += line.length+1
  }
  if (headings.filter((h)=>h.level===1).length !== 1 || headings.find((h)=>h.level===1)?.title !== config.expectedTitle) return {...assessment,quality:'invalid',reasons:['title_identity_mismatch'],fields:null}
  assessment.quality='valid'
  for (const f of config.fields) {
    const matches=headings.filter((h)=>h.title===f.heading)
    const candidates: {value:string|boolean;evidenceRefs:string[]}[]=[]
    let value: FieldValue = {state:'unobserved',reason:'missing_section'}
    for (const h of matches) {
      const end=headings.find((next)=>next.start>h.start)?.start ?? md.length
      const raw=md.slice(h.end,end); const start=h.end+(raw.length-raw.trimStart().length)
      const quote=raw.trim(); if (!quote) continue
      const ref=`${f.name}:${start}:${start+quote.length}`
      assessment.evidence.push({field:f.name,start,end:start+quote.length,quote})
      if (matches.length===1 && quote===f.nullMarker) {value={state:'explicit_null',reason:'source_explicit_null',evidenceRefs:[ref]}; break}
      if (matches.length===1 && quote===f.redactedMarker) {value={state:'redacted',reason:'source_redacted'}; break}
      let parsed: string|boolean = f.type==='code' ? quote : quote.replace(/\s+/g,' ')
      if (f.type==='decimal') {
        if (!/^-?\d+(?:\.\d+)?$/.test(parsed)) {value={state:'unobserved',reason:'invalid_decimal'}; continue}
        const negative=parsed.startsWith('-'); const [whole,fraction='']=parsed.replace(/^-/,'').split('.')
        const body=whole!.replace(/^0+(?=\d)/,'')+(fraction.replace(/0+$/,'') ? '.'+fraction.replace(/0+$/,'') : '')
        parsed=(negative && body!=='0' ? '-' : '')+body
      }
      if (f.type==='boolean') {if (parsed!=='true' && parsed!=='false') {value={state:'unobserved',reason:'invalid_boolean'};continue}; parsed=parsed==='true'}
      candidates.push({value:parsed,evidenceRefs:[ref]})
    }
    if (matches.length>1) value={state:'conflicting',candidates}
    else if (candidates.length===1) value={state:'present',...candidates[0]!}
    assessment.fields![f.name]=value
    if (value.state==='conflicting' || (f.required && !['present','explicit_null'].includes(value.state))) {
      assessment.quality='partial';assessment.reasons.push(`${f.name}:${value.state}`)
    }
  }
  return assessment
}

export function fieldComparable(value: unknown): unknown {
  if (value && typeof value==='object' && 'state' in value) {
    const f=value as FieldValue
    return f.state==='present' ? {state:f.state,value:f.value} : f.state==='explicit_null' ? {state:f.state} : f
  }
  return value
}
