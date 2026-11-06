import "server-only";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { localProcessEnabled, issueLocalAuthority } from "../ai/local-authority.ts";
import { createALAAnalyzer } from "../ala/analyze.ts";
import { projectALAResults } from "../ala/presentation.ts";
import { buildReviewedExport } from "../../ala/review-export.ts";
import { createReviewDraft } from "../../ala/review-overrides.ts";
import { DemoSessionSchema } from "../../session/session.ts";
import { loadSyntheticDealFixture } from "../../fixtures/synthetic-deal.ts";
import { createLocalLedger } from "./ledger.ts";
import { readLocalPolicy } from "./config.ts";
import { createLocalProviders } from "./providers.ts";

export function isLocalRequest(request:Request):boolean {
  try { const h=request.headers,u=new URL(request.url),port=process.env.AIVRA_LOCAL_ALA_PORT??"3000";
    const localOrigins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
    return localProcessEnabled() && localOrigins.has(u.origin) && localOrigins.has(`http://${h.get("host")}`) && h.get("origin")===`http://${h.get("host")}` && h.get("x-aivra-local-demo")==="1" && (!h.get("sec-fetch-site")||h.get("sec-fetch-site")==="same-origin") && !h.has("forwarded") &&
      (!h.has("x-forwarded-host")||h.get("x-forwarded-host")===h.get("host")) && (!h.has("x-forwarded-for")||h.get("x-forwarded-for")==="127.0.0.1") && (!h.has("x-forwarded-proto")||h.get("x-forwarded-proto")==="http");
  }catch{return false;}
}
const headers={"Cache-Control":"no-store","Content-Type":"application/json","X-Content-Type-Options":"nosniff"};
const unavailable=()=>Response.json({status:"error",error:{code:"ai_controls_not_ready",request_id:null,message:"Local AI is unavailable; no public execution is authorized."}},{status:503,headers});
// Local process-owned module state only; no public owner or client grant. HMR
// preserves one store instance; the file lock also excludes other processes.
const globalLocal=globalThis as typeof globalThis & { __aivraLocalALA?: { launcher:string; analyze:ReturnType<typeof createALAAnalyzer> } };
function service() {
  const launcher=process.env.AIVRA_LOCAL_ALA_LAUNCHER!;
  if(globalLocal.__aivraLocalALA?.launcher===launcher)return globalLocal.__aivraLocalALA.analyze;
  const policy=readLocalPolicy(),store=createLocalLedger(),localAuthority=issueLocalAuthority(store),providers=createLocalProviders(localAuthority,store,policy);
  const analyze=createALAAnalyzer({policy,store,...providers,execution:"local-demo",localAuthority});
  globalLocal.__aivraLocalALA={launcher,analyze};return analyze;
}
export async function localALAPost(request:Request) {
  if(!isLocalRequest(request))return unavailable(); // Before body/key/config access.
  if(request.headers.get("content-type")!=="application/json")return unavailable();
  try {
    const max=128000,reader=request.body?.getReader();if(!reader)return unavailable();let size=0;const chunks:Uint8Array[]=[];
    let bodyExpired=false;
    const bodyTimer=setTimeout(()=>{bodyExpired=true;void reader.cancel().catch(()=>{});},3000);
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();return unavailable();}chunks.push(value);}}finally{clearTimeout(bodyTimer);reader.releaseLock();}
    if(bodyExpired)return unavailable();
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    const wire=z.strictObject({session:DemoSessionSchema,synthetic_only:z.literal(true),nonce:z.uuid()}).parse(raw);
    if(!isDeepStrictEqual(raw,wire))return unavailable();
    // Strict synthetic-demo only: edited/published applications must still be
    // byte-for-byte bundled fictional records. Real/CSV content is not sent.
    const bundled=loadSyntheticDealFixture();
    if(JSON.stringify(wire.session.current_deal)!==JSON.stringify(bundled))return unavailable();
    if(request.signal.aborted)return unavailable();
    const outcome=await service()(wire.session,{client_key:createHash("sha256").update("local-ala-single-founder").digest("hex")});
    if(outcome.status==="error")return Response.json(outcome,{status:503,headers});
    const view=projectALAResults(outcome,wire.session,wire.session),draft=createReviewDraft(view),exported=buildReviewedExport(view,draft);
    if(!exported.ok)return unavailable();
    return Response.json({status:"success",nonce:wire.nonce,session_id:wire.session.session_id,revision:wire.session.input_revisions.applications,artifact:exported.artifact},{headers});
  }catch{return unavailable();}
}
