import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createSDKTransport } from "../ai/sdk-transport.ts";
import { validLocalAuthority } from "../ai/local-authority.ts";
import { TransportFailure } from "../ai/contracts.ts";
import type { LocalAuthority } from "../ai/local-authority.ts";
import type { UsageStore } from "../ai/usage-store.ts";
import type { EnabledPolicy } from "../ai/control-policy.ts";
import type { StructuredTransport } from "../ai/contracts.ts";
const usable = (key:string|undefined) => !!key && key.trim()===key && key.length>=20 && !/dummy|placeholder|example|replace|your[-_ ]|test[-_ ]?key/i.test(key);
export function createLocalProviders(authority:LocalAuthority,store:UsageStore,p:EnabledPolicy,env:NodeJS.ProcessEnv=process.env) {
  const make=(mode:"paid"|"fallback"):StructuredTransport|undefined=>{
    if(!p[`${mode}_enabled`])return undefined; // Never even reads the disabled fallback key.
    const key=mode==="paid"?env.OPENAI_API_KEY:env.AIVRA_FALLBACK_API_KEY;
    if(!usable(key))throw Error("Local credential unavailable");
    const url=mode==="paid"?"https://api.openai.com/v1/responses":"https://openrouter.ai/api/v1/chat/completions";
    const upstream=env.AIVRA_LOCAL_OPENROUTER_UPSTREAM;
    const provider=createOpenAI({apiKey:key,baseURL:mode==="paid"?"https://api.openai.com/v1":"https://openrouter.ai/api/v1",fetch:async(input,init)=>{
      if(!validLocalAuthority(authority,store,"ala")||String(input)!==url||init?.method!=="POST"||typeof init.body!=="string")throw new TransportFailure("ai_controls_not_ready");
      if(Buffer.byteLength(init.body,"utf8")>p.max_input_bytes)throw new TransportFailure("request_too_large");
      const body=JSON.parse(init.body);if(body.model!==p[mode].model_id||body.stream===true)throw new TransportFailure("invalid_input");
      if(mode==="fallback") {if(!upstream||!/^[-a-zA-Z0-9_./ ]{1,100}$/.test(upstream))throw new TransportFailure("invalid_input");body.provider={only:[upstream],allow_fallbacks:false,require_parameters:true};}
      return fetch(url,{...init,body:JSON.stringify(body),redirect:"error"});
    }});
    const model=mode==="paid"?provider.responses(p.paid.model_id):provider.chat(p.fallback.model_id);
    // Do not allow provider-supplied warning text into the SDK warning logger.
    // This local-only model wrapper preserves output/usage and makes no extra call.
    const quietModel: typeof model={specificationVersion:model.specificationVersion,provider:model.provider,modelId:model.modelId,supportedUrls:model.supportedUrls,
      doGenerate:async options=>{const result=await model.doGenerate(options);return {...result,warnings:[]};},
      doStream:async()=>{throw new TransportFailure("invalid_input");}};
    const transport=createSDKTransport(quietModel,p[mode].model_provider);
    return {...transport,generate:async call=>{if(call.input.module!=="ala"||!validLocalAuthority(authority,store,call.input.module))throw new TransportFailure("ai_controls_not_ready");return transport.generate(call);}};
  };
  return {paid:make("paid"),fallback:make("fallback")};
}
