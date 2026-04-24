import { windowCommand } from "./windowCommand";

// Chromium (WebView2 on Windows) honors the CSS rule
// `-webkit-app-region: drag`, which starts a native window drag when the
// user presses inside a `.titlebar-drag` element. WKWebView on macOS — and
// WebKitGTK on Linux, both used by `wry` — ignore that rule entirely
// despite the `-webkit-` prefix (it's a Chromium/Electron extension that
// was never upstreamed to WebKit proper). The result is that on macOS /
// Apple Silicon the custom frameless titlebar is completely undraggable.
//
// The Rust side already supports a fallback: an IPC message of "drag" is
// routed to `tao::Window::drag_window()`, which begins a native drag on
// every supported platform (NSWindow.performWindowDragWithEvent: on macOS,
// equivalent calls on Linux). This helper installs one delegated
// pointerdown listener that sends that IPC whenever the user presses
// inside a `.titlebar-drag` element, on platforms where the native CSS
// path does NOT work.
//
// We intentionally do not call `preventDefault()` so the browser still
// dispatches `dblclick`, letting existing `onDoubleClick={() =>
// windowCommand("maximize")}` handlers continue to toggle maximize.

const INTERACTIVE_NO_DRAG_SELECTOR =
  "button, a, input, textarea, select, [role='button'], .titlebar-no-drag";

function isWindowsChromium(userAgent: string): boolean {
  return /Windows NT/i.test(userAgent);
}

export function shouldInstallNativeTitlebarDrag(
  userAgent: string,
  hasDesktopBridge: boolean,
): boolean {
  if (!hasDesktopBridge) return false;
  // Windows WebView2 already starts a native drag via -webkit-app-region;
  // adding a second JS-initiated drag would race with it.
  if (isWindowsChromium(userAgent)) return false;
  return true;
}

export function shouldStartNativeDrag(event: PointerEvent): boolean {
  if (event.button !== 0) return false;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return false;
  const dragRegion = target.closest<HTMLElement>(".titlebar-drag");
  if (!dragRegion) return false;
  const interactive = target.closest(INTERACTIVE_NO_DRAG_SELECTOR);
  // Only bail if the interactive element is inside (or equal to) the drag
  // region. A button OUTSIDE the drag region that happens to be an
  // ancestor of some overlay target is not our concern.
  if (interactive && dragRegion.contains(interactive)) return false;
  return true;
}

let installedHandler: ((event: PointerEvent) => void) | null = null;

export function installNativeTitlebarDrag(): void {
  if (installedHandler) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const hasDesktopBridge = typeof window.ipc?.postMessage === "function";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (!shouldInstallNativeTitlebarDrag(userAgent, hasDesktopBridge)) return;

  const handler = (event: PointerEvent) => {
    if (!shouldStartNativeDrag(event)) return;
    windowCommand("drag");
  };
  document.addEventListener("pointerdown", handler, { capture: true });
  installedHandler = handler;
}

// Exposed for tests.
export function __resetNativeTitlebarDragForTests(): void {
  if (installedHandler && typeof document !== "undefined") {
    document.removeEventListener("pointerdown", installedHandler, {
      capture: true,
    } as EventListenerOptions);
  }
  installedHandler = null;
}
