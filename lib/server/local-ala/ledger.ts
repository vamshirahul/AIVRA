import "server-only";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { reservationUnits } from "../ai/control-policy.ts";
import { ReserveRequestSchema, SettleRequestSchema } from "../ai/usage-store.ts";
import type { UsageStore } from "../ai/usage-store.ts";
const Record = z.strictObject({ id:z.uuid(),mode:z.enum(["paid","fallback"]),units:z.number().int().nonnegative().safe(),active:z.boolean(),settled:z.boolean(),blocked:z.boolean(),time:z.number().int().nonnegative() });
const Ledger = z.strictObject({version:z.literal(1),records:z.array(Record).max(20)});
/** Local cost-only ledger. Full reservations are never refunded; no deal text. */
export function createLocalLedger(directory = path.resolve(".local-ala")): UsageStore {
  const file=path.join(directory,"ledger.json"),lock=path.join(directory,"request.lock"),marker=path.join(directory,"initialized");
  let owned: Awaited<ReturnType<typeof open>> | undefined;
  let ownedId:string|undefined;
  async function load() { const size=(await stat(file)).size;if(size>16000)throw Error("Invalid local ledger");return Ledger.parse(JSON.parse(await readFile(file,"utf8"))); }
  async function save(value:z.infer<typeof Ledger>) { const temp=path.join(directory,"ledger.next");const h=await open(temp,"w",0o600);try{await h.writeFile(JSON.stringify(Ledger.parse(value)));await h.sync();}finally{await h.close();}await rename(temp,file); }
  const state=(data:z.infer<typeof Ledger>,mode:"paid"|"fallback")=>{const rows=data.records.filter(r=>r.mode===mode);return {accounted_units:rows.reduce((n,r)=>n+r.units,0),requests_month:rows.length,requests_day:rows.length,in_flight:rows.filter(r=>r.active).length,blocked:rows.some(r=>r.blocked)};};
  return {kind:"local-demo",
    async authorizeAndReserve(raw) {
      const r=ReserveRequestSchema.parse(raw);if(r.policy.namespace!=="local-ala-only")return {authorized:false,code:"controls_unavailable"};await mkdir(directory,{recursive:true,mode:0o700});
      if(owned)return {authorized:false,code:"capacity_reached"};
      try{owned=await open(lock,"wx",0o600);}catch{return {authorized:false,code:"capacity_reached"};}
      let reserved=false;
      try {
        let data:z.infer<typeof Ledger>;
        try {data=await load();}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;try{await stat(marker);throw Error("Missing initialized ledger");}catch(m){if((m as NodeJS.ErrnoException).code!=="ENOENT")throw m;}const h=await open(marker,"wx",0o600);await h.close();data={version:1,records:[]};await save(data);}
        if(data.records.some(x=>x.id===r.request_id))return {authorized:false,code:"duplicate_request"};
        if(data.records.some(x=>x.active))return {authorized:false,code:"controls_unavailable"};
        if(data.records.length>=20)return {authorized:false,code:"capacity_reached"};
        const s=state(data,r.mode),units=reservationUnits(r.policy,r.mode);
        if(s.blocked)return {authorized:false,code:"controls_unavailable"};
        if(s.accounted_units+units>r.policy[r.mode].monthly_budget_units)return {authorized:false,code:r.mode==="paid"?"paid_budget_exhausted":"fallback_unavailable"};
        if(data.records.filter(x=>x.time>Date.now()-60000).length>=5)return {authorized:false,code:"rate_limited"};
        data.records.push({id:r.request_id,mode:r.mode,units,active:true,settled:false,blocked:false,time:Date.now()});await save(data);reserved=true;ownedId=r.request_id;
        return {authorized:true,reservation:{request_id:r.request_id,namespace:r.policy.namespace,period_key:r.policy.period_key,mode:r.mode,reserved_units:units,lease_expires_at_ms:Date.now()+r.policy.lease_ms}};
      } finally {if(!reserved){await owned.close();owned=undefined;await import("node:fs/promises").then(fs=>fs.unlink(lock));}}
    },
    async settle(raw) {
      const r=SettleRequestSchema.parse(raw);if(r.namespace!=="local-ala-only"||owned&&ownedId!==r.request_id)throw Error("Local receipt mismatch");
      if(!owned){owned=await open(lock,"wx",0o600);ownedId=r.request_id;}
      const data=await load(),entry=data.records.find(x=>x.id===r.request_id);if(!entry)throw Error("Local receipt mismatch");
      // Replayed/late trusted receipts never refund and only add proven exposure.
      if(!entry.settled)entry.active=r.actual_units===null;else if(r.actual_units!==null)entry.active=false;
      entry.settled=true;entry.blocked=entry.blocked||r.usage_overflow||r.actual_units!==null&&r.actual_units>entry.units;if(r.actual_units!==null)entry.units=Math.max(entry.units,r.actual_units);
      await save(data);await owned.close();owned=undefined;ownedId=undefined;await import("node:fs/promises").then(fs=>fs.unlink(lock));
      return {settled:true,retained:true,overshoot:entry.blocked};
    },
    async getSafeUsageStatus(){const data=await load();return {paid:state(data,"paid"),fallback:state(data,"fallback")};}
  };
}
