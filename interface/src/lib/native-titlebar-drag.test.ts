import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetNativeTitlebarDragForTests,
  installNativeTitlebarDrag,
  shouldInstallNativeTitlebarDrag,
  shouldStartNativeDrag,
} from "./native-titlebar-drag";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64)";

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

function mountDragBar(innerHtml: string): HTMLElement {
  document.body.innerHTML = `<div class="titlebar-drag" data-testid="bar">${innerHtml}</div>`;
  return document.querySelector<HTMLElement>('[data-testid="bar"]')!;
}

function firePointerDown(target: Element, init: PointerEventInit = {}) {
  // jsdom lacks PointerEvent; fall back to MouseEvent with pointer-ish shape.
  const PointerEventCtor =
    (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
    (class extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    } as unknown as typeof PointerEvent);
  const event = new PointerEventCtor("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("shouldInstallNativeTitlebarDrag", () => {
  it("skips when no desktop bridge is present", () => {
    expect(shouldInstallNativeTitlebarDrag(MAC_UA, false)).toBe(false);
  });

  it("skips on Windows where -webkit-app-region already works", () => {
    expect(shouldInstallNativeTitlebarDrag(WIN_UA, true)).toBe(false);
  });

  it("activates on macOS when the desktop bridge is available", () => {
    expect(shouldInstallNativeTitlebarDrag(MAC_UA, true)).toBe(true);
  });

  it("activates on Linux (WebKitGTK) when the desktop bridge is available", () => {
    expect(shouldInstallNativeTitlebarDrag(LINUX_UA, true)).toBe(true);
  });
});

describe("shouldStartNativeDrag", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns true for a plain pointerdown inside .titlebar-drag", () => {
    const bar = mountDragBar("<span id='label'>AURA</span>");
    const event = firePointerDown(document.getElementById("label")!);
    expect(shouldStartNativeDrag(event)).toBe(true);
    expect(bar).toBeDefined();
  });

  it("returns false when target is outside any .titlebar-drag", () => {
    document.body.innerHTML = '<div id="outside">not a titlebar</div>';
    const event = firePointerDown(document.getElementById("outside")!);
    expect(shouldStartNativeDrag(event)).toBe(false);
  });

  it("returns false when the target is a button inside the drag region", () => {
    mountDragBar('<button id="btn">x</button>');
    const event = firePointerDown(document.getElementById("btn")!);
    expect(shouldStartNativeDrag(event)).toBe(false);
  });

  it("returns false when the target is inside .titlebar-no-drag", () => {
    mountDragBar(
      '<div class="titlebar-no-drag"><span id="ctrl">minimize</span></div>',
    );
    const event = firePointerDown(document.getElementById("ctrl")!);
    expect(shouldStartNativeDrag(event)).toBe(false);
  });

  it("returns false for non-primary mouse buttons", () => {
    mountDragBar("<span id='label'>AURA</span>");
    const event = firePointerDown(document.getElementById("label")!, {
      button: 2,
    });
    expect(shouldStartNativeDrag(event)).toBe(false);
  });
});

describe("installNativeTitlebarDrag", () => {
  const originalIpc = window.ipc;

  beforeEach(() => {
    __resetNativeTitlebarDragForTests();
    setUserAgent(MAC_UA);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.ipc = originalIpc;
    __resetNativeTitlebarDragForTests();
    document.body.innerHTML = "";
    setUserAgent(MAC_UA);
  });

  it("sends a drag IPC on pointerdown inside a .titlebar-drag region on macOS", () => {
    const postMessage = vi.fn();
    window.ipc = { postMessage };
    installNativeTitlebarDrag();
    mountDragBar("<span id='label'>AURA</span>");

    firePointerDown(document.getElementById("label")!);

    expect(postMessage).toHaveBeenCalledWith("drag");
  });

  it("does not send drag IPC when target is an interactive control", () => {
    const postMessage = vi.fn();
    window.ipc = { postMessage };
    installNativeTitlebarDrag();
    mountDragBar('<button id="btn">x</button>');

    firePointerDown(document.getElementById("btn")!);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not preventDefault so dblclick still fires", () => {
    window.ipc = { postMessage: vi.fn() };
    installNativeTitlebarDrag();
    mountDragBar("<span id='label'>AURA</span>");

    const event = firePointerDown(document.getElementById("label")!);

    expect(event.defaultPrevented).toBe(false);
  });

  it("is a no-op without a desktop bridge", () => {
    delete (window as Window & { ipc?: unknown }).ipc;
    installNativeTitlebarDrag();
    mountDragBar("<span id='label'>AURA</span>");
    // If the listener had been installed, firing pointerdown would crash
    // when it tried to call `window.ipc.postMessage`. The absence of a
    // throw IS the assertion here.
    firePointerDown(document.getElementById("label")!);
  });

  it("is a no-op on Windows where -webkit-app-region already works", () => {
    setUserAgent(WIN_UA);
    const postMessage = vi.fn();
    window.ipc = { postMessage };
    installNativeTitlebarDrag();
    mountDragBar("<span id='label'>AURA</span>");

    firePointerDown(document.getElementById("label")!);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
