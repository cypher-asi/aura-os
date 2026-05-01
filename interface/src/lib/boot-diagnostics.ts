const BOOT_STATUS_KEY = "aura-boot-diagnostics";
const MAX_ENTRIES = 20;

type BootStatusBridge = {
  mark?: (phase: string) => void;
  fail?: (message: string, detail?: string) => void;
  clear?: () => void;
};

type BootDiagnosticEntry = {
  at: string;
  kind: "phase" | "error";
  phase: string;
  message?: string;
};

let handlersInstalled = false;

function bootStatusBridge(): BootStatusBridge | undefined {
  return typeof window === "undefined" ? undefined : window.__AURA_BOOT_STATUS__;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "Unknown error";
}

function readEntries(): BootDiagnosticEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BOOT_STATUS_KEY);
    const parsed = raw ? (JSON.parse(raw) as BootDiagnosticEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntry(entry: BootDiagnosticEntry): void {
  if (typeof window === "undefined") return;
  try {
    const entries = [...readEntries(), entry].slice(-MAX_ENTRIES);
    window.localStorage.setItem(BOOT_STATUS_KEY, JSON.stringify(entries));
  } catch {
    // Boot diagnostics must never become another startup failure.
  }
}

export function markBootPhase(phase: string): void {
  writeEntry({ at: new Date().toISOString(), kind: "phase", phase });
  bootStatusBridge()?.mark?.(phase);
  console.info("[aura-boot]", phase);
}

export function reportBootError(phase: string, error: unknown): void {
  const message = safeMessage(error);
  writeEntry({ at: new Date().toISOString(), kind: "error", phase, message });
  bootStatusBridge()?.fail?.("AURA hit a startup error.", `${phase}: ${message}`);
  console.error(`[aura-boot] ${phase} failed`, error);
}

export function clearBootStatus(): void {
  bootStatusBridge()?.clear?.();
}

export function installBootErrorHandlers(): void {
  if (handlersInstalled || typeof window === "undefined") {
    return;
  }
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    const target = event.target as HTMLElement | null;
    let src = "";
    if (target instanceof HTMLScriptElement) {
      src = target.src;
    } else if (target instanceof HTMLLinkElement) {
      src = target.href;
    }
    reportBootError("window error", event.error ?? event.message ?? src);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportBootError("unhandled promise rejection", event.reason);
  });
}
