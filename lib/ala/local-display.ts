import { readReviewedExport } from "./review-export.ts";
import type { ALAResultsData, ALAResultsView } from "./results-view.ts";
import type { DemoSession } from "../session/session.ts";
/** Structural local HTTP receipt parser, NOT general imported-file/server ownership.
 * Only the local component's matching same-origin request may call this seam.
 */
export function readLocalALADisplay(input:unknown,session:DemoSession,nonce:string):ALAResultsView {
  try {
    if(!input||typeof input!=="object"||Object.keys(input).sort().join(",")!=="artifact,nonce,revision,session_id,status")return {state:"invalid"};
    const wire=input as Record<string,unknown>;
    if(wire.status!=="success"||wire.nonce!==nonce||wire.session_id!==session.session_id||wire.revision!==session.input_revisions.applications)return {state:"invalid"};
    const parsed=readReviewedExport(wire.artifact);if(!parsed.ok||parsed.artifact.review.overrides.length)return {state:"invalid"};
    const a=parsed.artifact.analysis,apps=session.current_deal.applications,byId=new Map(apps.map(app=>[app.app_id,app]));
    if(a.source_revision!==session.input_revisions.applications||a.currency!==session.current_deal.currency)return {state:"invalid"};
    for(const side of ["buyer","target"] as const)if(a.coverage[side].source_count!==apps.filter(app=>app.company_side===side).length)return {state:"invalid"};
    for(const f of a.findings){for(const side of ["buyer","target"] as const)for(const app of f[side])if(byId.get(app.app_id)?.company_side!==side||byId.get(app.app_id)?.app_name!==app.name)return {state:"invalid"};for(const e of f.source_evidence)if(!byId.has(e.app_id)||byId.get(e.app_id)![e.attribute]!==e.value)return {state:"invalid"};}
    for(const r of [...a.missing,...a.not_evaluated])if(byId.get(r.app_id)?.company_side!==r.side)return {state:"invalid"};
    return {state:a.coverage.status==="complete"?"current":"incomplete",data:a as unknown as ALAResultsData};
  }catch{return {state:"invalid"};}
}
