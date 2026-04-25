import { isNativeRuntime } from "../shared/lib/native-runtime";

const NATIVE_SW_RESET_KEY = "aura-native-sw-reset";

type ServiceWorkerRegistrationLike = {
  unregister: () => Promise<boolean> | boolean;
};

type ServiceWorkerContainerLike = {
  getRegistrations: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
  register: (url: string) => Promise<unknown>;
};

type CacheStorageLike = {
  keys: () => Promise<string[]>;
  delete: (key: string) => Promise<boolean> | boolean;
};

type WindowLike = {
  addEventListener: (type: string, listener: () => void | Promise<void>) => void;
  sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  location: Pick<Location, "reload">;
  caches?: CacheStorageLike;
};

type NavigatorLike = {
  serviceWorker?: ServiceWorkerContainerLike;
};

export async function clearNativeServiceWorkerCachesForRuntime(
  runtimeWindow: WindowLike | undefined,
  runtimeNavigator: NavigatorLike | undefined,
) {
  if (!runtimeWindow || !runtimeNavigator?.serviceWorker) {
    return;
  }

  const registrations = await runtimeNavigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  const caches = runtimeWindow.caches;
  if (caches) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if (registrations.length > 0 && !runtimeWindow.sessionStorage.getItem(NATIVE_SW_RESET_KEY)) {
    runtimeWindow.sessionStorage.setItem(NATIVE_SW_RESET_KEY, "1");
    runtimeWindow.location.reload();
    return;
  }

  runtimeWindow.sessionStorage.removeItem(NATIVE_SW_RESET_KEY);
}

export function registerServiceWorkerForRuntime({
  isProd,
  runtimeWindow,
  runtimeNavigator,
  nativeRuntime,
}: {
  isProd: boolean;
  runtimeWindow: WindowLike | undefined;
  runtimeNavigator: NavigatorLike | undefined;
  nativeRuntime: boolean;
}): void {
  if (!isProd || !runtimeWindow) {
    return;
  }

  const serviceWorker = runtimeNavigator?.serviceWorker;
  if (!serviceWorker) {
    return;
  }

  if (nativeRuntime) {
    runtimeWindow.addEventListener("load", () => {
      void clearNativeServiceWorkerCachesForRuntime(runtimeWindow, runtimeNavigator).catch((error) => {
        console.error("Failed to clear native service worker caches", error);
      });
    });
    return;
  }

  runtimeWindow.addEventListener("load", () => {
    serviceWorker.register("/sw.js").catch((error) => {
      console.error("Failed to register service worker", error);
    });
  });
}

export function registerServiceWorker(): void {
  registerServiceWorkerForRuntime({
    isProd: import.meta.env.PROD,
    runtimeWindow: typeof window === "undefined" ? undefined : window,
    runtimeNavigator: typeof navigator === "undefined" ? undefined : navigator,
    nativeRuntime: isNativeRuntime(),
  });
}
