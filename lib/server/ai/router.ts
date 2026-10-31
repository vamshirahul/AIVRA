import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAIAdapter, validateInvocation } from "./adapter.ts";
import { ControlPolicySchema, DEFAULT_CONTROL_POLICY, reservationUnits, usageCost } from "./control-policy.ts";
import type { RouteMode } from "./control-policy.ts";
import { failure, TransportFailure } from "./contracts.ts";
import type { AdapterResult, InvocationInput, OutputContract, StructuredTransport } from "./contracts.ts";
import { AuthorizationSchema, SettlementSchema } from "./usage-store.ts";
import type { UsageStore } from "./usage-store.ts";

type RouterOptions = {
  policy?: unknown; execution?: "offline-test"; store?: UsageStore;
  paid?: StructuredTransport; fallback?: StructuredTransport; clock?: () => number;
};
const CallerSchema = z.strictObject({ client_key: z.string().regex(/^[a-f0-9]{64}$/), request_id: z.uuid().optional() });

/** Future protected server entrypoint. Only explicit offline composition runs today. */
export function createAIRouter(options: RouterOptions = {}) {
  return async function invoke<T>(request: InvocationInput, contract: OutputContract<T>, caller?: z.infer<typeof CallerSchema>): Promise<AdapterResult<T>> {
    const requestId = caller?.request_id && z.uuid().safeParse(caller.request_id).success ? caller.request_id : randomUUID();
    try {
      const config = ControlPolicySchema.safeParse(options.policy ?? DEFAULT_CONTROL_POLICY);
      if (!config.success) return failure("invalid_input", requestId);
      if (!config.data.enabled) return failure("ai_disabled", requestId);
      const policy = config.data;
      if (options.execution !== "offline-test" || !options.store) return failure("controls_unavailable", requestId);
      const identity = CallerSchema.safeParse(caller);
      if (!identity.success) return failure("controls_unavailable", requestId);
      const preflight = validateInvocation(request, contract);
      if (!preflight.ok) return failure(preflight.code, requestId);
      let bytes: number;
      try { bytes = Buffer.byteLength(JSON.stringify({ input: preflight.input, schema: z.toJSONSchema(contract.schema) }), "utf8"); }
      catch { return failure("invalid_input", requestId); }
      if (bytes > policy.max_input_bytes) return failure("request_too_large", requestId);
      const clock = options.clock ?? Date.now;
      const issued = clock();
      const digest = createHash("sha256").update(JSON.stringify({ input: preflight.input, references: preflight.references })).digest("hex");
      async function storeOperation<R>(operation: () => Promise<R>): Promise<R> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TransportFailure("controls_unavailable")), policy.store_timeout_ms); })]); }
        finally { clearTimeout(timer); }
      }
      let mode: RouteMode = policy.paid_enabled ? "paid" : "fallback";
      let reason: "budget_exhausted" | "paid_unavailable" | undefined = policy.paid_enabled ? undefined : "paid_unavailable";
      let authorized;
      while (true) {
        if (mode === "fallback" && !policy.fallback_enabled) return failure("fallback_unavailable", requestId);
        const transport = mode === "paid" ? options.paid : options.fallback;
        if (!transport) return failure(mode === "paid" ? "controls_unavailable" : "fallback_unavailable", requestId);
        if (transport.disabled_reason) return failure(transport.disabled_reason, requestId);
        if (transport.model_provider !== policy[mode].model_provider || transport.model_id !== policy[mode].model_id) return failure("controls_unavailable", requestId);
        let decision;
        try {
          decision = AuthorizationSchema.parse(await storeOperation(() => options.store!.authorizeAndReserve({ request_id: requestId, input_digest: digest, client_key: identity.data.client_key, issued_at_ms: issued, mode, policy })));
        } catch { return failure("controls_unavailable", requestId); }
        if (!decision.authorized) {
          if (mode === "paid" && decision.code === "paid_budget_exhausted") { mode = "fallback"; reason = "budget_exhausted"; continue; }
          return failure(decision.code, requestId);
        }
        const receipt = decision.reservation;
        if (receipt.request_id !== requestId || receipt.namespace !== policy.namespace || receipt.mode !== mode || receipt.period_key !== policy.period_key || receipt.reserved_units !== reservationUnits(policy, mode) || receipt.lease_expires_at_ms <= clock() + policy.timeout_ms) return failure("controls_unavailable", requestId);
        authorized = { transport, mode };
        break;
      }
      const result = await createAIAdapter(authorized.transport, { timeoutMs: policy.timeout_ms, requestId, mode: authorized.mode, routingReason: reason, maxOutputTokens: policy.max_output_tokens })(preflight.input, contract);
      const accounting = result.ok ? usageCost(policy, mode, result.result.usage_estimate.input_tokens, result.result.usage_estimate.output_tokens) : { actual_units: null, usage_overflow: false };
      try {
        const receipt = SettlementSchema.parse(await storeOperation(() => options.store!.settle({ namespace: policy.namespace, request_id: requestId, ...accounting })));
        if (!receipt.settled || receipt.overshoot) return failure("controls_unavailable", requestId);
      } catch { return failure("controls_unavailable", requestId); }
      // No provider-error failover, repair call or automatic second model request.
      return result;
    } catch { return failure("controls_unavailable", requestId); }
  };
}
