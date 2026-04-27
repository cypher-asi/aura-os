let hasSignaledDesktopSplashReady = false;
let hasSignaledDesktopAppReady = false;

export function signalDesktopSplashReady(): void {
  if (hasSignaledDesktopSplashReady || typeof window === "undefined") {
    return;
  }
  hasSignaledDesktopSplashReady = true;
  window.ipc?.postMessage("splash-ready");
}

export function signalDesktopReady(): void {
  if (hasSignaledDesktopAppReady || typeof window === "undefined") {
    return;
  }
  hasSignaledDesktopAppReady = true;
  window.ipc?.postMessage("app-ready");
}
