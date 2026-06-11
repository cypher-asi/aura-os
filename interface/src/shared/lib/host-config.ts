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

// Build-time cloud control-plane origin (the prod aura-os-server that runs the
// central Telegram bot + link store). Reuses `VITE_NATIVE_DEFAULT_HOST`, which
// the desktop build bakes to the prod API.
export function getControlPlaneHostOrigin(): string | null {
  return normalizeHostOrigin(import.meta.env.VITE_NATIVE_DEFAULT_HOST);
}

// Resolve a URL for endpoints that must hit the shared cloud control-plane
// regardless of which server the app is otherwise talking to. The Telegram
// bridge (poller + pending/durable link store) is a single authority on prod,
// so link/list/disconnect must target it even on desktop, where the general
// host is the bundled local server (`?host=` wins in `getTargetHostOrigin`).
// Falls back to the normal host resolution when no cloud origin is configured
// (e.g. web/local dev), preserving existing behavior there.
export function resolveControlPlaneUrl(path: string): string {
  const cloud = getControlPlaneHostOrigin();
  return cloud ? `${cloud}${path}` : resolveApiUrl(path);
}

// Prod origin that serves the public marketing content (blog, the AURA OS
// whitepaper, docs). Mirrors the control-plane host convention
// (`VITE_NATIVE_DEFAULT_HOST`, which release builds bake to
// `https://api.aura.ai`); falls back to that same origin so local web dev,
// where the env var is unset, still has a target.
export function getProdPublicContentHostOrigin(): string | null {
  return getControlPlaneHostOrigin() ?? normalizeHostOrigin("https://api.aura.ai");
}

// Resolve a public marketing content endpoint (blog, whitepaper, docs). The
// local server usually has no storage configured, so this content is empty in
// any dev build; point it at prod instead. This intentionally ignores the
// configured/bootstrap host (native dev shells always set one via `?host=`),
// since it is public content that should always come from prod during
// development. Production builds keep their normal same-origin / configured-
// host behavior, which on prod/native already resolves to the prod host.
export function resolvePublicContentApiUrl(path: string): string {
  if (import.meta.env.DEV) {
    const prod = getProdPublicContentHostOrigin();
    if (prod) return `${prod}${path}`;
  }
  return resolveApiUrl(path);
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
