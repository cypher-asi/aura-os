import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { DesktopUpdateStatusResponse } from "../../../shared/api/desktop";

const mockGetUpdateStatus = vi.fn();
const mockInstallUpdate = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockUseAuraCapabilities = vi.fn();

vi.mock("../../../api/client", () => ({
  api: {
    getUpdateStatus: (...args: unknown[]) => mockGetUpdateStatus(...args),
    installUpdate: (...args: unknown[]) => mockInstallUpdate(...args),
    checkForUpdates: (...args: unknown[]) => mockCheckForUpdates(...args),
  },
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <select
      data-testid={rest["data-testid"] as string | undefined}
      aria-label={rest["aria-label"] as string | undefined}
      value={rest.value as string | number | readonly string[] | undefined}
      onChange={
        rest.onChange as ((e: React.ChangeEvent<HTMLSelectElement>) => void) | undefined
      }
    >
      {children}
    </select>
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

vi.mock("./MobileSettingsView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../views/SettingsView/AboutSection/AboutSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../views/SettingsView/AppearanceSection/AppearanceSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../views/SettingsView/NotificationsSection/NotificationsSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../views/SettingsView/KeyboardSection/KeyboardSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../views/SettingsView/AdvancedSection/AdvancedSection.module.css", () => ({
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

import { MobileSettingsView } from "./MobileSettingsView";

const DEFAULT_STATUS: DesktopUpdateStatusResponse = {
  update: { status: "up_to_date" },
  channel: "stable",
  current_version: "0.0.0-test",
  supported: true,
};

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/projects/settings" element={<MobileSettingsView />} />
        <Route path="/projects/settings/:section" element={<MobileSettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MobileSettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUpdateStatus.mockResolvedValue(DEFAULT_STATUS);
    mockInstallUpdate.mockResolvedValue({ ok: true });
    mockCheckForUpdates.mockResolvedValue({ ok: true });
    mockUseAuraCapabilities.mockReturnValue({
      hasDesktopBridge: false,
      isMobileClient: true,
      isMobileLayout: true,
      isPhoneLayout: true,
      isTabletLayout: false,
      isStandalone: false,
      isNativeApp: false,
      features: {
        windowControls: false,
        linkedWorkspace: false,
        nativeUpdater: false,
        hostRetargeting: true,
        ideIntegration: false,
      },
      supportsWindowControls: false,
      supportsDesktopWorkspace: false,
      supportsNativeUpdates: false,
      supportsHostRetargeting: true,
    });
  });

  it("renders a row per section on /projects/settings", () => {
    renderAt("/projects/settings");

    expect(screen.getByTestId("mobile-settings-list")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-settings-row-about")).toHaveTextContent("About");
    expect(screen.getByTestId("mobile-settings-row-appearance")).toHaveTextContent("Appearance");
    expect(screen.getByTestId("mobile-settings-row-notifications")).toHaveTextContent("Notifications");
    expect(screen.getByTestId("mobile-settings-row-keyboard")).toHaveTextContent("Keyboard");
    expect(screen.getByTestId("mobile-settings-row-advanced")).toHaveTextContent("Advanced");
  });

  it("tapping a row drills into the section detail screen", async () => {
    renderAt("/projects/settings");

    await userEvent.click(screen.getByTestId("mobile-settings-row-appearance"));

    expect(screen.getByTestId("mobile-settings-detail-appearance")).toBeInTheDocument();
    expect(screen.getByTestId("settings-appearance-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-settings-list")).toBeNull();
  });

  it("renders the About detail with the legacy mobile-settings-about-panel testid", async () => {
    renderAt("/projects/settings/about");

    expect(screen.getByTestId("mobile-settings-detail-about")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-settings-about-panel")).toBeInTheDocument();
    expect(screen.getByTestId("settings-about-panel")).toBeInTheDocument();
  });

  it("redirects an unknown section back to the list", () => {
    renderAt("/projects/settings/nope");

    expect(screen.getByTestId("mobile-settings-list")).toBeInTheDocument();
  });

  it("the back button returns to the list view", async () => {
    renderAt("/projects/settings/keyboard");

    expect(screen.getByTestId("mobile-settings-detail-keyboard")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("mobile-settings-back"));

    expect(screen.getByTestId("mobile-settings-list")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-settings-detail-keyboard")).toBeNull();
  });
});
