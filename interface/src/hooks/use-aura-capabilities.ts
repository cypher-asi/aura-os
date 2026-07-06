import { useEffect, useSyncExternalStore } from "react";
import { resolveApiUrl, subscribeToHostChanges } from "../shared/lib/host-config";
import { isNativeRuntime } from "../shared/lib/native-runtime";

export const AURA_BREAKPOINTS = {
  phoneMax: 680,
  tabletMax: 900,
} as const;

const PHONE_MEDIA_QUERY = `(max-width: ${AURA_BREAKPOINTS.phoneMax}px)`;
const TABLET_MEDIA_QUERY = `(max-width: ${AURA_BREAKPOINTS.tabletMax}px)`;
const COARSE_POINTER_MEDIA_QUERY = "(pointer: coarse)";
const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

export interface AuraFeatureAvailability {
  windowControls: boolean;
  linkedWorkspace: boolean;
  nativeUpdater: boolean;
  hostRetargeting: boolean;
  ideIntegration: boolean;
}

export interface AuraCapabilities {
  hasDesktopBridge: boolean;
  remoteOnly: boolean;
  localAgentRuntimeAvailable: boolean;
  hostedLocalHarness: boolean;
  serverRemoteOnly: boolean;
  isMobileClient: boolean;
  isMobileLayout: boolean;
  isPhoneLayout: boolean;
  isTabletLayout: boolean;
  isStandalone: boolean;
  isNativeApp: boolean;
  features: AuraFeatureAvailability;
  supportsWindowControls: boolean;
  supportsDesktopWorkspace: boolean;
  supportsNativeUpdates: boolean;
  supportsHostRetargeting: boolean;
}

interface ServerRuntimeCapabilities {
  remoteOnly: boolean;
  localAgentRuntimeAvailable: boolean;
  hostedLocalHarness: boolean;
}

const RUNTIME_CAPABILITIES_PATH = "/api/system/runtime-capabilities";

function buildFeatureAvailability(hasDesktopBridge: boolean): AuraFeatureAvailability {
  return {
    windowControls: hasDesktopBridge,
    linkedWorkspace: hasDesktopBridge,
    nativeUpdater: hasDesktopBridge,
    hostRetargeting: !hasDesktopBridge,
    ideIntegration: hasDesktopBridge,
  };
}

let serverRuntimeCapabilities: ServerRuntimeCapabilities | null = null;
let runtimeCapabilitiesStatus: "idle" | "loading" | "loaded" | "failed" = "idle";
let runtimeCapabilitiesRequest: Promise<void> | null = null;

function isServerRuntimeCapabilities(value: unknown): value is ServerRuntimeCapabilities {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Partial<ServerRuntimeCapabilities>;
  return (
    typeof candidate.remoteOnly === "boolean" &&
    typeof candidate.localAgentRuntimeAvailable === "boolean" &&
    typeof candidate.hostedLocalHarness === "boolean"
  );
}

function localAgentRuntimeAvailable(hasDesktopBridge: boolean): boolean {
  if (serverRuntimeCapabilities?.remoteOnly === true) return false;
  return hasDesktopBridge || serverRuntimeCapabilities?.localAgentRuntimeAvailable === true;
}

function resetRuntimeCapabilities() {
  serverRuntimeCapabilities = null;
  runtimeCapabilitiesStatus = "idle";
  runtimeCapabilitiesRequest = null;
}

function requestRuntimeCapabilities(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (runtimeCapabilitiesStatus === "loaded" || runtimeCapabilitiesStatus === "loading") {
    return runtimeCapabilitiesRequest ?? Promise.resolve();
  }
  runtimeCapabilitiesStatus = "loading";
  runtimeCapabilitiesRequest = fetch(resolveApiUrl(RUNTIME_CAPABILITIES_PATH), {
    credentials: "include",
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) {
        runtimeCapabilitiesStatus = "failed";
        return;
      }
      const data: unknown = await response.json();
      if (!isServerRuntimeCapabilities(data)) {
        runtimeCapabilitiesStatus = "failed";
        return;
      }
      serverRuntimeCapabilities = data;
      runtimeCapabilitiesStatus = "loaded";
      scheduleRecompute();
    })
    .catch(() => {
      runtimeCapabilitiesStatus = "failed";
    });
  return runtimeCapabilitiesRequest;
}

function readCapabilities(): AuraCapabilities {
  if (typeof window === "undefined") {
    const features = buildFeatureAvailability(false);
    return {
      hasDesktopBridge: false,
      remoteOnly: true,
      localAgentRuntimeAvailable: false,
      hostedLocalHarness: false,
      serverRemoteOnly: false,
      isMobileClient: false,
      isMobileLayout: false,
      isPhoneLayout: false,
      isTabletLayout: false,
      isStandalone: false,
      isNativeApp: false,
      features,
      supportsWindowControls: features.windowControls,
      supportsDesktopWorkspace: features.linkedWorkspace,
      supportsNativeUpdates: features.nativeUpdater,
      supportsHostRetargeting: features.hostRetargeting,
    };
  }

  const hasDesktopBridge = typeof window.ipc?.postMessage === "function";
  const hasMatchMedia = typeof window.matchMedia === "function";
  const isPhoneLayout = hasMatchMedia && window.matchMedia(PHONE_MEDIA_QUERY).matches;
  const isTabletLayout =
    hasMatchMedia &&
    (window.matchMedia(TABLET_MEDIA_QUERY).matches ||
      window.matchMedia(COARSE_POINTER_MEDIA_QUERY).matches);
  const isMobileLayout = isTabletLayout;
  const isStandalone =
    (hasMatchMedia && window.matchMedia(STANDALONE_MEDIA_QUERY).matches) ||
    (typeof navigator !== "undefined" && "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const isNativeApp = isNativeRuntime();
  const isMobileUserAgent =
    typeof navigator !== "undefined" &&
    (
      ("userAgentData" in navigator && Boolean((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile)) ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    );
  const isMobileClient = isNativeApp || isMobileUserAgent;
  const features = buildFeatureAvailability(hasDesktopBridge);
  const localRuntimeAvailable = localAgentRuntimeAvailable(hasDesktopBridge);

  return {
    hasDesktopBridge,
    remoteOnly: !localRuntimeAvailable,
    localAgentRuntimeAvailable: localRuntimeAvailable,
    hostedLocalHarness: serverRuntimeCapabilities?.hostedLocalHarness === true,
    serverRemoteOnly: serverRuntimeCapabilities?.remoteOnly === true,
    isMobileClient,
    isMobileLayout,
    isPhoneLayout,
    isTabletLayout,
    isStandalone,
    isNativeApp,
    features,
    supportsWindowControls: features.windowControls,
    supportsDesktopWorkspace: features.linkedWorkspace,
    supportsNativeUpdates: features.nativeUpdater,
    supportsHostRetargeting: features.hostRetargeting,
  };
}

function featuresEqual(a: AuraFeatureAvailability, b: AuraFeatureAvailability): boolean {
  return (
    a.windowControls === b.windowControls &&
    a.linkedWorkspace === b.linkedWorkspace &&
    a.nativeUpdater === b.nativeUpdater &&
    a.hostRetargeting === b.hostRetargeting &&
    a.ideIntegration === b.ideIntegration
  );
}

function capabilitiesEqual(a: AuraCapabilities, b: AuraCapabilities): boolean {
  return (
    a.hasDesktopBridge === b.hasDesktopBridge &&
    a.remoteOnly === b.remoteOnly &&
    a.localAgentRuntimeAvailable === b.localAgentRuntimeAvailable &&
    a.hostedLocalHarness === b.hostedLocalHarness &&
    a.serverRemoteOnly === b.serverRemoteOnly &&
    a.isMobileClient === b.isMobileClient &&
    a.isMobileLayout === b.isMobileLayout &&
    a.isPhoneLayout === b.isPhoneLayout &&
    a.isTabletLayout === b.isTabletLayout &&
    a.isStandalone === b.isStandalone &&
    a.isNativeApp === b.isNativeApp &&
    a.supportsWindowControls === b.supportsWindowControls &&
    a.supportsDesktopWorkspace === b.supportsDesktopWorkspace &&
    a.supportsNativeUpdates === b.supportsNativeUpdates &&
    a.supportsHostRetargeting === b.supportsHostRetargeting &&
    featuresEqual(a.features, b.features)
  );
}

// Shared snapshot + subscription model.
//
// `useAuraCapabilities` is called from dozens of components. With a per-hook
// `useState` + `window.addEventListener("resize", ...)` setup, every single
// resize event fired ~N listeners that each called `setState` with a *new*
// object reference, forcing every consumer to re-render on every resize frame
// — even when no breakpoint actually changed. That's what made the window
// feel sluggish during live resize.
//
// Instead, we maintain one module-level snapshot and one set of listeners
// (installed lazily on first subscription, torn down on last unsubscription).
// `useSyncExternalStore` hands every consumer the same cached snapshot, and
// we only rotate that snapshot when a field actually changed (shallow equal)
// — so drags within a breakpoint cause zero React work across all consumers.
// Resize bursts are coalesced via `requestAnimationFrame`.

type Listener = () => void;

let cachedSnapshot: AuraCapabilities = readCapabilities();
const listeners = new Set<Listener>();

let phoneQuery: MediaQueryList | null = null;
let tabletQuery: MediaQueryList | null = null;
let pointerQuery: MediaQueryList | null = null;
let displayQuery: MediaQueryList | null = null;
let unsubscribeHostChanges: (() => void) | null = null;
let rafHandle: number | null = null;

function recompute() {
  rafHandle = null;
  const next = readCapabilities();
  if (capabilitiesEqual(cachedSnapshot, next)) return;
  cachedSnapshot = next;
  for (const listener of listeners) listener();
}

function scheduleRecompute() {
  if (typeof window === "undefined") {
    recompute();
    return;
  }
  if (rafHandle !== null) return;
  if (typeof window.requestAnimationFrame === "function") {
    rafHandle = window.requestAnimationFrame(recompute);
  } else {
    rafHandle = window.setTimeout(recompute, 0) as unknown as number;
  }
}

function attachListeners() {
  if (typeof window === "undefined") return;
  if (typeof window.matchMedia === "function") {
    phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);
    tabletQuery = window.matchMedia(TABLET_MEDIA_QUERY);
    pointerQuery = window.matchMedia(COARSE_POINTER_MEDIA_QUERY);
    displayQuery = window.matchMedia(STANDALONE_MEDIA_QUERY);

    phoneQuery.addEventListener("change", scheduleRecompute);
    tabletQuery.addEventListener("change", scheduleRecompute);
    pointerQuery.addEventListener("change", scheduleRecompute);
    displayQuery.addEventListener("change", scheduleRecompute);
  }
  unsubscribeHostChanges = subscribeToHostChanges(() => {
    resetRuntimeCapabilities();
    scheduleRecompute();
    void requestRuntimeCapabilities();
  });
  window.addEventListener("resize", scheduleRecompute);
}

function detachListeners() {
  if (typeof window === "undefined") return;
  phoneQuery?.removeEventListener("change", scheduleRecompute);
  tabletQuery?.removeEventListener("change", scheduleRecompute);
  pointerQuery?.removeEventListener("change", scheduleRecompute);
  displayQuery?.removeEventListener("change", scheduleRecompute);
  unsubscribeHostChanges?.();
  unsubscribeHostChanges = null;
  window.removeEventListener("resize", scheduleRecompute);
  phoneQuery = null;
  tabletQuery = null;
  pointerQuery = null;
  displayQuery = null;

  if (rafHandle !== null) {
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(rafHandle);
    } else {
      window.clearTimeout(rafHandle);
    }
    rafHandle = null;
  }
}

function subscribe(listener: Listener): () => void {
  if (listeners.size === 0) {
    attachListeners();
    // The snapshot was computed at module load; recompute once on first
    // subscription so we pick up any changes that happened before React
    // mounted (e.g. user resized the viewport before hydration).
    const fresh = readCapabilities();
    if (!capabilitiesEqual(cachedSnapshot, fresh)) {
      cachedSnapshot = fresh;
    }
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachListeners();
    }
  };
}

function getSnapshot(): AuraCapabilities {
  return cachedSnapshot;
}

function getServerSnapshot(): AuraCapabilities {
  return cachedSnapshot;
}

export function useAuraCapabilities(): AuraCapabilities {
  const capabilities = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void requestRuntimeCapabilities();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.dataset.mobileClient = capabilities.isMobileClient ? "true" : "false";
    root.dataset.mobileLayout = capabilities.isMobileLayout ? "true" : "false";

    return () => {
      delete root.dataset.mobileClient;
      delete root.dataset.mobileLayout;
    };
  }, [capabilities.isMobileClient, capabilities.isMobileLayout]);

  return capabilities;
}

export function resetAuraCapabilitiesForTests() {
  resetRuntimeCapabilities();
  cachedSnapshot = readCapabilities();
}
