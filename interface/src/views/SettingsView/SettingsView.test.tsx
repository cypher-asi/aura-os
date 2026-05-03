import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { DesktopUpdateStatusResponse } from "../../shared/api/desktop";

const mockGetUpdateStatus = vi.fn();
const mockInstallUpdate = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockUseAuraCapabilities = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    getUpdateStatus: (...args: unknown[]) => mockGetUpdateStatus(...args),
    installUpdate: (...args: unknown[]) => mockInstallUpdate(...args),
    checkForUpdates: (...args: unknown[]) => mockCheckForUpdates(...args),
  },
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Page: ({ children }: { children?: React.ReactNode; title?: string; subtitle?: string }) => (
    <div>{children}</div>
  ),
  Panel: ({
    children,
    ...rest
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div data-testid={rest["data-testid"] as string | undefined}>{children}</div>
  ),
  Text: ({
    children,
    className,
    ...rest
  }: {
    children?: React.ReactNode;
    className?: string;
  } & Record<string, unknown>) => (
    <span className={className} data-testid={rest["data-testid"] as string | undefined}>
      {children}
    </span>
  ),
  Button: ({
    children,
    onClick,
    disabled,
    icon,
    ...rest
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    icon?: React.ReactNode;
  } & Record<string, unknown>) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={rest["data-testid"] as string | undefined}
    >
      {icon}
      {children}
    </button>
  ),
  Spinner: () => <span data-testid="spinner" />,
  Select: ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <select
      data-testid={rest["data-testid"] as string | undefined}
      aria-label={rest["aria-label"] as string | undefined}
      value={rest.value as string | number | readonly string[] | undefined}
      onChange={
        rest.onChange as
          | ((e: React.ChangeEvent<HTMLSelectElement>) => void)
          | undefined
      }
    >
      {children}
    </select>
  ),
  Navigator: ({
    items,
    value,
    onChange,
  }: {
    items: { id: string; label: string }[];
    value?: string;
    onChange?: (id: string) => void;
  }) => (
    <nav data-testid="settings-navigator">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`nav-item-${item.id}`}
          aria-current={value === item.id ? "page" : undefined}
          onClick={() => onChange?.(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  ),
  THEMES: ["dark", "light", "system"],
  ACCENT_COLORS: ["cyan", "blue", "purple", "green", "orange", "rose"],
  useTheme: () => ({
    theme: "dark",
    accent: "purple",
    resolvedTheme: "dark",
    systemTheme: "dark",
    setTheme: vi.fn(),
    setAccent: vi.fn(),
  }),
}));

vi.mock("./SettingsView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./AppearanceSection/AppearanceSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./AboutSection/AboutSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./NotificationsSection/NotificationsSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./KeyboardSection/KeyboardSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("./AdvancedSection/AdvancedSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("lucide-react", () => {
  const Stub = ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <span data-testid={testId} />
  );
  return {
    Check: Stub,
    Download: Stub,
    RefreshCw: Stub,
    Sun: Stub,
    Moon: Stub,
    MonitorSmartphone: Stub,
    Info: Stub,
    Paintbrush: Stub,
    Bell: Stub,
    Keyboard: Stub,
    Settings: Stub,
    ChevronRight: Stub,
    ArrowLeft: Stub,
  };
});

import { SettingsView } from "./SettingsView";

const DEFAULT_STATUS: DesktopUpdateStatusResponse = {
  update: { status: "up_to_date" },
  channel: "stable",
  current_version: "0.0.0-test",
  supported: true,
};

function setCapabilities(nativeUpdater: boolean) {
  mockUseAuraCapabilities.mockReturnValue({
    hasDesktopBridge: nativeUpdater,
    isMobileClient: false,
    isMobileLayout: false,
    isPhoneLayout: false,
    isTabletLayout: false,
    isStandalone: false,
    isNativeApp: nativeUpdater,
    features: {
      windowControls: nativeUpdater,
      linkedWorkspace: nativeUpdater,
      nativeUpdater,
      hostRetargeting: !nativeUpdater,
      ideIntegration: nativeUpdater,
    },
    supportsWindowControls: nativeUpdater,
    supportsDesktopWorkspace: nativeUpdater,
    supportsNativeUpdates: nativeUpdater,
    supportsHostRetargeting: !nativeUpdater,
  });
}

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/projects/settings" element={<SettingsView />} />
        <Route path="/projects/settings/:section" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUpdateStatus.mockResolvedValue(DEFAULT_STATUS);
    mockInstallUpdate.mockResolvedValue({ ok: true });
    mockCheckForUpdates.mockResolvedValue({ ok: true });
    setCapabilities(true);
  });

  it("redirects /projects/settings (no section) to the default about section", async () => {
    renderAt("/projects/settings");

    expect(await screen.findByTestId("settings-about-panel")).toBeInTheDocument();
  });

  it("redirects an unknown section to the default about section", async () => {
    renderAt("/projects/settings/not-a-real-section");

    expect(await screen.findByTestId("settings-about-panel")).toBeInTheDocument();
  });

  it("renders the navigator with every section label", () => {
    renderAt("/projects/settings/about");

    expect(screen.getByTestId("settings-navigator")).toBeInTheDocument();
    expect(screen.getByTestId("nav-item-about")).toHaveTextContent("About");
    expect(screen.getByTestId("nav-item-appearance")).toHaveTextContent("Appearance");
    expect(screen.getByTestId("nav-item-notifications")).toHaveTextContent("Notifications");
    expect(screen.getByTestId("nav-item-keyboard")).toHaveTextContent("Keyboard");
    expect(screen.getByTestId("nav-item-advanced")).toHaveTextContent("Advanced");
  });

  it("renders only the about pane when on /projects/settings/about", () => {
    renderAt("/projects/settings/about");

    expect(screen.getByTestId("settings-about-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-appearance-panel")).toBeNull();
    expect(screen.queryByTestId("settings-advanced-panel")).toBeNull();
  });

  it("renders only the appearance pane when on /projects/settings/appearance", () => {
    renderAt("/projects/settings/appearance");

    expect(screen.getByTestId("settings-appearance-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-about-panel")).toBeNull();
  });

  it("renders the advanced placeholder with the env-vars copy", () => {
    renderAt("/projects/settings/advanced");

    expect(screen.getByTestId("settings-advanced-panel")).toBeInTheDocument();
    expect(screen.getByText(/\.env\.example/)).toBeInTheDocument();
  });

  it("clicking a navigator item switches the visible pane", async () => {
    renderAt("/projects/settings/about");

    expect(screen.getByTestId("settings-about-panel")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("nav-item-appearance"));

    await waitFor(() => {
      expect(screen.queryByTestId("settings-about-panel")).toBeNull();
    });
    expect(screen.getByTestId("settings-appearance-panel")).toBeInTheDocument();
  });

  it("renders build metadata in the about pane", () => {
    renderAt("/projects/settings/about");

    expect(screen.getByTestId("settings-version")).toHaveTextContent("0.0.0-test");
    expect(screen.getByTestId("settings-channel")).toHaveTextContent(/Test/);
    expect(screen.getByTestId("settings-commit")).toHaveTextContent("testcommit");
    expect(screen.getByTestId("settings-build-time").textContent).toMatch(/2026/);
  });

  it("shows the server-managed message when native updater is unavailable", async () => {
    setCapabilities(false);
    renderAt("/projects/settings/about");

    expect(await screen.findByTestId("settings-update-unsupported")).toHaveTextContent(
      /delivered automatically by the server/i,
    );
    expect(mockGetUpdateStatus).not.toHaveBeenCalled();
    expect(screen.queryByTestId("settings-update-check")).toBeNull();
    expect(screen.queryByTestId("settings-update-install")).toBeNull();
  });

  it("shows 'latest version' and triggers a check on click", async () => {
    renderAt("/projects/settings/about");

    const latest = await screen.findByTestId("settings-update-latest");
    expect(latest).toHaveTextContent(/latest version/i);

    await userEvent.click(screen.getByTestId("settings-update-check"));
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockGetUpdateStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows an install button when an update is available", async () => {
    mockGetUpdateStatus.mockResolvedValue({
      ...DEFAULT_STATUS,
      update: { status: "available", version: "1.2.3" },
    });

    renderAt("/projects/settings/about");

    const installBtn = await screen.findByTestId("settings-update-install");
    expect(screen.getByTestId("settings-update-available")).toHaveTextContent(/1\.2\.3/);

    await userEvent.click(installBtn);
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the error state and a retry button when the update failed", async () => {
    mockGetUpdateStatus.mockResolvedValue({
      ...DEFAULT_STATUS,
      update: { status: "failed", error: "network down" },
    });

    renderAt("/projects/settings/about");

    expect(await screen.findByTestId("settings-update-failed")).toHaveTextContent(
      /network down/,
    );
    expect(screen.getByTestId("settings-update-retry")).toBeTruthy();
  });
});
