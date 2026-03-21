export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Failed to register service worker", error);
    });
  });
}
