let hasSignaledDesktopReady = false;

export function signalDesktopReady(): void {
  if (hasSignaledDesktopReady || typeof window === "undefined") {
    return;
  }
  hasSignaledDesktopReady = true;
  window.ipc?.postMessage("ready");
}
