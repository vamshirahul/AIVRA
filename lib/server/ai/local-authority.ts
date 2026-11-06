import "server-only";
import type { UsageStore } from "./usage-store.ts";
const issued = new WeakMap<object, UsageStore>();
export type LocalAuthority = Readonly<{ readonly localALA: unique symbol }>;
export function localProcessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" && env.AIVRA_AI_ENABLED === "true" && env.AIVRA_LOCAL_DEMO_ONLY === "true" && /^[a-f0-9]{64}$/.test(env.AIVRA_LOCAL_ALA_LAUNCHER ?? "") && !env.VERCEL && !env.CI;
}
/** Server-only capability; JSON/env flags alone never grant router authority. */
export function issueLocalAuthority(store: UsageStore): LocalAuthority {
  if (!localProcessEnabled() || store.kind !== "local-demo") throw Error("Local execution unavailable");
  const capability = Object.freeze({}) as LocalAuthority; issued.set(capability, store); return capability;
}
export function validLocalAuthority(capability: unknown, store: UsageStore | undefined, module: string): boolean {
  return localProcessEnabled() && module === "ala" && !!capability && typeof capability === "object" && !!store && store.kind === "local-demo" && issued.get(capability) === store;
}
