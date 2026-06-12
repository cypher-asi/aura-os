/**
 * AuraShell — Phase 3 regression suite.
 *
 * Covers the load-bearing invariants of the unified shell:
 *
 *   (a) **Stable mounts across the login transition.** Captures DOM
 *       refs to the titlebar wrapper, sidebar Lane, sidebar header,
 *       main panel, and BottomTaskbar `.bar` BEFORE sign-in; flips
 *       auth via `useAuthStore.setState`; re-captures the same
 *       `data-testid`s; asserts each pair is reference-equal. Search
 *       query continuity and `--shell-chrome-outer-height` row
 *       stability depend on these elements never remounting across
 *       the public <-> standard boundary.
 *
 *   (b) **BottomTaskbar in public mode** renders only
 *       `ThemeToggleButton` (no Desktop / favorites / app rail /
 *       credits / settings / help / profile) and keeps the outer
 *       `.bar` `data-ui-mode="public"`. The outer `.bar` is what
 *       reserves the `--shell-chrome-outer-height` row, so its
 *       presence in every mode is what keeps the main panel's
 *       bottom edge from shifting on flip.
 *
 *   (d) **Public-only content gate.** In public effective mode the
 *       public nav footer (Pricing link) and `MockAuraApp` hero are
 *       in the DOM. After `useAuthStore.setState({ user: ... })`
 *       (auth simulated), the same queries return null — the
 *       public-only surface is gone.
 *
 * `data-testid` contract:
 *   - `aura-shell`          — root `.shell` div
 *   - `aura-titlebar`       — `<ShellTitlebar>` outer wrapper
 *   - `aura-sidebar`        — sidebar `<aside>`
 *   - `aura-sidebar-header` — `.sidebarHeader` div
 *   - `aura-shell-main`     — `<main>` slot
 *
 * Test setup uses `MemoryRouter` to drive the route tree (so
 * `useLocation` / `useOutlet` work) and stubs the few heavy modules
 * that don't matter for shell composition (zui Topbar / Input, the
 * theme/wallpaper background layer).
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useUIModeStore } from "../../stores/ui-mode-store";
import { useAuthStore } from "../../stores/auth-store";
import { useSidebarSearchStore } from "../../stores/sidebar-search-store";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { __setIsMacForTesting } from "../../lib/platform";
import { PUBLIC_SIDEBAR_COLLAPSED_KEY } from "../../constants";

vi.mock("@cypher-asi/zui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@cypher-asi/zui");
  return {
    ...actual,
    Topbar: ({
      icon,
      title,
      actions,
      ...rest
    }: {
      icon?: React.ReactNode;
      title?: React.ReactNode;
      actions?: React.ReactNode;
    } & Record<string, unknown>) => (
      // Spreading `rest` keeps the production `onDoubleClick`
      // (which dispatches `windowCommand("maximize")`) attached to
      // the stub root so propagation tests for in-titlebar buttons
      // can assert real bubbling behaviour.
      <div
        data-testid={(rest["data-testid"] as string) ?? "zui-topbar-stub"}
        {...(rest as Record<string, unknown>)}
      >
        <div>{icon}</div>
        <div>{title}</div>
        <div>{actions}</div>
      </div>
    ),
    Input: ({
      placeholder,
      value,
      onChange,
      className,
      ...rest
    }: {
      placeholder?: string;
      value?: string;
      onChange?: (event: { target: { value: string } }) => void;
      className?: string;
      size?: string;
    } & Record<string, unknown>) => (
      <input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={className}
        {...(rest as Record<string, unknown>)}
      />
    ),
    useTheme: () => ({
      theme: "dark",
      resolvedTheme: "dark",
      setTheme: vi.fn(),
    }),
  };
});

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../DesktopShell/BackgroundLayer", () => ({
  BackgroundLayer: () => <div data-testid="background-layer-stub" />,
}));

// The agents window layer is lazy-imported by AuraShell. It never
// renders in these tests (no open desktop windows) so a no-op stub is
// sufficient and avoids dragging the full module graph in.
vi.mock("../../apps/agents/components/AgentWindow", () => ({
  DesktopWindowLayer: () => null,
}));

import { AuraShell } from "./AuraShell";

const TEST_USER = {
  user_id: "test-user",
  network_user_id: "test-net",
  profile_id: "test-prof",
  display_name: "Test",
  profile_image: null,
  primary_zid: null,
  zero_wallet: null,
  wallets: [],
  is_zero_pro: false,
  is_access_granted: true,
} as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>;

function renderAuraShell(initialPath = "/"): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AuraShell />}>
          <Route
            path="/"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/login"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/chat"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/projects/:id"
            element={<div data-testid="outlet-child">child route</div>}
          />
          <Route
            path="/desktop"
            element={<div data-testid="outlet-child">child route</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function setLoggedIn(): void {
  useAuthStore.setState({ user: TEST_USER });
}

function setLoggedOut(): void {
  useAuthStore.setState({ user: null });
}

beforeEach(() => {
  window.localStorage.clear();
  usePublicChatStore.setState({
    sessions: {},
    sessionOrder: [],
    turnCount: 0,
    guestToken: null,
  });
  useSidebarSearchStore.setState({ queries: {} });
  useUIModeStore.setState({ mode: "standard" });
  // Reset the public-sidebar collapse state (its default is `true`,
  // but a previous test may have toggled it open via store action).
  useAppUIStore.setState({ publicSidebarCollapsed: true });
  // Reset any modal state a previous test may have flipped open (the
  // menu-shortcut test below flips `orgSettingsOpen`).
  useUIModalStore.setState({ orgSettingsOpen: false });
  // Pin the platform to non-mac so `Ctrl+...` shortcuts match
  // regardless of the host running the suite.
  __setIsMacForTesting(false);
});

afterEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ user: null });
  __setIsMacForTesting(null);
});

describe("AuraShell — Phase 3 unified shell", () => {
  it("(a) preserves DOM identity of the titlebar, sidebar Lane, sidebar header, and main across the public -> standard (login) transition", async () => {
    // The outer BottomTaskbar `.bar` is NOT asserted here: public and
    // authed render distinct taskbar components (`PublicBottomTaskbar`
    // vs `AuthedBottomTaskbar`), so React swaps the `.bar` node across
    // the login boundary. The titlebar / sidebar / header / main slots
    // are unconditional wrappers in AuraShell and stay reference-stable.
    setLoggedOut();

    renderAuraShell();

    const titlebarBefore = screen.getByTestId("aura-titlebar");
    const sidebarBefore = screen.getByTestId("aura-sidebar");
    const sidebarHeaderBefore = screen.getByTestId("aura-sidebar-header");
    const mainBefore = screen.getByTestId("aura-shell-main");

    await act(async () => {
      setLoggedIn();
    });

    expect(screen.getByTestId("aura-titlebar")).toBe(titlebarBefore);
    expect(screen.getByTestId("aura-sidebar")).toBe(sidebarBefore);
    expect(screen.getByTestId("aura-sidebar-header")).toBe(sidebarHeaderBefore);
    expect(screen.getByTestId("aura-shell-main")).toBe(mainBefore);
  });

  it("(b) BottomTaskbar renders the public minimal cluster in public mode and `.bar` carries data-ui-mode='public'", () => {
    setLoggedOut();

    const { container } = renderAuraShell();

    const bar = container.querySelector(
      "[data-agent-surface='desktop-shell-bottom-taskbar']",
    );
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("data-ui-mode", "public");
    // The full taskbar exposes Apps + Settings + Credits buttons. Each
    // is gated by an authed-only hook chain and must be absent in
    // public mode.
    expect(
      screen.queryByRole("button", { name: /apps/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /settings/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /credits/i }),
    ).not.toBeInTheDocument();
  });

  it("(d) gates public nav links behind public mode and hides them when logged in", async () => {
    setLoggedOut();

    renderAuraShell();

    // `PublicTopNav` (titlebar) exposes the Pricing link and the
    // bottom taskbar carries the Chat link. Both are public-only and
    // must be present for unauthenticated visitors and absent the
    // moment the user signs in.
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    // Chat is now a bottom-taskbar toggle button (chat <-> previous
    // page), not a link, so it carries no href.
    expect(
      screen.getByRole("button", { name: "Chat" }),
    ).toBeInTheDocument();

    await act(async () => {
      setLoggedIn();
    });

    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Chat" }),
    ).not.toBeInTheDocument();
  });

  it("(f) public titlebar does not render a theme toggle (day/night lives in BottomTaskbar) but keeps the auth pills", () => {
    setLoggedOut();

    renderAuraShell();

    const titlebar = screen.getByTestId("aura-titlebar");
    // No sun/moon button anywhere inside the titlebar — the public
    // chrome's only day/night affordance lives in the BottomTaskbar
    // right cluster. `getThemeToggleAriaLabel` formats as
    // "Switch theme (currently <theme>)", so a `/switch theme/i`
    // role query catches it regardless of the resolved theme.
    expect(
      within(titlebar).queryByRole("button", { name: /switch theme/i }),
    ).not.toBeInTheDocument();

    // The Log In / Sign Up / Download pills are the load-bearing
    // public-mode CTAs and must remain in the trailing slot.
    expect(
      within(titlebar).getByRole("link", { name: "Log In" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("link", { name: "Sign Up" }),
    ).toBeInTheDocument();
    const downloadLink = within(titlebar).getByRole("link", {
      name: "Download",
    });
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute("href", "/download");
  });

  it("(g) suppresses the desktop wallpaper (BackgroundLayer) in public mode and mounts it for authed standard users", async () => {
    // The persisted desktop wallpaper must not bleed onto logged-out
    // surfaces. AuraShell gates `<BackgroundLayer />` behind
    // `mode === "standard"`, so the stub testid is absent in public
    // and appears once the user signs in.
    setLoggedOut();

    renderAuraShell();

    expect(
      screen.queryByTestId("background-layer-stub"),
    ).not.toBeInTheDocument();

    await act(async () => {
      setLoggedIn();
    });

    expect(screen.getByTestId("background-layer-stub")).toBeInTheDocument();

    await act(async () => {
      setLoggedOut();
    });

    expect(
      screen.queryByTestId("background-layer-stub"),
    ).not.toBeInTheDocument();
  });

  // Note: the `/login` overlay mount lives in `App.tsx` (above the
  // background-location-aware `<Routes>` so `useLocation()` can read
  // the real `/login` URL). Coverage for the overlay UI itself is in
  // `LoginOverlay.test.tsx`; AuraShell no longer owns the gating.
});

/**
 * Standard-mode chrome. The authed standard surface mounts the
 * desktop wallpaper (test (g) above), the right sidekick lane, the
 * two sidekick-related icon buttons (`Toggle split screen` /
 * `Toggle sidekick`), and the File / Edit / View / Help menu bar.
 * The referral CTA (`EarnCreditsButton`) lives in the left sidebar
 * footer. This block focuses on the right lane + the titlebar.
 */
describe("AuraShell — standard-mode chrome", () => {
  it("mounts the right sidekick lane (`data-agent-surface=\"sidekick-panel\"`) for the authed standard shell", () => {
    setLoggedIn();

    const { container } = renderAuraShell("/chat");

    expect(
      container.querySelector('[data-agent-surface="sidekick-panel"]'),
    ).not.toBeNull();
  });

  it("renders the Split-screen / Sidekick toggle icon buttons in the titlebar and the referral CTA in the sidebar footer", () => {
    setLoggedIn();

    renderAuraShell("/chat");

    const titlebar = screen.getByTestId("aura-titlebar");
    expect(
      within(titlebar).getByRole("button", { name: /toggle sidekick/i }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("button", { name: /toggle split screen/i }),
    ).toBeInTheDocument();
    // The referral CTA lives in the left sidebar footer
    // (`AuthedSidebarFooter`), keyed off the aria-label
    // "Refer a member to earn credits" — not in the titlebar.
    expect(
      within(titlebar).queryByRole("button", { name: /refer a member/i }),
    ).not.toBeInTheDocument();
    const sidebar = screen.getByTestId("aura-sidebar");
    expect(
      within(sidebar).getByRole("button", { name: /refer a member/i }),
    ).toBeInTheDocument();
  });

  it("renders the File / Edit / View / Help menu bar in the authed standard shell", () => {
    setLoggedIn();

    renderAuraShell("/chat");

    const titlebar = screen.getByTestId("aura-titlebar");
    expect(
      within(titlebar).getByRole("menubar", { name: /application menu/i }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "File" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "View" }),
    ).toBeInTheDocument();
    expect(
      within(titlebar).getByRole("menuitem", { name: "Help" }),
    ).toBeInTheDocument();
  });

  it("wires the application-menu keyboard shortcuts in the authed standard shell", () => {
    // The headless `<MenuShortcuts />` companion installs the
    // document-level `keydown` listener. Firing `Ctrl+,` (Settings)
    // must flip `useUIModalStore.orgSettingsOpen` to `true`.
    setLoggedIn();

    renderAuraShell("/chat");

    expect(useUIModalStore.getState().orgSettingsOpen).toBe(false);

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: ",",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
    });

    expect(useUIModalStore.getState().orgSettingsOpen).toBe(true);
  });
});

/**
 * Active-app resolution coverage.
 *
 * The shell's authoritative source of the "current app" is
 * `useActiveApp()`, derived purely from the pathname. AuraSidebar
 * stamps `data-agent-active-app-id` on the LeftPanel host, so we
 * assert against that attribute as a structural proxy for "this
 * app's MainPanel + LeftPanel are the things that render right now".
 */
describe("AuraShell — active-app resolution", () => {
  /**
   * Resolves the currently active app id by inspecting the sidebar
   * subtree. Two probes are needed because the sidebar renders one
   * of two structures:
   *
   *   1. Apps in `sharedDesktopLeftMenuPanes` (e.g. `agents`,
   *      `projects`, `tasks`) render via `<LeftMenu>`, which stamps
   *      `data-active="true"` on the active pane and exposes its app
   *      id via `data-testid="desktop-left-menu-pane-<id>"`. `agents`
   *      participates here so its list is kept alive (hidden) across
   *      Agents <-> Projects switches.
   *
   *   2. Apps without a `DesktopLeftMenuPane` (e.g. `chat`) render
   *      their own LeftPanel inside `AuthedSidebarBody`, which stamps
   *      `data-agent-active-app-id` directly on the host div.
   */
  function getActiveAppId(container: HTMLElement): string | null {
    const directHost = container.querySelector("[data-agent-active-app-id]");
    if (directHost) {
      return directHost.getAttribute("data-agent-active-app-id");
    }
    const sharedActivePane = container.querySelector(
      "[data-testid='desktop-left-menu'] [data-active='true']",
    );
    const testId = sharedActivePane?.getAttribute("data-testid");
    if (testId?.startsWith("desktop-left-menu-pane-")) {
      return testId.slice("desktop-left-menu-pane-".length);
    }
    return null;
  }

  it("resolves the active app from the pathname for an authed user (`/projects/:id` -> projects)", () => {
    setLoggedIn();

    const { container } = renderAuraShell("/projects/abc");

    expect(getActiveAppId(container)).toBe("projects");
  });

  it("public mode still renders the public chat surface (PublicTopNav pricing link present)", () => {
    setLoggedOut();
    renderAuraShell("/");

    // `PublicTopNav` is the public-only marketing nav (titlebar) and
    // the bottom taskbar carries the Chat link. In public mode they
    // must mount — their absence would mean the shell mistakenly
    // resolved to an authed surface.
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
  });

  it("sign-in transition (public -> standard) tears down the public nav and mounts an authed LeftPanel", async () => {
    setLoggedOut();
    const { container } = renderAuraShell("/");

    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(getActiveAppId(container)).toBeNull();

    await act(async () => {
      setLoggedIn();
    });

    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Chat" }),
    ).not.toBeInTheDocument();
    // The pathname-derived active app now owns the sidebar LeftPanel
    // host, so the structural probe resolves to a concrete app id.
    expect(getActiveAppId(container)).not.toBeNull();
  });
});

/**
 * Public-mode left drawer toggle. Mirrors the right-side sidekick
 * drawer (`PanelRight` in `WindowControls.tsx`) on the left so a
 * logged-out visitor sees a ChatGPT-style collapsed sessions panel
 * by default and can flip it open via a single titlebar button. The
 * public marketing nav (Agents / Code / Pricing / Resources) lives
 * in the titlebar (`PublicTopNav`), independent of the sidebar
 * collapse state, so it stays visible in both states.
 *
 * `aria-pressed` mirrors the sidekick toggle's contract (true when
 * the drawer is open, false when collapsed) so AT users get a
 * symmetric experience on both sides of the window chrome.
 */
describe("AuraShell — public left drawer", () => {
  it("renders the left drawer toggle in public mode and starts collapsed (aria-pressed=false), with the public top nav still visible", () => {
    setLoggedOut();
    renderAuraShell("/");

    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    const sidebar = screen.getByTestId("aura-sidebar");
    expect(sidebar).toHaveAttribute("data-public-sidebar-collapsed", "true");

    // The public marketing nav lives in the titlebar, independent of
    // the sidebar collapse state, so its links stay in the DOM even
    // when the sessions panel is collapsed.
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Code" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    // Resources is a dropdown trigger (button), collapsed by default.
    expect(
      screen.getByRole("button", { name: /Resources/i }),
    ).toBeInTheDocument();
    // Chat lives in the bottom taskbar as a toggle button.
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
  });

  it("clicking the drawer toggle flips aria-pressed and the sidebar collapse data attribute, then collapses again on a second click", async () => {
    setLoggedOut();
    const user = userEvent.setup();
    renderAuraShell("/");

    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    const sidebar = screen.getByTestId("aura-sidebar");

    await user.click(toggle);

    // After opening: same DOM node (no remount), aria-pressed flips,
    // and the data attribute on the aside reflects the open state.
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(sidebar).toHaveAttribute("data-public-sidebar-collapsed", "false");
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(sidebar).toHaveAttribute("data-public-sidebar-collapsed", "true");
  });

  it("persists the drawer's open state to localStorage so the choice survives a reload", async () => {
    setLoggedOut();
    const user = userEvent.setup();
    renderAuraShell("/");

    expect(window.localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(window.localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY)).toBe(
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(window.localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY)).toBe(
      "true",
    );
  });

  it("renders the left drawer toggle in the authed standard mode too (uniform affordance across public / standard)", () => {
    // The titlebar leading slot is a uniform `<PanelLeft />` drawer
    // toggle on every effective mode now — the previous "no toggle
    // in authed modes" guarantee was relaxed when the team selector
    // moved to the bottom taskbar.
    setLoggedIn();
    renderAuraShell("/chat");

    expect(
      screen.getByRole("button", { name: "Toggle sidebar" }),
    ).toBeInTheDocument();
  });

  it("the left drawer toggle's aria-pressed contract matches the right sidekick toggle (open=true, collapsed=false)", async () => {
    setLoggedOut();
    const user = userEvent.setup();
    renderAuraShell("/");

    const leftToggle = screen.getByRole("button", { name: "Toggle sidebar" });
    // Default starts collapsed: aria-pressed="false" (mirrors how the
    // right sidekick reads aria-pressed=false when collapsed).
    expect(leftToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(leftToggle);

    // Open: aria-pressed="true" — same boolean contract as the right
    // sidekick toggle in `WindowControls.tsx`.
    expect(leftToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("double-clicking the left drawer toggle does not bubble to the titlebar's window-maximize handler", async () => {
    // `ShellTitlebar` installs a default double-click handler that
    // calls `windowCommand("maximize")`. Without an explicit
    // `stopPropagation` on the leading slot, fast double-taps on
    // the drawer button maximize the OS window — a regression worth
    // pinning here so the next refactor that touches `PublicLeading`
    // notices the constraint. The shared `lib/windowCommand` mock at
    // the top of this file lets us assert the no-call invariant.
    setLoggedOut();
    const user = userEvent.setup();
    const { windowCommand } = await import("../../lib/windowCommand");
    vi.mocked(windowCommand).mockClear();
    renderAuraShell("/");

    const leftToggle = screen.getByRole("button", { name: "Toggle sidebar" });
    await user.dblClick(leftToggle);

    expect(windowCommand).not.toHaveBeenCalledWith("maximize");
  });
});

/**
 * Standard `/desktop` regression coverage. Two behaviours were lost
 * when DesktopShell was folded into AuraShell and are tracked here:
 *
 *   1. `data-desktop-mode` must live on the `.shell` root (the
 *      element with `data-testid="aura-shell"`). Several CSS
 *      selectors — most notably `.shell[data-desktop-mode] .mainPanel`
 *      in `AuraShell.module.css` — depend on that location to strip
 *      the main panel's solid background + 1px border so the
 *      wallpaper-backed `BackgroundLayer` bleeds edge-to-edge. When
 *      the attribute sat on the inner `.body` div, the selector
 *      never matched and the wallpaper got sliced.
 *
 *   2. The left sidebar Lane must collapse to width 0 on `/desktop`.
 *      `DesktopApp.LeftPanel` returns `null`, so the body is empty,
 *      but the `<PanelSearch>` row would otherwise keep the lane open
 *      and visibly cover the wallpaper. Legacy `DesktopShell` had this
 *      via `<Lane collapsed={isDesktop} animateCollapse={false}>`;
 *      `AuraSidebar` now mirrors the behaviour off the `isDesktop`
 *      prop AuraShell threads in.
 */
describe("AuraShell — standard /desktop chrome", () => {
  beforeEach(() => {
    // `desktopModeActive = isDesktop && backgroundHydrated`. The
    // store starts in an unhydrated state in the no-image-slot
    // default, but the `data-desktop-mode` flip should be observable
    // immediately, so we mark it hydrated up front.
    useDesktopBackgroundStore.setState({ hydrated: true });
  });

  it("stamps `data-desktop-mode` on the `.shell` root (not the inner `.body`) when on /desktop in standard mode", () => {
    setLoggedIn();

    renderAuraShell("/desktop");

    const shell = screen.getByTestId("aura-shell");
    expect(shell).toHaveAttribute("data-desktop-mode", "true");
    // No descendant of `.shell` should carry the attribute — it used
    // to live on the inner `.body` div but module CSS selectors like
    // `.shell[data-desktop-mode] .mainPanel` only resolve when the
    // attribute is on the shell root itself. `querySelector` walks
    // descendants only (not the root), so a single nullish assertion
    // pins both the location move and the no-duplicate invariant.
    expect(shell.querySelector("[data-desktop-mode]")).toBeNull();
  });

  it("does not stamp `data-desktop-mode` on /chat in standard mode (only `/desktop` activates it)", () => {
    setLoggedIn();

    renderAuraShell("/chat");

    const shell = screen.getByTestId("aura-shell");
    expect(shell).not.toHaveAttribute("data-desktop-mode");
  });

  it("collapses the sidebar Lane to 0 width on /desktop in standard mode (wallpaper-edge-to-edge)", () => {
    setLoggedIn();

    renderAuraShell("/desktop");

    const sidebar = screen.getByTestId("aura-sidebar");
    const lane = sidebar.querySelector<HTMLElement>("[data-lane]");
    expect(lane).not.toBeNull();
    // Lane writes the resolved width onto inline `style.width`;
    // `collapsed=true` short-circuits to 0 regardless of the
    // persisted user-resized value.
    expect(lane?.style.width).toBe("0px");
  });

  it("keeps the sidebar Lane expanded off /desktop in standard mode (only /desktop forces the 0-width collapse)", () => {
    setLoggedIn();

    renderAuraShell("/chat");
    const lane = screen
      .getByTestId("aura-sidebar")
      .querySelector<HTMLElement>("[data-lane]");
    expect(lane).not.toBeNull();
    // Off `/desktop` the lane is not force-collapsed, so its inline
    // width resolves to a non-zero value (the persisted/default size).
    expect(lane?.style.width).not.toBe("0px");
  });

  it("hides the sidebar toggle, sidekick toggle, and the whole menu bar in the titlebar on /desktop", () => {
    setLoggedIn();

    renderAuraShell("/desktop");

    const titlebar = screen.getByTestId("aura-titlebar");
    // Left PanelLeft sidebar toggle, right PanelRight sidekick toggle,
    // and the entire File / Edit / View / Help menu bar (chevron
    // included) are all suppressed in desktop mode for a clean top bar.
    expect(
      within(titlebar).queryByRole("button", { name: "Toggle sidebar" }),
    ).not.toBeInTheDocument();
    expect(
      within(titlebar).queryByRole("button", { name: /toggle sidekick/i }),
    ).not.toBeInTheDocument();
    expect(
      within(titlebar).queryByRole("menubar", { name: /application menu/i }),
    ).not.toBeInTheDocument();
    expect(
      within(titlebar).queryByRole("menuitem", { name: "File" }),
    ).not.toBeInTheDocument();
  });
});
