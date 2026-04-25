import { inferNativePlatform, isNativeRuntime } from "./native-runtime";

const HOST_STORAGE_KEY = "aura-host-origin";
const HOST_CHANGE_EVENT = "aura-host-change";

function hasWindow() {
  return typeof window !== "undefined";
}

function readNativeDefaultHostCandidate(): string | null {
  const platform = inferNativePlatform();
  const genericDefaultHost = import.meta.env.VITE_NATIVE_DEFAULT_HOST || null;
  const androidDefaultHost = import.meta.env.VITE_ANDROID_DEFAULT_HOST || null;
  const iosDefaultHost = import.meta.env.VITE_IOS_DEFAULT_HOST || null;

  if (platform === "android") {
    return androidDefaultHost || genericDefaultHost || iosDefaultHost;
  }

  if (platform === "ios") {
    return iosDefaultHost || genericDefaultHost || androidDefaultHost;
  }

  return iosDefaultHost || androidDefaultHost || genericDefaultHost;
}

export function normalizeHostOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getStoredHostOrigin(): string | null {
  if (!hasWindow()) return null;
  return normalizeHostOrigin(window.localStorage.getItem(HOST_STORAGE_KEY));
}

export function getQueryHostOrigin(): string | null {
  if (!hasWindow()) return null;
  return normalizeHostOrigin(new URLSearchParams(window.location.search).get("host"));
}

export function getConfiguredHostOrigin(): string | null {
  return getQueryHostOrigin() ?? getStoredHostOrigin();
}

// Desktop/native shells bootstrap the webview with `?host=...`. SPA navigation
// can drop that query string, causing later requests to fall back to a stale
// localStorage value. Persist the bootstrap host into storage on startup so it
// survives navigation.
export function syncQueryHostOriginToStorage(): string | null {
  if (!hasWindow()) return null;
  const queryHost = getQueryHostOrigin();
  if (!queryHost) return null;
  if (getStoredHostOrigin() === queryHost) return queryHost;
  return setConfiguredHostOrigin(queryHost);
}

export function getNativeDefaultHostOrigin(): string | null {
  if (!requiresExplicitHostOrigin()) return null;
  return normalizeHostOrigin(readNativeDefaultHostCandidate());
}

export function getTargetHostOrigin(): string | null {
  // Keep precedence explicit so native shells can have a build-time default
  // without overriding a user-selected host in Settings.
  // VITE_API_URL is the lowest priority — a user-configured host or native
  // default always wins.
  return getConfiguredHostOrigin() ?? getNativeDefaultHostOrigin() ?? normalizeHostOrigin(import.meta.env.VITE_API_URL);
}

export function getResolvedHostOrigin(): string {
  if (!hasWindow()) return "";
  const targetHost = getTargetHostOrigin();
  if (requiresExplicitHostOrigin() && !targetHost) return "";
  return targetHost ?? window.location.origin;
}

export function requiresExplicitHostOrigin(): boolean {
  return isNativeRuntime();
}

export function setConfiguredHostOrigin(value: string | null): string | null {
  if (!hasWindow()) return null;

  const normalized = normalizeHostOrigin(value);
  if (normalized) {
    window.localStorage.setItem(HOST_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(HOST_STORAGE_KEY);
  }

  window.dispatchEvent(new CustomEvent(HOST_CHANGE_EVENT, { detail: { origin: normalized } }));
  return normalized;
}

export function subscribeToHostChanges(callback: () => void): () => void {
  if (!hasWindow()) return () => {};

  const onCustomChange = () => callback();
  const onStorage = (event: StorageEvent) => {
    if (event.key === HOST_STORAGE_KEY) callback();
  };

  window.addEventListener(HOST_CHANGE_EVENT, onCustomChange);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(HOST_CHANGE_EVENT, onCustomChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function resolveApiUrl(path: string): string {
  const hostOrigin = getTargetHostOrigin();
  return hostOrigin ? `${hostOrigin}${path}` : path;
}

export function resolveWsUrl(path: string): string {
  if (!hasWindow()) return path;

  const targetHost = getTargetHostOrigin();
  if (targetHost) {
    const url = new URL(targetHost);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function getHostDisplayLabel(): string {
  const configuredHost = getConfiguredHostOrigin();
  if (configuredHost) return configuredHost;
  const defaultHost = getNativeDefaultHostOrigin();
  if (defaultHost) return `${defaultHost} (build default)`;
  if (requiresExplicitHostOrigin()) return "No host configured";
  return "Current origin";
}
