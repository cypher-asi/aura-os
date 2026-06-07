/**
 * Behavioural test for the public-empty-state hero (`MockAuraApp` +
 * `DMWindowManager`). Pins the contracts that protect both the
 * windowed visual frame and the looping DM-driven animation:
 *
 *   1. The mock app frame mounts with its decorative chrome — the
 *      real `ShellTitlebar` pill (with the AURA wordmark `<img>`
 *      in its title slot) overlaid via `.topChrome` and the three
 *      bottom dock pills overlaid via `.bottomChrome` — even before
 *      any DM frame has fired. The top/bottom overlays are pinned
 *      via dedicated `data-testid` hooks so the assertion does not
 *      depend on internal class names.
 *   2. With no `desktopBackgroundUrl` supplied (the NO_THEME case)
 *      no wallpaper layer mounts at all — the frame's own dark
 *      fill paints through. Supplying a URL mounts an `<img>`
 *      wallpaper.
 *   3. The DM window manager starts empty — no script frame is
 *      rendered eagerly. The first window pops open only after the
 *      `setTimeout` chain advances past the initial 250ms warm-up.
 *   4. Two distinct threads' frames land in two distinct DM
 *      windows: the architect_frontend thread's first frame
 *      streams into one window while the architect_backend
 *      thread's first frame streams into a separate window —
 *      proving the manager routes by `thread` id rather than
 *      stacking every frame into one window.
 *   5. The decorative window manager is `aria-hidden` so the
 *      looping content never bleeds into the assistive-tech tree.
 *      The top/bottom chrome overlays are also `aria-hidden`
 *      because they're decorative with no semantic value.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MockAuraApp } from "./MockAuraApp";
import { deriveChatPalette } from "./derive-chat-palette";
import {
  SCRIPT,
  type MessageFrame,
} from "../agent-demo-script";
import { PERSONAS } from "../personas";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MockAuraApp", () => {
  it("mounts the windowed chrome with titlebar pill and bottom dock pills, and no wallpaper layer in the NO_THEME case", () => {
    render(<MockAuraApp />);

    expect(screen.getByTestId("mock-aura-app")).toBeInTheDocument();

    // The AURA wordmark is now an <img alt="AURA"> rendered by
    // `ShellTitlebar`'s title slot rather than visible text.
    expect(screen.getByAltText("AURA")).toBeInTheDocument();

    const topChrome = screen.getByTestId("mock-aura-top-chrome");
    expect(topChrome).toBeInTheDocument();
    expect(topChrome).toHaveAttribute("aria-hidden", "true");

    const bottomChrome = screen.getByTestId("mock-aura-bottom-chrome");
    expect(bottomChrome).toBeInTheDocument();
    expect(bottomChrome).toHaveAttribute("aria-hidden", "true");

    // NO_THEME personas (and the unparameterised default) don't
    // mount a wallpaper layer at all — `.appFrame`'s own near-black
    // fill paints through. Pin both: no <video> and no wallpaper
    // <img>.
    expect(document.querySelector("video")).toBeNull();
    expect(
      screen.queryByTestId("mock-aura-wallpaper-image"),
    ).not.toBeInTheDocument();
  });

  it("mounts an <img> wallpaper layer when a desktopBackgroundUrl is provided", () => {
    render(
      <MockAuraApp desktopBackgroundUrl="/personas/solo-builder/desktop.png" />,
    );

    const wallpaperImage = screen.getByTestId("mock-aura-wallpaper-image");
    expect(wallpaperImage).toBeInTheDocument();
    expect(wallpaperImage).toHaveAttribute(
      "src",
      "/personas/solo-builder/desktop.png",
    );
    expect(document.querySelector("video")).toBeNull();
  });

  it("starts with no DM windows and reveals them as scripted timers advance", () => {
    vi.useFakeTimers();

    render(<MockAuraApp />);

    const manager = screen.getByTestId("dm-window-manager");
    expect(manager.children.length).toBe(0);

    // Advance past the 250ms warm-up + the first frame's 1500ms
    // typing pre-roll so the first thread's first message becomes
    // visible inside its DM window. The first frame in `SCRIPT` is
    // the architect_frontend thread's typing-led message.
    for (let i = 0; i < 6; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    expect(
      screen.getByTestId("dm-window-architect_frontend"),
    ).toBeInTheDocument();

    const firstMessageFrame = SCRIPT.find(
      (frame): frame is MessageFrame =>
        frame.kind === "message" && frame.thread === "architect_frontend",
    );
    if (!firstMessageFrame) {
      throw new Error(
        "expected SCRIPT to contain at least one architect_frontend message frame",
      );
    }
    expect(screen.getByText(firstMessageFrame.text)).toBeInTheDocument();
  });

  it("routes frames into distinct DM windows by thread id", () => {
    vi.useFakeTimers();

    render(<MockAuraApp />);

    // The script's first two frames land in two different threads
    // (architect_frontend, then architect_backend). After ~10s of
    // simulated time both windows should be mounted.
    for (let i = 0; i < 12; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    expect(
      screen.getByTestId("dm-window-architect_frontend"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dm-window-architect_backend"),
    ).toBeInTheDocument();
  });

  it("raises a DM window above its peers on mousedown and marks it focused", () => {
    vi.useFakeTimers();

    render(<MockAuraApp />);

    // Advance far enough for both architect_frontend and
    // architect_backend windows to mount via the scripted loop, so
    // we have a real two-window stack to reorder.
    for (let i = 0; i < 12; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    const frontend = screen.getByTestId("dm-window-architect_frontend");
    const backend = screen.getByTestId("dm-window-architect_backend");

    const readZ = (el: HTMLElement): number => Number(el.style.zIndex);
    const initialFrontendZ = readZ(frontend);
    const initialBackendZ = readZ(backend);
    expect(initialFrontendZ).not.toEqual(initialBackendZ);

    // Pick whichever window is currently underneath; clicking it
    // must promote it above its peer regardless of which one the
    // script most recently touched.
    const [lower, higher] =
      initialFrontendZ < initialBackendZ
        ? [frontend, backend]
        : [backend, frontend];

    // Sanity: the higher-z window currently carries the focused
    // marker (script-driven focus and z-order stay in sync).
    expect(higher).toHaveAttribute("data-focused", "true");
    expect(lower).not.toHaveAttribute("data-focused");

    act(() => {
      fireEvent.mouseDown(lower);
    });

    expect(readZ(lower)).toBeGreaterThan(readZ(higher));
    expect(lower).toHaveAttribute("data-focused", "true");
    expect(higher).not.toHaveAttribute("data-focused");
  });

  it("renders a single participant name in each DM window titlebar", () => {
    vi.useFakeTimers();

    render(<MockAuraApp />);

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    const titlebar = screen.getByTestId("dm-window-architect_frontend-titlebar");
    expect(within(titlebar).getByText("Frontend")).toBeInTheDocument();
    expect(within(titlebar).queryByText("Architect")).not.toBeInTheDocument();
  });

  it("hides the decorative DM window manager from assistive tech via aria-hidden", () => {
    render(<MockAuraApp />);

    const manager = screen.getByTestId("dm-window-manager");
    expect(manager).toHaveAttribute("aria-hidden", "true");
  });

  /*
   * Window controls — minimize, maximize, and close on each DM
   * window's titlebar now drive per-thread manager state. Minimize
   * and close both hide the window for the rest of the loop (there's
   * no taskbar to restore from); maximize toggles a full-frame pose.
   * The controls are real <button>s but stay `tabIndex={-1}` so the
   * `aria-hidden` manager never leaks into the keyboard/focus order.
   */
  describe("DM window controls", () => {
    // Advance the scripted timers far enough for the first
    // (architect_frontend) window to mount.
    const mountFirstWindow = (): void => {
      for (let i = 0; i < 6; i += 1) {
        act(() => {
          vi.advanceTimersByTime(1500);
        });
      }
    };

    it("renders the controls as tabIndex=-1 buttons so they stay out of the focus order", () => {
      vi.useFakeTimers();
      render(<MockAuraApp />);
      mountFirstWindow();

      for (const control of ["minimize", "maximize", "close"] as const) {
        const button = screen.getByTestId(
          `dm-window-architect_frontend-${control}`,
        );
        expect(button.tagName).toBe("BUTTON");
        expect(button).toHaveAttribute("tabindex", "-1");
      }
    });

    it("hides the window when its close control is clicked", () => {
      vi.useFakeTimers();
      render(<MockAuraApp />);
      mountFirstWindow();

      expect(
        screen.getByTestId("dm-window-architect_frontend"),
      ).toBeInTheDocument();

      act(() => {
        fireEvent.click(
          screen.getByTestId("dm-window-architect_frontend-close"),
        );
      });

      expect(
        screen.queryByTestId("dm-window-architect_frontend"),
      ).not.toBeInTheDocument();
    });

    it("hides the window when its minimize control is clicked", () => {
      vi.useFakeTimers();
      render(<MockAuraApp />);
      mountFirstWindow();

      expect(
        screen.getByTestId("dm-window-architect_frontend"),
      ).toBeInTheDocument();

      act(() => {
        fireEvent.click(
          screen.getByTestId("dm-window-architect_frontend-minimize"),
        );
      });

      expect(
        screen.queryByTestId("dm-window-architect_frontend"),
      ).not.toBeInTheDocument();
    });

    it("toggles a full-frame maximized pose when the maximize control is clicked", () => {
      vi.useFakeTimers();
      render(<MockAuraApp />);
      mountFirstWindow();

      const win = screen.getByTestId("dm-window-architect_frontend");
      expect(win).not.toHaveAttribute("data-maximized");

      act(() => {
        fireEvent.click(
          screen.getByTestId("dm-window-architect_frontend-maximize"),
        );
      });

      expect(win).toHaveAttribute("data-maximized", "true");
      expect(win.style.width).toBe("100%");
      // Top is inset by the mock top-chrome bar so the maximized
      // window tucks under the titlebar rather than covering it.
      expect(win.style.top).toBe("var(--shell-chrome-outer-height)");
      expect(win.style.height).toBe(
        "calc(100% - var(--shell-chrome-outer-height))",
      );
      // Resize handles are not rendered while maximized.
      expect(
        screen.queryByTestId("dm-window-architect_frontend-resize-se"),
      ).not.toBeInTheDocument();

      // Clicking again restores the windowed pose.
      act(() => {
        fireEvent.click(
          screen.getByTestId("dm-window-architect_frontend-maximize"),
        );
      });

      expect(win).not.toHaveAttribute("data-maximized");
      expect(
        screen.getByTestId("dm-window-architect_frontend-resize-se"),
      ).toBeInTheDocument();
    });
  });

  it("leaves the frame un-themed (no data attribute, no inline mock vars) when no chatPalette is supplied", () => {
    render(<MockAuraApp />);
    const frame = screen.getByTestId("mock-aura-app");
    // NO_THEME personas (and the default public chat surface) reach
    // here with `chatPalette = null` — the persona override block
    // in MockAuraApp.module.css is keyed on this attribute and
    // must NOT fire so the existing shell tokens keep painting.
    expect(frame).not.toHaveAttribute("data-persona-themed");
    expect(frame.style.getPropertyValue("--mock-text")).toBe("");
  });

  it("applies data-persona-themed and the --mock-* custom properties when a chatPalette is supplied", () => {
    const palette = deriveChatPalette("#b3c4d2", "dark");
    if (!palette) {
      throw new Error("expected deriveChatPalette to return a palette");
    }
    render(<MockAuraApp chatPalette={palette} />);
    const frame = screen.getByTestId("mock-aura-app");
    expect(frame).toHaveAttribute("data-persona-themed", "true");
    expect(frame.style.getPropertyValue("--mock-text")).toBe(palette.text);
    expect(frame.style.getPropertyValue("--mock-text-secondary")).toBe(
      palette.textSecondary,
    );
    expect(frame.style.getPropertyValue("--mock-text-muted")).toBe(
      palette.textMuted,
    );
    expect(frame.style.getPropertyValue("--mock-hljs-keyword")).toBe(
      palette.hljsKeyword,
    );
    expect(frame.style.getPropertyValue("--mock-hljs-string")).toBe(
      palette.hljsString,
    );
    expect(frame.style.getPropertyValue("--mock-hljs-comment")).toBe(
      palette.hljsComment,
    );
  });

  /*
   * Persona avatar dock — one circular button per `PERSONAS` entry
   * inside the bottom-left mock dock pill. The dock is the second
   * entry point for persona swaps (next to `PersonaTickRail`), so
   * these tests pin both the visual contract (right number of
   * buttons, right active marker, right image-vs-fallback split)
   * and the wiring contract (clicks fire `onPersonaSelect` with the
   * array index of the clicked persona).
   */
  describe("persona avatar dock", () => {
    it("renders one button per entry in PERSONAS in array order", () => {
      render(<MockAuraApp />);
      const buttons = PERSONAS.map((persona) =>
        screen.getByTestId(`mock-aura-avatar-${persona.id}`),
      );
      expect(buttons).toHaveLength(PERSONAS.length);
      for (const [index, persona] of PERSONAS.entries()) {
        expect(buttons[index]).toHaveAttribute("data-persona-id", persona.id);
        expect(buttons[index].tagName).toBe("BUTTON");
        // `bottomChrome` is `aria-hidden`, so the dock buttons stay
        // out of the keyboard focus order.
        expect(buttons[index]).toHaveAttribute("tabindex", "-1");
      }
    });

    it("marks the button at activePersonaIndex as active and leaves the rest inactive", () => {
      render(<MockAuraApp activePersonaIndex={3} />);
      for (const [index, persona] of PERSONAS.entries()) {
        const button = screen.getByTestId(`mock-aura-avatar-${persona.id}`);
        expect(button).toHaveAttribute(
          "data-active",
          index === 3 ? "true" : "false",
        );
      }
    });

    it("defaults activePersonaIndex to 0 (Creator) when omitted", () => {
      render(<MockAuraApp />);
      expect(
        screen.getByTestId(`mock-aura-avatar-${PERSONAS[0].id}`),
      ).toHaveAttribute("data-active", "true");
      expect(
        screen.getByTestId(`mock-aura-avatar-${PERSONAS[1].id}`),
      ).toHaveAttribute("data-active", "false");
    });

    it("fires onPersonaSelect with the array index when an avatar is clicked", () => {
      const onPersonaSelect = vi.fn();
      render(<MockAuraApp onPersonaSelect={onPersonaSelect} />);

      // Pick the Solo Builder slot (index 2) — distinct from the
      // default active index (0) so the click registers a real
      // change and the assertion isn't a no-op.
      fireEvent.click(screen.getByTestId("mock-aura-avatar-solo-builder"));

      expect(onPersonaSelect).toHaveBeenCalledTimes(1);
      expect(onPersonaSelect).toHaveBeenCalledWith(2);
    });

    it("paints themed persona portraits via background-image in the avatar dock", () => {
      render(<MockAuraApp />);

      // Personas with a desktopBackgroundUrl render the portrait
      // inline as a background-image; their inner content stays
      // empty (no fallback letter to obscure the image).
      const vibecoder = screen.getByTestId("mock-aura-avatar-vibecoder");
      expect(vibecoder.style.backgroundImage).toContain(
        "/personas/vibecoder/desktop.png",
      );
      expect(vibecoder.textContent).toBe("");

      const researcher = screen.getByTestId("mock-aura-avatar-researcher");
      expect(researcher.style.backgroundImage).toContain(
        "/personas/researcher/desktop.png",
      );
      expect(researcher.textContent).toBe("");
    });

    /*
     * Fish-eye magnifier — pointer-move over the `.bottomLeft` pill
     * inflates each avatar based on its horizontal distance from the
     * cursor, and pointer-leave snaps every avatar back to the base
     * size. jsdom doesn't compute layout, so we stub
     * `getBoundingClientRect` on each avatar button with
     * deterministic positions that match the order in `PERSONAS`,
     * then assert the inline `style.width` values the component
     * paints in response to a synthetic pointer event.
     */
    it("waits for the dock to open before inflating the nearest avatar, then resets on pointer-leave", () => {
      vi.useFakeTimers();
      try {
        render(<MockAuraApp />);

        const dock = screen.getByTestId("mock-aura-bottom-left");
        const avatars = PERSONAS.map((persona) =>
          screen.getByTestId(`mock-aura-avatar-${persona.id}`),
        );

        // Each avatar gets an 18px-wide rect centered at a unique X.
        // The first avatar's center is at x=100, so it should hit
        // the raised-cosine peak (~44px) once the dock-open delay
        // has elapsed. Distant avatars settle at the opened base
        // size (28px), so every portrait scales up with real layout
        // pixels instead of being blurred by a parent transform.
        const BUTTON_WIDTH = 18;
        const SPACING_PX = 200;
        const FIRST_CENTER_X = 100;
        avatars.forEach((node, index) => {
          const centerX = FIRST_CENTER_X + index * SPACING_PX;
          const left = centerX - BUTTON_WIDTH / 2;
          node.getBoundingClientRect = () =>
            ({
              left,
              right: left + BUTTON_WIDTH,
              top: 500,
              bottom: 500 + BUTTON_WIDTH,
              width: BUTTON_WIDTH,
              height: BUTTON_WIDTH,
              x: left,
              y: 500,
              toJSON: () => ({}),
            }) as DOMRect;
        });

        fireEvent.pointerEnter(dock, { clientX: FIRST_CENTER_X, clientY: 500 });
        fireEvent.pointerMove(dock, { clientX: FIRST_CENTER_X, clientY: 500 });

        // The circular avatars wait while the pill itself performs
        // its open animation.
        expect(avatars[0].style.width).toBe("18px");
        expect(avatars[0].style.height).toBe("18px");

        act(() => {
          vi.advanceTimersByTime(180);
        });

        expect(avatars[0].style.width).toBe("44px");
        expect(avatars[0].style.height).toBe("44px");

        for (let i = 1; i < avatars.length; i += 1) {
          expect(avatars[i].style.width).toBe("28px");
          expect(avatars[i].style.height).toBe("28px");
        }

        fireEvent.pointerLeave(dock);
        for (const node of avatars) {
          expect(node.style.width).toBe("18px");
          expect(node.style.height).toBe("18px");
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps avatar magnification active when reduced motion is enabled", () => {
      vi.useFakeTimers();
      const originalMatchMedia = window.matchMedia;
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      try {
        render(<MockAuraApp />);

        const dock = screen.getByTestId("mock-aura-bottom-left");
        const avatar = screen.getByTestId("mock-aura-avatar-vibecoder");
        avatar.getBoundingClientRect = () =>
          ({
            left: 91,
            right: 109,
            top: 500,
            bottom: 518,
            width: 18,
            height: 18,
            x: 91,
            y: 500,
            toJSON: () => ({}),
          }) as DOMRect;

        fireEvent.pointerEnter(dock, { clientX: 100, clientY: 509 });
        act(() => {
          vi.advanceTimersByTime(180);
        });

        expect(avatar.style.width).toBe("44px");
        expect(avatar.style.height).toBe("44px");
      } finally {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: originalMatchMedia,
        });
        vi.useRealTimers();
      }
    });
  });
});
