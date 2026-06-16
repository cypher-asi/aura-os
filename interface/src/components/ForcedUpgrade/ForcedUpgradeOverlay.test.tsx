import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useUpdateStatusMock = vi.fn();
vi.mock("../UpdateControl/useUpdateStatus", () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

const useAuraCapabilitiesMock = vi.fn();
vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => useAuraCapabilitiesMock(),
}));

const releasesBehindMock = vi.fn();
vi.mock("./useReleasesBehind", async () => {
  const actual =
    await vi.importActual<typeof import("./useReleasesBehind")>("./useReleasesBehind");
  return {
    ...actual,
    useReleasesBehind: () => releasesBehindMock(),
  };
});

const anyStreamingMock = vi.fn();
vi.mock("../../hooks/stream/hooks", () => ({
  useIsAnyStreaming: () => anyStreamingMock(),
}));

import { ForcedUpgradeOverlay } from "./ForcedUpgradeOverlay";

const installUpdate = vi.fn(() => Promise.resolve());

interface StatusOverrides {
  supported?: boolean;
  status?: string;
  currentVersion?: string | null;
  availableVersion?: string | null;
  installPending?: boolean;
  error?: string | null;
}

function setStatus(overrides: StatusOverrides = {}) {
  useUpdateStatusMock.mockReturnValue({
    supported: overrides.supported ?? true,
    loaded: true,
    status: overrides.status ?? "available",
    currentVersion: overrides.currentVersion ?? "0.1.0-nightly.562.1",
    availableVersion: overrides.availableVersion ?? "0.1.0-nightly.565.1",
    channel: "nightly",
    updateBaseUrl: "https://cypher-asi.github.io/aura-os",
    error: overrides.error ?? null,
    lastStep: null,
    lastCheckedAt: null,
    bundleInfo: null,
    checkPending: false,
    installPending: overrides.installPending ?? false,
    revealPending: false,
    relocatePending: false,
    checkForUpdates: vi.fn(),
    installUpdate,
    revealUpdaterLogs: vi.fn(),
    relocateAndRelaunch: vi.fn(),
  });
}

beforeEach(() => {
  useAuraCapabilitiesMock.mockReturnValue({ features: { nativeUpdater: true } });
  releasesBehindMock.mockReturnValue(3);
  anyStreamingMock.mockReturnValue(false);
  setStatus();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ForcedUpgradeOverlay", () => {
  it("renders nothing when the native updater is unavailable", () => {
    useAuraCapabilitiesMock.mockReturnValue({ features: { nativeUpdater: false } });
    const { container } = render(<ForcedUpgradeOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when fewer than 3 releases behind", () => {
    releasesBehindMock.mockReturnValue(2);
    const { container } = render(<ForcedUpgradeOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no update is available", () => {
    setStatus({ status: "up_to_date" });
    const { container } = render(<ForcedUpgradeOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks with the upgrade prompt at the threshold and installs on click", async () => {
    const user = userEvent.setup();
    render(<ForcedUpgradeOverlay />);
    expect(screen.getByTestId("forced-upgrade-overlay")).toBeInTheDocument();
    expect(screen.getByText(/3 versions behind the latest/i)).toBeInTheDocument();
    expect(screen.getByTestId("forced-upgrade-versions")).toHaveTextContent(
      /Current v0\.1\.0-nightly\.562\.1/i,
    );
    const button = screen.getByTestId("forced-upgrade-action");
    await user.click(button);
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows progress while installing", () => {
    const { rerender } = render(<ForcedUpgradeOverlay />);
    setStatus({ status: "installing" });
    rerender(<ForcedUpgradeOverlay />);
    const button = screen.getByTestId("forced-upgrade-action");
    expect(button).toBeDisabled();
    expect(button.textContent).toContain("Upgrading");
  });

  it("stays mounted (latched) after the status flips away from available", () => {
    const { rerender } = render(<ForcedUpgradeOverlay />);
    expect(screen.getByTestId("forced-upgrade-overlay")).toBeInTheDocument();

    // Mid-install the backend no longer reports `available` and the
    // release-distance hook turns indeterminate; the gate must persist.
    setStatus({ status: "installing", availableVersion: null });
    releasesBehindMock.mockReturnValue(null);
    rerender(<ForcedUpgradeOverlay />);

    expect(screen.getByTestId("forced-upgrade-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("forced-upgrade-action")).toBeDisabled();
  });

  it("surfaces a retry affordance on failure", () => {
    const { rerender } = render(<ForcedUpgradeOverlay />);
    setStatus({ status: "failed", error: "boom" });
    releasesBehindMock.mockReturnValue(null);
    rerender(<ForcedUpgradeOverlay />);
    expect(screen.getByTestId("forced-upgrade-error")).toHaveTextContent(/boom/i);
    expect(screen.getByTestId("forced-upgrade-action").textContent).toContain(
      "Try again",
    );
  });

  it("defers (renders nothing) while an operation is streaming, even at the threshold", () => {
    anyStreamingMock.mockReturnValue(true);
    const { container } = render(<ForcedUpgradeOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the gate once the streaming operation finishes", () => {
    anyStreamingMock.mockReturnValue(true);
    const { container, rerender } = render(<ForcedUpgradeOverlay />);
    expect(container).toBeEmptyDOMElement();

    anyStreamingMock.mockReturnValue(false);
    rerender(<ForcedUpgradeOverlay />);
    expect(screen.getByTestId("forced-upgrade-overlay")).toBeInTheDocument();
  });

  it("stays latched if a stream starts after the gate is already shown", () => {
    const { rerender } = render(<ForcedUpgradeOverlay />);
    expect(screen.getByTestId("forced-upgrade-overlay")).toBeInTheDocument();

    // A new operation starting must not dismiss an already-shown gate.
    anyStreamingMock.mockReturnValue(true);
    rerender(<ForcedUpgradeOverlay />);
    expect(screen.getByTestId("forced-upgrade-overlay")).toBeInTheDocument();
  });
});
