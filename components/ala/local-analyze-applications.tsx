"use client";
import { useEffect, useRef, useState } from "react";
import { useDemoSession } from "../demo-session-provider";
import { ALAReviewWorkspace } from "./ala-review-workspace";
import { AIStatusNotice } from "../ai/ai-status-notice";
import { AI_ERROR_COPY } from "../../lib/ai/ai-view-state";
import type { AIViewState } from "../../lib/ai/ai-view-state";
import type { ALAResultsView } from "../../lib/ala/results-view";
import { readLocalALADisplay } from "../../lib/ala/local-display";
export function LocalAnalyzeApplications() {
  const {session,ready}=useDemoSession();const [view,setView]=useState<ALAResultsView>({state:"absent"}),[notice,setNotice]=useState<AIViewState>({status:"idle"});
  const flight=useRef<AbortController|null>(null),generation=useRef(0),latest=useRef(session),captured=useRef("");latest.current=session;
  const identity=session?JSON.stringify([session.session_id,session.input_revisions.applications,session.current_deal.applications]):"";
  const visible=captured.current&&captured.current!==identity?{state:"outdated" as const}:view;
  useEffect(()=>{generation.current++;flight.current?.abort();flight.current=null;setNotice({status:"idle"});return()=>{generation.current++;flight.current?.abort();flight.current=null;};},[identity]);
  async function analyze(){
    if(!ready||!session||flight.current||(location.protocol!=="http:"||!["127.0.0.1","localhost"].includes(location.hostname)))return;
    const source=structuredClone(session),binding=identity,ticket=++generation.current,nonce=crypto.randomUUID(),abort=new AbortController();flight.current=abort;setNotice({status:"loading"});
    const fresh=()=>ticket===generation.current&&latest.current?.session_id===source.session_id&&latest.current.input_revisions.applications===source.input_revisions.applications&&JSON.stringify(latest.current.current_deal.applications)===JSON.stringify(source.current_deal.applications);
    const timer=setTimeout(()=>abort.abort(),25000);
    try{
      const response=await fetch("/api/local-ala",{method:"POST",credentials:"omit",cache:"no-store",headers:{"Content-Type":"application/json","x-aivra-local-demo":"1"},body:JSON.stringify({session:source,synthetic_only:true,nonce}),signal:abort.signal});
      const reader=response.body?.getReader();if(!reader)throw Error();let bytes=0,text="";const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1_000_000){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
      const reply=JSON.parse(text);if(!fresh())return;
      if(!response.ok){const code=reply?.error?.code;setNotice({status:"error",safeErrorCode:typeof code==="string"&&Object.hasOwn(AI_ERROR_COPY,code)?code as keyof typeof AI_ERROR_COPY:"unexpected_error"});return;}
      const result=readLocalALADisplay(reply,source,nonce);if(!("data" in result)){setNotice({status:"error",safeErrorCode:"invalid_model_output"});return;}
      if(fresh()){captured.current=binding;setView(result);setNotice({status:"completed",resultMetadata:result.data.metadata});}
    }catch{if(fresh())setNotice({status:"error",safeErrorCode:"provider_unavailable"});}
    finally{clearTimeout(timer);if(flight.current===abort)flight.current=null;}
  }
  return <section className="ala-action" aria-label="Local application analysis"><h2 className="section-title">Analyze applications ? local demo</h2>
    <p>Explicit action sends bundled fictional application data to the configured provider and may incur charges. No confidential data. Local limits are conservative accounting, not provider-enforced spending caps. OpenRouter fallback is off by default; only explicitly enabled, approved local configuration can use it.</p>
    <button className="button button-primary ala-analyze-button" disabled={!ready||!session||notice.status==="loading"} onClick={()=>void analyze()}>Analyze applications</button>
    <AIStatusNotice state={visible.state==="outdated"&&notice.status==="completed"?{...notice,freshness:"stale"}:notice}/><ALAReviewWorkspace view={visible}/></section>;
}
