import "server-only";
import { z } from "zod";
import { EnabledPolicySchema, ModeSchema } from "./control-policy.ts";

export const StoreDenialSchema = z.enum(["controls_unavailable", "rate_limited", "capacity_reached", "paid_budget_exhausted", "fallback_unavailable", "duplicate_request"]);
export const ReserveRequestSchema = z.strictObject({
  request_id: z.uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/), client_key: z.string().regex(/^[a-f0-9]{64}$/), issued_at_ms: z.number().int().nonnegative(),
  mode: ModeSchema, policy: EnabledPolicySchema,
});
export type ReserveRequest = z.infer<typeof ReserveRequestSchema>;
export const ReservationSchema = z.strictObject({
  request_id: z.uuid(), namespace: z.string().min(1).max(40), mode: ModeSchema,
  period_key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), reserved_units: z.number().int().nonnegative(), lease_expires_at_ms: z.number().int().nonnegative(),
});
export const AuthorizationSchema = z.union([z.strictObject({ authorized: z.literal(true), reservation: ReservationSchema }), z.strictObject({ authorized: z.literal(false), code: StoreDenialSchema })]);
export type Authorization = z.infer<typeof AuthorizationSchema>;
export const SettleRequestSchema = z.strictObject({ namespace: z.string().min(1).max(40), request_id: z.uuid(), actual_units: z.number().int().nonnegative().nullable(), usage_overflow: z.boolean() });
export type SettleRequest = z.infer<typeof SettleRequestSchema>;
export const SettlementSchema = z.strictObject({ settled: z.boolean(), retained: z.boolean(), overshoot: z.boolean() });
export type Settlement = z.infer<typeof SettlementSchema>;
const AggregateSchema = z.strictObject({ accounted_units: z.number().int().nonnegative(), requests_month: z.number().int().nonnegative(), requests_day: z.number().int().nonnegative(), in_flight: z.number().int().nonnegative(), blocked: z.boolean() });
export const StatusRequestSchema = z.strictObject({ namespace: z.string().min(1).max(40), period_key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export const SafeUsageStatusSchema = z.strictObject({ paid: AggregateSchema, fallback: AggregateSchema });
export type SafeUsageStatus = z.infer<typeof SafeUsageStatusSchema>;

/** Each method is ONE atomic operation, not a read/modify/write client sequence. */
export interface UsageStore {
  readonly kind: "offline-test" | "durable-atomic-contract";
  authorizeAndReserve(request: ReserveRequest): Promise<Authorization>;
  settle(request: SettleRequest): Promise<Settlement>;
  getSafeUsageStatus(request: z.infer<typeof StatusRequestSchema>): Promise<SafeUsageStatus>;
}
