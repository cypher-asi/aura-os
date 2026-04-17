import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { AuraApp } from "../apps/types";
import { resolveActiveApp } from "../stores/app-store";

/**
 * Resolves the currently-active app from the router's pathname.
 *
 * Deriving the active app synchronously from `useLocation()` (instead of
 * mirroring it into a zustand store via `useEffect`) ensures that shell
 * chrome — MainPanel, LeftPanel, SidekickPanel, etc. — is always in lockstep
 * with the URL. This eliminates the render where `activeApp` is stale after a
 * `navigate()` call, which previously allowed the outgoing panel to run
 * URL-driven effects that could hijack the new route.
 */
export function useActiveApp(): AuraApp {
  const { pathname } = useLocation();
  return useMemo(() => resolveActiveApp(pathname), [pathname]);
}

/** Convenience helper for consumers that only need the id. */
export function useActiveAppId(): string {
  return useActiveApp().id;
}
