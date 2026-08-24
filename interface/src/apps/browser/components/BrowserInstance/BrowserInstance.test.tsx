import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserClientMsg,
  NavError,
  NavState,
  ProjectBrowserSettings,
} from "../../../../shared/api/browser";
import type {
  UseBrowserOptions,
  UseBrowserReturn,
} from "../../../../hooks/use-browser";
import { ApiClientError } from "../../../../shared/api/core";
import {
  DESIGN_PROMPT_EVENT,
  type DesignPromptDetail,
} from "../../../../shared/lib/design-context";

// Capture the `useBrowser` options the component registers so each test can
// drive the navigation lifecycle (`onNav` / `onNavError`) directly. Using
// `vi.hoisted` keeps the mock factory wiring deterministic regardless of
// import order.
const { capturedOpts, mockSend } = vi.hoisted(() => ({
  capturedOpts: { current: null as UseBrowserOptions | null },
  mockSend: vi.fn<(msg: BrowserClientMsg) => void>(),
}));

vi.mock("../../../../hooks/use-browser", () => ({
  useBrowser: (opts: UseBrowserOptions): UseBrowserReturn => {
    capturedOpts.current = opts;
    return {
      sessionId: "session-1",
      connected: true,
      spawning: false,
      initialUrl: null,
      focusAddressBar: false,
      spawn: vi.fn(),
      send: mockSend,
      kill: vi.fn(),
    };
  },
}));

vi.mock("../../../../shared/api/browser", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../shared/api/browser")
  >("../../../../shared/api/browser");
  const emptySettings: ProjectBrowserSettings = {
    schema_version: 1,
    pinned_url: null,
    last_url: null,
    detected_urls: [],
    history: [],
  };
  return {
    ...actual,
    getProjectBrowserSettings: vi.fn().mockResolvedValue(emptySettings),
    updateProjectBrowserSettings: vi.fn().mockResolvedValue(emptySettings),
    triggerBrowserDetect: vi.fn().mockResolvedValue([]),
  };
});

// Replace the address bar / viewport with thin shims so the test can poke
// the Reload action and inspect the overlay slot without standing up the
// real DOM canvas + worker pipeline.
vi.mock("../BrowserAddressBar", () => ({
  BrowserAddressBar: ({ onReload }: { onReload?: () => void }) => (
    <button type="button" data-testid="address-bar-reload" onClick={onReload}>
      Reload
    </button>
  ),
}));

vi.mock("../BrowserViewport", () => ({
  BrowserViewport: ({
    overlay,
    placeholder,
  }: {
    overlay?: React.ReactNode;
    placeholder?: string;
  }) => (
    <div data-testid="viewport">
      {placeholder}
      {overlay}
    </div>
  ),
}));

import { BrowserInstance } from "./BrowserInstance";

const ERROR_404: NavError = {
  url: "http://127.0.0.1:8080/",
  error_text: "net::ERR_HTTP_RESPONSE_CODE_FAILURE",
  code: -379,
  http_status: 404,
};

function navState(url: string, loading = false): NavState {
  return {
    url,
    title: null,
    can_go_back: false,
    can_go_forward: false,
    loading,
  };
}

function setup(props?: { projectId?: string; remoteAgentId?: string }) {
  render(
    <BrowserInstance
      clientId="client-1"
      projectId={props?.projectId}
      remoteAgentId={props?.remoteAgentId}
      width={400}
      height={300}
    />,
  );
  if (!capturedOpts.current) {
    throw new Error("useBrowser was not invoked during render");
  }
  return capturedOpts.current;
}

describe("BrowserInstance navError lifecycle", () => {
  beforeEach(() => {
    capturedOpts.current = null;
    mockSend.mockClear();
  });

  it("keeps the error overlay mounted after the user clicks Reload from the overlay", () => {
    const opts = setup();

    act(() => opts.onNavError?.(ERROR_404));
    const overlay = screen.getByTestId("browser-error-overlay");
    expect(overlay).toBeInTheDocument();

    // Click Reload from inside the overlay — this previously cleared
    // `navError` immediately, exposing Chromium's stale `chrome-error://`
    // frame in the canvas. The overlay must stay mounted instead, since
    // a same-URL retry has nothing else to render until the new outcome
    // arrives from the backend.
    fireEvent.click(within(overlay).getByRole("button", { name: /Reload/i }));

    expect(mockSend).toHaveBeenCalledWith({ type: "reload" });
    expect(
      screen.getByTestId("browser-error-overlay"),
    ).toBeInTheDocument();
  });

  it("keeps the error overlay mounted after the user clicks Reload from the address bar", () => {
    const opts = setup();

    act(() => opts.onNavError?.(ERROR_404));
    expect(
      screen.getByTestId("browser-error-overlay"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("address-bar-reload"));

    expect(mockSend).toHaveBeenCalledWith({ type: "reload" });
    expect(
      screen.getByTestId("browser-error-overlay"),
    ).toBeInTheDocument();
  });

  it("preserves the overlay when Chromium commits its native chrome-error document", () => {
    const opts = setup();

    act(() => opts.onNavError?.(ERROR_404));
    // Chromium's native error commit re-fires `frameStartedLoading` /
    // `frameNavigated`, which surface here as another `Nav` carrying a
    // `chrome-error://...` URL. Clearing on those would wipe our overlay
    // (the regression fixed in 2a39a371e).
    act(() => opts.onNav?.(navState("chrome-error://chromewebdata/", true)));

    expect(
      screen.getByTestId("browser-error-overlay"),
    ).toBeInTheDocument();
  });

  it("clears the overlay when a real (non-chrome-error) URL commits", () => {
    const opts = setup();

    act(() => opts.onNavError?.(ERROR_404));
    expect(
      screen.getByTestId("browser-error-overlay"),
    ).toBeInTheDocument();

    // A successful retry commits the original document; that's the
    // unambiguous "page is back" signal we use to drop the overlay.
    act(() => opts.onNav?.(navState("http://127.0.0.1:8080/", false)));

    expect(
      screen.queryByTestId("browser-error-overlay"),
    ).not.toBeInTheDocument();
  });

  it("replaces the overlay's contents when a new NavError arrives", () => {
    const opts = setup();

    act(() => opts.onNavError?.(ERROR_404));
    expect(screen.getByText("This page can't be found")).toBeInTheDocument();

    act(() =>
      opts.onNavError?.({
        url: "http://127.0.0.1:8080/",
        error_text: "net::ERR_CONNECTION_RESET",
        code: -101,
      }),
    );

    expect(screen.getByText("Can't connect to server")).toBeInTheDocument();
  });

  it("routes the selected remote agent into browser spawn and hands errors to chat", () => {
    const opts = setup({
      projectId: "project-1",
      remoteAgentId: "agent-1",
    });
    expect(opts.remoteAgentId).toBe("agent-1");

    let detail: DesignPromptDetail | undefined;
    const listener = (event: Event) => {
      detail = (event as CustomEvent<DesignPromptDetail>).detail;
      event.preventDefault();
    };
    window.addEventListener(DESIGN_PROMPT_EVENT, listener);
    act(() => opts.onNavError?.(ERROR_404));
    fireEvent.click(screen.getByRole("button", { name: "Ask Agent" }));
    window.removeEventListener(DESIGN_PROMPT_EVENT, listener);

    expect(detail?.projectId).toBe("project-1");
    expect(detail?.prompt).toContain("<aura_preview_error>");
    expect(detail?.prompt).toContain("http://127.0.0.1:8080/");
  });
});

describe("BrowserInstance launch errors", () => {
  beforeEach(() => {
    capturedOpts.current = null;
    mockSend.mockClear();
    delete (window as Window & { __AURA_BOOT_AUTH__?: unknown })
      .__AURA_BOOT_AUTH__;
  });

  it("identifies hosted runtime failures without suggesting a local browser", () => {
    const opts = setup();

    act(() =>
      opts.onError?.(
        new ApiClientError(503, {
          error:
            "Could not start a supported browser. AURA supports Microsoft Edge, Google Chrome, and Chromium.",
          code: "browser_launch_failed",
          details: "Executable was blocked by organization policy",
        }),
      ),
    );

    expect(screen.getByTestId("viewport")).toHaveTextContent(
      "AURA's hosted browser could not start",
    );
    expect(screen.getByTestId("viewport")).toHaveTextContent(
      "Executable was blocked by organization policy",
    );
  });

  it("keeps legacy launch failures actionable during a rolling web update", () => {
    const opts = setup();

    act(() =>
      opts.onError?.(
        new Error(
          "browser backend error in `chromium_launch`: Could not auto detect a chrome executable",
        ),
      ),
    );

    expect(screen.getByTestId("viewport")).toHaveTextContent(
      "AURA's hosted browser could not start",
    );
    expect(screen.getByTestId("viewport")).toHaveTextContent(
      "Could not auto detect a chrome executable",
    );
    expect(screen.getByTestId("viewport")).not.toHaveTextContent(
      "Settings > Advanced",
    );
  });

  it("keeps the browser picker guidance in the desktop runtime", () => {
    Object.defineProperty(window, "__AURA_BOOT_AUTH__", {
      configurable: true,
      value: { token: "test" },
    });
    const opts = setup();

    act(() =>
      opts.onError?.(
        new Error(
          "browser backend error in `chromium_launch`: executable is missing",
        ),
      ),
    );

    expect(screen.getByTestId("viewport")).toHaveTextContent(
      "Settings > Advanced",
    );
    expect(screen.getByTestId("viewport")).toHaveTextContent(
      "Microsoft Edge",
    );
  });
});
