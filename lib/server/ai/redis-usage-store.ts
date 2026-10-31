import "server-only";
import { AuthorizationSchema, ReservationSchema, ReserveRequestSchema, SafeUsageStatusSchema, SettleRequestSchema, SettlementSchema, StatusRequestSchema } from "./usage-store.ts";
import type { UsageStore } from "./usage-store.ts";
import { TransportFailure } from "./contracts.ts";
import { z } from "zod";

export type AtomicUsageOperation = { protocol: "aivra-usage-v1"; operation: "authorizeAndReserve" | "settle" | "getSafeUsageStatus"; input: unknown };
/** A later approved Redis Lua/transaction implementation must satisfy this port. */
export type RedisAtomicExecutor = (operation: AtomicUsageOperation) => Promise<{ protocol: "aivra-usage-v1"; atomic: true; result: unknown }>;

export function createRedisUsageStore(executeAtomic: RedisAtomicExecutor, timeoutMs = 1000): UsageStore {
  async function execute<T>(operation: AtomicUsageOperation["operation"], input: unknown, schema: z.ZodType<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw new Error("Invalid store deadline");
      const reply = await Promise.race([
        executeAtomic({ protocol: "aivra-usage-v1", operation, input }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Atomic operation deadline")), timeoutMs); }),
      ]);
      const envelope = z.strictObject({ protocol: z.literal("aivra-usage-v1"), atomic: z.literal(true), result: schema }).parse(reply);
      return envelope.result;
    } catch { throw new TransportFailure("controls_unavailable"); }
    finally { clearTimeout(timer); }
  }
  return {
    kind: "durable-atomic-contract",
    async authorizeAndReserve(request) {
      const normalized = ReserveRequestSchema.parse(request);
      const result = await execute("authorizeAndReserve", normalized, AuthorizationSchema);
      if (result.authorized) {
        const r = ReservationSchema.parse(result.reservation);
        if (r.request_id !== request.request_id || r.mode !== request.mode || r.namespace !== request.policy.namespace || r.period_key !== request.policy.period_key) throw new TransportFailure("controls_unavailable");
      }
      return result;
    },
    settle: (request) => execute("settle", SettleRequestSchema.parse(request), SettlementSchema),
    getSafeUsageStatus: (request) => execute("getSafeUsageStatus", StatusRequestSchema.parse(request), SafeUsageStatusSchema),
  };
}
