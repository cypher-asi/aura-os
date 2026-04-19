const PRELOAD_RECOVERY_KEY = "aura-preload-recovery";

type PreloadRecoveryWindow = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  location: Pick<Location, "reload">;
};

export function installPreloadRecoveryForRuntime({
  isProd,
  runtimeWindow,
}: {
  isProd: boolean;
  runtimeWindow: PreloadRecoveryWindow | undefined;
}): void {
  if (!isProd || !runtimeWindow) {
    return;
  }

  runtimeWindow.addEventListener("vite:preloadError", (event) => {
    const errorEvent = event as Event & { preventDefault: () => void };
    errorEvent.preventDefault();

    if (runtimeWindow.sessionStorage.getItem(PRELOAD_RECOVERY_KEY)) {
      console.error("Vite preload recovery already attempted for this session", event);
      return;
    }

    runtimeWindow.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, "1");
    runtimeWindow.location.reload();
  });
}

export function installPreloadRecovery(): void {
  installPreloadRecoveryForRuntime({
    isProd: import.meta.env.PROD,
    runtimeWindow: typeof window === "undefined" ? undefined : window,
  });
}
