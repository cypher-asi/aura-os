const HOST_STORAGE_KEY = "aura-host-origin";
const HOST_CHANGE_EVENT = "aura-host-change";

function hasWindow() {
  return typeof window !== "undefined";
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

export function getResolvedHostOrigin(): string {
  if (!hasWindow()) return "";
  return getConfiguredHostOrigin() ?? window.location.origin;
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
  const hostOrigin = getConfiguredHostOrigin();
  return hostOrigin ? `${hostOrigin}${path}` : path;
}

export function resolveWsUrl(path: string): string {
  if (!hasWindow()) return path;

  const configuredHost = getConfiguredHostOrigin();
  if (configuredHost) {
    const url = new URL(configuredHost);
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
  return "Current origin";
}
