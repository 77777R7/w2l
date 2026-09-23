/** Export a reviewable, secret-free ledger from the ignored local 100-page run. */
import { readFile, writeFile } from 'node:fs/promises'

const [reportPath,reviewPath,outputPath]=process.argv.slice(2)
if(!reportPath||!reviewPath||!outputPath)throw new Error('usage: export-dual-flow-evidence.mjs LINKED_REPORT REVIEW_JSON OUTPUT_JSON')
const report=JSON.parse(await readFile(reportPath,'utf8'))
const review=JSON.parse(await readFile(reviewPath,'utf8'))
if(report.records?.length!==100||review.rows?.length!==100||report.source?.commit!==review.source?.commit)throw new Error('100-page source mismatch')
const scoreByIndex=new Map(review.rows.map(row=>[row.index,row]))
const ledger={
  kind:'dual-flow-amazon-100-local-transport-evidence',
  accepted:false,humanReviewPending:true,hostedWorkosRenderVerified:false,
  source:report.source,startedAt:report.startedAt,endedAt:report.endedAt,taskId:report.taskId,
  batch:{status:report.terminalStatus,clientMs:report.batchClientMs,paginatedItems:report.paginationItems,uniqueItems:report.uniquePaginationItems,durableSteps:report.stepItems},
  summary:{...report.summary,rawHashesVerified:review.rawHashesVerified,requestedMatchesSelectedRaw:review.requestedMatchesSelected,
    regionSingaporeVisible:review.regionSingaporeVisible,postcodeVisible:review.postcodeVisible,
    recommendationAsinLeakRows:review.recommendationAsinLeakRows,recommendationImageLeakRows:review.recommendationImageLeakRows,
    priceOffersSubjectWitnessed:review.priceOffersSubjectWitnessed,priceOffersEmitted:review.priceOffersEmitted,
    imagesSubjectWitnessed:review.imagesSubjectWitnessed,imagesEmitted:review.imagesEmitted,
    fields:review.fields,
    bytesDecompressed:report.records.reduce((sum,row)=>sum+(row.usage?.bytesDecompressed??0),0),
    browserMs:report.records.reduce((sum,row)=>sum+(row.usage?.browserMs??0),0),
    knownModelCalls:0,knownPaidBrowserVendorCalls:0,hostInfrastructureCostUsd:null},
  pages:report.records.map(row=>{
    const scored=scoreByIndex.get(row.index)
    if(!scored||scored.requestedAsin!==row.asin||scored.rawBodySha256!==row.snapshot?.rawBodySha256)throw new Error(`row ${row.index} review mismatch`)
    return {index:row.index,url:row.url,requestedAsin:row.asin,selectedAsin:scored.selectedAsin,
      captureStatus:row.outcome.status,structuredStatus:row.structured?.status??null,
      failureReason:row.outcome.failureReason,blockReason:row.outcome.blockReason,
      deliveryLocation:row.locationText,rawBodySha256:scored.rawBodySha256,
      output:scored.output,visibleWitness:scored.witness,
      checks:scored.checks,recommendationAsinLeaks:scored.recommendationAsinLeaks,recommendationImageLeaks:scored.recommendationImageLeaks,
      issues:(row.structured?.issues??[]).map(issue=>({code:issue.code,path:issue.path,message:issue.message})),
      wallMs:row.usage?.wallMs??null,statusRetryCount:row.usage?.statusRetryCount??0,navigationFollowupCount:row.usage?.navigationFollowupCount??0,
      bytesDecompressed:row.usage?.bytesDecompressed??null,externalCostUsd:row.usage?.externalCostUsd??null}
  }),
}
await writeFile(outputPath,JSON.stringify(ledger,null,2)+'\n')
console.log(JSON.stringify({outputPath,pages:ledger.pages.length,commit:ledger.source.commit,humanReviewPending:true}))
