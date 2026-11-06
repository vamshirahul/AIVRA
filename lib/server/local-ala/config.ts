import "server-only";
import { EnabledPolicySchema, reservationUnits } from "../ai/control-policy.ts";
const number = (v: string | undefined, min: number, max: number) => { if (!v || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > max) throw Error("Invalid local controls"); return Number(v); };
const money = (v: string | undefined) => { if (!v || !/^\d+(?:\.\d{1,6})?$/.test(v)) throw Error("Missing local budget"); const [a,b=""] = v.split("."); return number(String(Number(a)*1_000_000 + Number(b.padEnd(6,"0"))),1,10_000_000); };
export function readLocalPolicy(env: NodeJS.ProcessEnv = process.env) {
  const fallback = env.AIVRA_LOCAL_FALLBACK_ENABLED === "true";
  if (env.AIVRA_LOCAL_FALLBACK_ENABLED && !["true","false"].includes(env.AIVRA_LOCAL_FALLBACK_ENABLED)) throw Error("Invalid local flag");
  const paidEnabled = env.AIVRA_LOCAL_PAID_ENABLED !== "false";
  if (env.AIVRA_LOCAL_PAID_ENABLED && !["true","false"].includes(env.AIVRA_LOCAL_PAID_ENABLED)) throw Error("Invalid local flag");
  const priced = (prefix: "PAID" | "FALLBACK", enabled: boolean) => ({ model_provider: prefix === "PAID" ? "openai" : "openrouter", model_id: env[`AIVRA_${prefix}_MODEL_ID`] || (enabled ? "" : `${prefix.toLowerCase()}-disabled-local-path`), approved: true as const, approval_ref: "founder-local-only-operator-config", monthly_budget_units: enabled ? money(env[`AIVRA_LOCAL_${prefix}_BUDGET_USD`]) : 1, per_request_ceiling_units: 1_000_000_000,
    input_units_per_token: enabled ? number(env[`AIVRA_LOCAL_${prefix}_INPUT_MICRO_USD`],1,1_000_000) : 1, output_units_per_token: enabled ? number(env[`AIVRA_LOCAL_${prefix}_OUTPUT_MICRO_USD`],1,1_000_000) : 1, concurrency: 1, credential_slot: prefix === "PAID" ? "paid" as const : "fallback" as const });
  if (fallback && (env.AIVRA_FALLBACK_PROVIDER !== "openrouter" || env.AIVRA_LOCAL_OPEN_WEIGHT_APPROVED !== "true" || !env.AIVRA_LOCAL_OPEN_WEIGHT_EVIDENCE || !env.AIVRA_LOCAL_OPENROUTER_UPSTREAM)) throw Error("Fallback approval absent");
  const p = EnabledPolicySchema.parse({ enabled:true, live_dispatch_enabled:false, namespace:"local-ala-only",period_key:new Date().toISOString().slice(0,7),paid_enabled:paidEnabled,fallback_enabled:fallback,
    paid: priced("PAID",paidEnabled),fallback:{...priced("FALLBACK",fallback),open_weight_verified:true,open_weight_evidence:fallback?env.AIVRA_LOCAL_OPEN_WEIGHT_EVIDENCE:"https://example.invalid/disabled-no-approval",daily_requests:20,monthly_requests:20},
    client_window_ms:60_000,client_requests:5,global_window_ms:60_000,global_requests:5,global_concurrency:1,client_concurrency:1,max_input_bytes:env.AIVRA_LOCAL_MAX_INPUT_BYTES?number(env.AIVRA_LOCAL_MAX_INPUT_BYTES,1024,128000):128000,max_output_tokens:env.AIVRA_LOCAL_MAX_OUTPUT_TOKENS?number(env.AIVRA_LOCAL_MAX_OUTPUT_TOKENS,128,2048):2048,input_overhead_tokens:512,lease_ms:20000,timeout_ms:15000,store_timeout_ms:2000 });
  for (const mode of ["paid","fallback"] as const) p[mode].per_request_ceiling_units=reservationUnits(p,mode);
  return EnabledPolicySchema.parse(p);
}
