"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createDemoSessionController } from "../lib/session/controller";
import type { DemoSessionController } from "../lib/session/controller";

const DemoSessionContext = createContext<DemoSessionController | null>(null);

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createDemoSessionController(() => window.sessionStorage));
  useEffect(() => { controller.initialize(); }, [controller]);
  return <DemoSessionContext.Provider value={controller}>{children}</DemoSessionContext.Provider>;
}

/** Shared typed API for later module components; no per-module store. */
export function useDemoSession() {
  const controller = useContext(DemoSessionContext);
  if (!controller) throw new Error("useDemoSession requires DemoSessionProvider");
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  return { ...controller, ...snapshot };
}
