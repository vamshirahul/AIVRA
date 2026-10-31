import "server-only";
import { createHash } from "node:crypto";
import { reservationUnits } from "./control-policy.ts";
import type { RouteMode } from "./control-policy.ts";
import { ReserveRequestSchema, SafeUsageStatusSchema, SettleRequestSchema, StatusRequestSchema } from "./usage-store.ts";
import type { Authorization, ReserveRequest, SettleRequest, UsageStore } from "./usage-store.ts";
import { TransportFailure } from "./contracts.ts";

type Ledger = {
  request_id: string; namespace: string; mode: RouteMode; period_key: string; reserved_units: number; lease_expires_at_ms: number;
  client_key: string; fingerprint: string; settled: boolean; expired: boolean; active: boolean; retire_at_ms: number;
  retained: boolean; overshoot: boolean;
  accounted_units: number;
};
type Bucket = { accounted_units: number; requests_month: number; daily: Map<string, number>; blocked: boolean; retire_at_ms: number };
const MAX_ENTRIES = 10_000;
const RETENTION_MS = 32 * 86_400_000;

/** Deterministic single-process TEST fake. NEVER an authoritative public budget. */
export function createFakeUsageStore(clock: () => number): UsageStore {
  const records = new Map<string, Ledger>();
  const buckets = new Map<string, Bucket>();
  const policies = new Map<string, { fingerprint: string; retire_at_ms: number }>();
  const rates = new Map<string, { count: number; end: number }>();
  let lastNow = 0;
  function now() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < lastNow) throw new TransportFailure("controls_unavailable");
    lastNow = value;
    for (const [key, record] of records) {
      if (record.active && record.lease_expires_at_ms <= value) { record.active = false; record.expired = true; record.retained = true; }
      if (record.retire_at_ms <= value) records.delete(key);
    }
    for (const [key, bucket] of buckets) if (bucket.retire_at_ms <= value) buckets.delete(key);
    for (const [key, policy] of policies) if (policy.retire_at_ms <= value) policies.delete(key);
    for (const [key, rate] of rates) if (rate.end <= value) rates.delete(key);
    return value;
  }
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const bucketKey = (namespace: string, mode: RouteMode, period: string) => `${namespace}:${mode}:${period}`;
  function saturatedAdd(value: number, delta: number) {
    const sum = BigInt(value) + BigInt(delta);
    return Number(sum > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : sum);
  }
  return {
    kind: "offline-test",
    // No await inside these transitions: check + mutation is atomic in this fake.
    async authorizeAndReserve(raw: ReserveRequest): Promise<Authorization> {
      const request = ReserveRequestSchema.parse(raw);
      const time = now(); const p = request.policy;
      const date = new Date(time); const month = date.toISOString().slice(0, 7); const day = date.toISOString().slice(0, 10);
      const deny = (code: Exclude<Authorization, { authorized: true }>["code"]): Authorization => ({ authorized: false, code });
      if (p.period_key !== month || request.issued_at_ms > time || time - request.issued_at_ms > p.lease_ms) return deny("controls_unavailable");
      const recordKey = `${p.namespace}:${request.request_id}`;
      const fingerprint = hash({ request_id: request.request_id, input_digest: request.input_digest, client_key: request.client_key, mode: request.mode, policy: p });
      const existing = records.get(recordKey);
      if (existing) return deny(existing.fingerprint === fingerprint ? "duplicate_request" : "controls_unavailable");
      const retirement = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) + RETENTION_MS;
      const policyKey = `${p.namespace}:${month}`;
      const policyFingerprint = hash(p);
      const previousPolicy = policies.get(policyKey);
      if (previousPolicy && previousPolicy.fingerprint !== policyFingerprint) return deny("controls_unavailable");
      if (records.size >= MAX_ENTRIES || buckets.size >= MAX_ENTRIES || policies.size >= MAX_ENTRIES) return deny("capacity_reached");
      policies.set(policyKey, { fingerprint: policyFingerprint, retire_at_ms: retirement });
      const key = bucketKey(p.namespace, request.mode, month);
      const bucket = buckets.get(key) ?? { accounted_units: 0, requests_month: 0, daily: new Map<string, number>(), blocked: false, retire_at_ms: retirement };
      const exposure = reservationUnits(p, request.mode);
      if (bucket.blocked) return deny("controls_unavailable");
      if ((request.mode === "paid" && !p.paid_enabled) || (request.mode === "fallback" && !p.fallback_enabled)) return deny(request.mode === "paid" ? "paid_budget_exhausted" : "fallback_unavailable");
      if (bucket.accounted_units + exposure > p[request.mode].monthly_budget_units) return deny(request.mode === "paid" ? "paid_budget_exhausted" : "fallback_unavailable");
      if (request.mode === "fallback" && (bucket.requests_month >= p.fallback.monthly_requests || (bucket.daily.get(day) ?? 0) >= p.fallback.daily_requests)) return deny("fallback_unavailable");
      const globalWindow = Math.floor(time / p.global_window_ms) * p.global_window_ms;
      const clientWindow = Math.floor(time / p.client_window_ms) * p.client_window_ms;
      const globalKey = `${p.namespace}:global:${globalWindow}`;
      const clientKey = `${p.namespace}:client:${request.client_key}:${clientWindow}`;
      if ((rates.get(globalKey)?.count ?? 0) >= p.global_requests || (rates.get(clientKey)?.count ?? 0) >= p.client_requests) return deny("rate_limited");
      const active = [...records.values()].filter((record) => record.namespace === p.namespace && record.active);
      if (active.length >= p.global_concurrency || active.filter((r) => r.client_key === request.client_key).length >= p.client_concurrency || active.filter((r) => r.mode === request.mode).length >= p[request.mode].concurrency) return deny("capacity_reached");
      const reservation = { request_id: request.request_id, namespace: p.namespace, mode: request.mode, period_key: month, reserved_units: exposure, lease_expires_at_ms: time + p.lease_ms };
      records.set(recordKey, { ...reservation, client_key: request.client_key, fingerprint, settled: false, expired: false, active: true, retire_at_ms: retirement, retained: false, overshoot: false, accounted_units: exposure });
      bucket.accounted_units += exposure; bucket.requests_month++; bucket.daily.set(day, (bucket.daily.get(day) ?? 0) + 1); buckets.set(key, bucket);
      rates.set(globalKey, { count: (rates.get(globalKey)?.count ?? 0) + 1, end: globalWindow + p.global_window_ms });
      rates.set(clientKey, { count: (rates.get(clientKey)?.count ?? 0) + 1, end: clientWindow + p.client_window_ms });
      return { authorized: true, reservation };
    },
    async settle(raw: SettleRequest) {
      const request = SettleRequestSchema.parse(raw); now();
      const record = records.get(`${request.namespace}:${request.request_id}`);
      if (!record) throw new TransportFailure("controls_unavailable");
      const bucket = buckets.get(bucketKey(record.namespace, record.mode, record.period_key));
      if (!bucket) throw new TransportFailure("controls_unavailable");
      const actual = request.actual_units;
      if (record.settled) {
        if (actual !== null) record.active = false;
        // A late receipt never refunds; a newly proven excess only charges upward.
        if (actual !== null && actual > record.reserved_units && actual > record.accounted_units) {
          bucket.accounted_units = saturatedAdd(bucket.accounted_units, actual - record.accounted_units);
          record.accounted_units = actual; record.overshoot = true; bucket.blocked = true;
        }
        if (request.usage_overflow) { record.overshoot = true; bucket.blocked = true; }
        return { settled: true, retained: record.retained, overshoot: record.overshoot };
      }
      record.retained = actual === null || record.expired;
      if (actual !== null && actual > record.reserved_units) {
        bucket.accounted_units = saturatedAdd(bucket.accounted_units, actual - record.reserved_units);
        record.accounted_units = actual;
        record.overshoot = true; bucket.blocked = true;
      } else if (actual !== null && !record.expired) { bucket.accounted_units -= record.reserved_units - actual; record.accounted_units = actual; }
      if (request.usage_overflow) { bucket.blocked = true; record.overshoot = true; record.retained = true; }
      // Ambiguous completion may still be executing; retain its concurrency lease.
      record.active = record.active && actual === null; record.settled = true;
      return { settled: true, retained: record.retained, overshoot: record.overshoot };
    },
    async getSafeUsageStatus(raw) {
      const request = StatusRequestSchema.parse(raw); const time = now(); const day = new Date(time).toISOString().slice(0, 10);
      const modeStatus = (mode: RouteMode) => {
        const bucket = buckets.get(bucketKey(request.namespace, mode, request.period_key));
        return { accounted_units: bucket?.accounted_units ?? 0, requests_month: bucket?.requests_month ?? 0, requests_day: bucket?.daily.get(day) ?? 0,
          in_flight: [...records.values()].filter((r) => r.namespace === request.namespace && r.mode === mode && r.active).length, blocked: bucket?.blocked ?? false };
      };
      return SafeUsageStatusSchema.parse({ paid: modeStatus("paid"), fallback: modeStatus("fallback") });
    },
  };
}
