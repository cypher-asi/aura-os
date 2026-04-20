import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DesktopUpdateStatusResponse } from "../../api/desktop";

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
}));

vi.mock("./SettingsView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("lucide-react", () => ({
  Check: () => <span data-testid="icon-check" />,
  Download: () => <span data-testid="icon-download" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
}));

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

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUpdateStatus.mockResolvedValue(DEFAULT_STATUS);
    mockInstallUpdate.mockResolvedValue({ ok: true });
    mockCheckForUpdates.mockResolvedValue({ ok: true });
    setCapabilities(true);
  });

  it("renders build metadata from the compile-time constants", () => {
    render(<SettingsView />);

    expect(screen.getByTestId("settings-version")).toHaveTextContent("0.0.0-test");
    expect(screen.getByTestId("settings-channel")).toHaveTextContent(/Test/);
    expect(screen.getByTestId("settings-commit")).toHaveTextContent("testcommit");
    expect(screen.getByTestId("settings-build-time").textContent).toMatch(/2026/);
  });

  it("shows the server-managed message when native updater is unavailable", async () => {
    setCapabilities(false);
    render(<SettingsView />);

    expect(await screen.findByTestId("settings-update-unsupported")).toHaveTextContent(
      /delivered automatically by the server/i,
    );
    expect(mockGetUpdateStatus).not.toHaveBeenCalled();
    expect(screen.queryByTestId("settings-update-check")).toBeNull();
    expect(screen.queryByTestId("settings-update-install")).toBeNull();
  });

  it("shows 'latest version' and triggers a check on click", async () => {
    render(<SettingsView />);

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

    render(<SettingsView />);

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

    render(<SettingsView />);

    expect(await screen.findByTestId("settings-update-failed")).toHaveTextContent(
      /network down/,
    );
    expect(screen.getByTestId("settings-update-retry")).toBeTruthy();
  });
});
