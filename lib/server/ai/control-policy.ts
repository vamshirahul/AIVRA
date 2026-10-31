import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { MAX_INPUT_BYTES, ModelIdentitySchema } from "./contracts.ts";

export const USD_UNITS = 1_000_000; // One integer unit = one millionth of USD.
export const ModeSchema = z.enum(["paid", "fallback"]);
export type RouteMode = z.infer<typeof ModeSchema>;
const Units = z.number().int().min(1).max(1_000_000_000_000);
const ModelPolicy = ModelIdentitySchema.extend({
  approved: z.literal(true), approval_ref: z.string().min(1).max(128),
  monthly_budget_units: Units, per_request_ceiling_units: Units,
  input_units_per_token: z.number().int().min(1).max(1_000_000),
  output_units_per_token: z.number().int().min(1).max(1_000_000),
  concurrency: z.number().int().min(1).max(100),
});
export const EnabledPolicySchema = z.strictObject({
  enabled: z.literal(true), live_dispatch_enabled: z.literal(false),
  namespace: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  period_key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  paid_enabled: z.boolean(), fallback_enabled: z.boolean(),
  paid: ModelPolicy.extend({ credential_slot: z.literal("paid") }),
  fallback: ModelPolicy.extend({ credential_slot: z.literal("fallback"),
    open_weight_verified: z.literal(true), open_weight_evidence: z.url().max(512).startsWith("https://"),
    daily_requests: z.number().int().min(1).max(100_000), monthly_requests: z.number().int().min(1).max(100_000),
  }),
  client_window_ms: z.number().int().min(1_000).max(86_400_000), client_requests: z.number().int().min(1).max(10_000),
  global_window_ms: z.number().int().min(1_000).max(86_400_000), global_requests: z.number().int().min(1).max(100_000),
  global_concurrency: z.number().int().min(1).max(100), client_concurrency: z.number().int().min(1).max(100),
  max_input_bytes: z.number().int().min(1024).max(MAX_INPUT_BYTES),
  max_output_tokens: z.number().int().min(1).max(2048), input_overhead_tokens: z.number().int().min(1).max(8192),
  lease_ms: z.number().int().min(100).max(120_000), timeout_ms: z.number().int().min(1).max(15_000),
  store_timeout_ms: z.number().int().min(1).max(2000),
}).superRefine((policy, ctx) => {
  if (policy.lease_ms < policy.timeout_ms + policy.store_timeout_ms + 100 || policy.client_concurrency > policy.global_concurrency ||
    policy.paid.concurrency > policy.global_concurrency || policy.fallback.concurrency > policy.global_concurrency ||
    policy.paid.model_provider === policy.fallback.model_provider || policy.paid.model_id === policy.fallback.model_id ||
    policy.fallback.daily_requests > policy.fallback.monthly_requests) {
    ctx.addIssue({ code: "custom", message: "Incompatible lease, concurrency, provider isolation or fallback limits" });
  }
  for (const mode of ModeSchema.options) {
    if (/(^|\/)(auto|free|default)$/i.test(policy[mode].model_id)) ctx.addIssue({ code: "custom", path: [mode, "model_id"], message: "A specific approved model is required, not an automatic selector" });
    if (reservationUnits(policy, mode) > policy[mode].per_request_ceiling_units) ctx.addIssue({ code: "custom", path: [mode], message: "Request ceiling does not cover bounded exposure" });
  }
});
export const ControlPolicySchema = z.union([z.strictObject({ enabled: z.literal(false) }), EnabledPolicySchema]);
export type EnabledPolicy = z.infer<typeof EnabledPolicySchema>;
export type ControlPolicy = z.infer<typeof ControlPolicySchema>;
export const DEFAULT_CONTROL_POLICY: ControlPolicy = Object.freeze({ enabled: false });

export function reservationUnits(policy: { max_input_bytes: number; input_overhead_tokens: number; max_output_tokens: number; paid: z.infer<typeof ModelPolicy>; fallback: z.infer<typeof ModelPolicy> }, mode: RouteMode): number {
  const price = policy[mode];
  return (policy.max_input_bytes + policy.input_overhead_tokens) * price.input_units_per_token + policy.max_output_tokens * price.output_units_per_token;
}
export function usageCost(policy: EnabledPolicy, mode: RouteMode, input: number | null, output: number | null) {
  if (input === null || output === null) return { actual_units: null, usage_overflow: false };
  const cost = BigInt(input) * BigInt(policy[mode].input_units_per_token) + BigInt(output) * BigInt(policy[mode].output_units_per_token);
  return { actual_units: Number(cost > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : cost), usage_overflow: cost > BigInt(Number.MAX_SAFE_INTEGER) };
}
/** Only an address supplied by a trusted platform edge, never forwarded headers. */
export function deriveAnonymousKey(trustedPlatformAddress: string | undefined, serverSecret: string | undefined, nowMs: number): string | null {
  if (!trustedPlatformAddress || !isIP(trustedPlatformAddress) || !serverSecret || Buffer.byteLength(serverSecret) < 32 || !Number.isSafeInteger(nowMs)) return null;
  return createHmac("sha256", serverSecret).update(`${new Date(nowMs).toISOString().slice(0, 10)}:${trustedPlatformAddress}`).digest("hex");
}
