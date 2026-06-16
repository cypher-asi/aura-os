export const DESKTOP_REVEAL_TIMER_FALLBACK_MS = 750;

/**
 * Schedule the native-window reveal after a paint when the browser is visible,
 * but keep a timer fallback for hidden desktop webviews. WKWebView can pause
 * requestAnimationFrame while the containing native window is hidden, and the
 * desktop starts hidden until this reveal callback posts IPC.
 */
export function scheduleDesktopReveal(
  callback: () => void,
  fallbackMs = DESKTOP_REVEAL_TIMER_FALLBACK_MS,
): void {
  let finished = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (timerId !== null && typeof clearTimeout === "function") {
      clearTimeout(timerId);
    }
    callback();
  };

  if (typeof setTimeout === "function") {
    timerId = setTimeout(finish, fallbackMs);
  }

  if (typeof window === "undefined") {
    if (timerId === null) finish();
    return;
  }

  const requestAnimationFrame = window.requestAnimationFrame?.bind(window);
  if (!requestAnimationFrame) {
    if (timerId === null) finish();
    return;
  }

  requestAnimationFrame(() => requestAnimationFrame(finish));
}
