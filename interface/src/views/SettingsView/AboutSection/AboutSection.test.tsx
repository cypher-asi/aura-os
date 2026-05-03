import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
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

vi.mock("./AboutSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("lucide-react", () => ({
  Check: () => <span data-testid="icon-check" />,
  Download: () => <span data-testid="icon-download" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
}));

import { AboutSection } from "./AboutSection";

const DEFAULT_STATUS: DesktopUpdateStatusResponse = {
  update: { status: "up_to_date" },
  channel: "stable",
  current_version: "0.0.0-test",
  supported: true,
};

describe("AboutSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUpdateStatus.mockResolvedValue(DEFAULT_STATUS);
    mockInstallUpdate.mockResolvedValue({ ok: true });
    mockCheckForUpdates.mockResolvedValue({ ok: true });
    mockUseAuraCapabilities.mockReturnValue({
      hasDesktopBridge: true,
      isMobileClient: false,
      isMobileLayout: false,
      isPhoneLayout: false,
      isTabletLayout: false,
      isStandalone: false,
      isNativeApp: true,
      features: {
        windowControls: true,
        linkedWorkspace: true,
        nativeUpdater: true,
        hostRetargeting: false,
        ideIntegration: true,
      },
      supportsWindowControls: true,
      supportsDesktopWorkspace: true,
      supportsNativeUpdates: true,
      supportsHostRetargeting: false,
    });
  });

  it("renders build metadata under the about panel testid", () => {
    render(<AboutSection />);

    expect(screen.getByTestId("settings-about-panel")).toBeInTheDocument();
    expect(screen.getByTestId("settings-version")).toHaveTextContent("0.0.0-test");
    expect(screen.getByTestId("settings-commit")).toHaveTextContent("testcommit");
  });
});
