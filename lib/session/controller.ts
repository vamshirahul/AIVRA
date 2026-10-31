import { captureInputVersions, createDemoSession, getResultFreshness, parseSession, publishSessionApplications, recordDerivedResultMetadata, serializeSession, SESSION_STORAGE_KEY, updateApplication, updateLicense, updateTSA } from "./session.ts";
import { PublicationFailure } from "../data-mapper/publish-applications.ts";
import type { PublicationBlock, PublicationResult, PublicationToken } from "../data-mapper/publish-applications.ts";
import type { Application } from "../contracts/demo.ts";
import type { ApplicationPatch, CapturedVersions, DemoSession, InputDependency, LicensePatch, ResultKind, TSAPatch } from "./session.ts";

export type SessionStorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SessionSnapshot = { session: DemoSession | null; ready: boolean; storageAvailable: boolean; recovered: boolean };
export type SessionOperationResult = { ok: true } | { ok: false; error: string };

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** One controller per mounted provider/tab. No browser APIs run during SSR. */
export function createDemoSessionController(storage: SessionStorageAccess, clock = () => new Date().toISOString()) {
  const initial: SessionSnapshot = freeze({ session: null, ready: false, storageAvailable: false, recovered: false });
  let snapshot = initial;
  const listeners = new Set<() => void>();
  function publish(next: SessionSnapshot) {
    snapshot = freeze(next);
    listeners.forEach((notify) => notify());
  }
  function removePersisted() {
    try { storage().removeItem(SESSION_STORAGE_KEY); } catch { /* Memory use stays available. */ }
  }
  function persist(json: string): boolean {
    try { storage().setItem(SESSION_STORAGE_KEY, json); return true; }
    catch {
      // Avoid resurrecting an older edit/reset snapshot if replacement hits quota.
      removePersisted();
      return false;
    }
  }
  function current() {
    if (!snapshot.session) throw new Error("Session is not ready");
    return snapshot.session;
  }
  function apply(transform: (session: DemoSession) => DemoSession): SessionOperationResult {
    try {
      const previous = current();
      const next = transform(previous);
      if (next === previous) return { ok: true };
      const json = serializeSession(next); // Reject oversized updates before publishing.
      const storageAvailable = persist(json);
      publish({ ...snapshot, session: next, storageAvailable });
      return { ok: true };
    } catch {
      return { ok: false, error: "Session update rejected. Check the record ID, fields and dependency versions." };
    }
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize() {
      if (snapshot.ready) return;
      let raw: string | null;
      try { raw = storage().getItem(SESSION_STORAGE_KEY); }
      catch { publish({ session: createDemoSession(clock()), ready: true, storageAvailable: false, recovered: false }); return; }
      let session: DemoSession;
      let recovered = false;
      try { session = raw === null ? createDemoSession(clock()) : parseSession(raw); }
      catch { recovered = true; removePersisted(); session = createDemoSession(clock()); }
      const storageAvailable = persist(serializeSession(session));
      publish({ session, ready: true, storageAvailable, recovered });
    },
    updateApplication: (id: string, patch: ApplicationPatch) => apply((state) => updateApplication(state, id, patch, clock())),
    updateLicense: (id: string, patch: LicensePatch) => apply((state) => updateLicense(state, id, patch, clock())),
    updateTSA: (id: string, patch: TSAPatch) => apply((state) => updateTSA(state, id, patch, clock())),
    publishApplications(side: Application["company_side"], applications: readonly Application[], expected: PublicationToken): PublicationResult {
      let rejection: PublicationBlock | undefined;
      let changed = false;
      const operation = apply((state) => {
        try {
          // Check the live controller token before consulting persistence or constructing a replacement.
          if (!expected || expected.session_id !== state.session_id || expected.session_revision !== state.session_revision) throw new PublicationFailure({ ok: false, code: "stale_session" });
          if (snapshot.storageAvailable) {
            let stored: string | null | undefined;
            try { stored = storage().getItem(SESSION_STORAGE_KEY); } catch { /* Existing memory fallback; persist below reports actual write availability. */ }
            if (stored !== undefined) {
              try { if (stored === null || JSON.stringify(parseSession(stored)) !== JSON.stringify(state)) throw new Error("Stored session mismatch"); }
              catch { throw new PublicationFailure({ ok: false, code: "invalid_storage" }); }
            }
          }
          const next = publishSessionApplications(state, side, applications, expected, clock());
          changed = next !== state;
          return next;
        } catch (error) {
          rejection = error instanceof PublicationFailure ? error.block : { ok: false, code: "invalid_session" };
          return state; // apply's identity path performs no persistence write or notification.
        }
      });
      if (rejection) return rejection;
      if (!operation.ok) return { ok: false, code: "invalid_session" };
      const session = current();
      return { ok: true, changed, source_revision: session.input_revisions.applications, session_id: session.session_id };
    },
    captureInputVersions: (dependencies: readonly InputDependency[]) => captureInputVersions(current(), dependencies),
    recordDerivedResultMetadata: (kind: ResultKind, dependencies: readonly InputDependency[], captured: CapturedVersions) => apply((state) => recordDerivedResultMetadata(state, kind, dependencies, captured, clock())),
    getResultFreshness: (kind: ResultKind) => snapshot.session ? getResultFreshness(snapshot.session, kind) : "missing" as const,
    resetDemoSession(): SessionOperationResult {
      const session = createDemoSession(clock());
      const storageAvailable = persist(serializeSession(session));
      publish({ session, ready: true, storageAvailable, recovered: false });
      return { ok: true };
    },
  };
}
export type DemoSessionController = ReturnType<typeof createDemoSessionController>;
