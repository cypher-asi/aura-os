import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useUpdateBannerMock = vi.fn();

vi.mock("./useUpdateBanner", () => ({
  useUpdateBanner: () => useUpdateBannerMock(),
}));

import { UpdatePill } from "./UpdatePill";

const handleInstallUpdate = vi.fn();

interface MockOverrides {
  enabled?: boolean;
  data?: unknown;
  installPending?: boolean;
}

function setMockState(overrides: MockOverrides = {}) {
  useUpdateBannerMock.mockReturnValue({
    enabled: true,
    data: null,
    installPending: false,
    dismissAvailableUpdate: vi.fn(),
    handleInstallUpdate,
    ...overrides,
  });
}

function statusPayload(status: string, version?: string) {
  return {
    update: { status, ...(version ? { version } : {}) },
    channel: "nightly" as const,
    current_version: "0.1.0",
  };
}

beforeEach(() => {
  handleInstallUpdate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdatePill", () => {
  it("renders nothing when the native updater is disabled", () => {
    setMockState({ enabled: false });
    const { container } = render(<UpdatePill />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no update payload has been polled yet", () => {
    setMockState({ data: null });
    const { container } = render(<UpdatePill />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for non-actionable statuses (idle / up-to-date / failed)", () => {
    for (const status of ["idle", "up-to-date", "failed"]) {
      setMockState({ data: statusPayload(status) });
      const { container, unmount } = render(<UpdatePill />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("renders the 'Update' pill when an update is available and installs on click", async () => {
    const user = userEvent.setup();
    setMockState({ data: statusPayload("available", "0.2.0") });
    render(<UpdatePill />);
    const button = screen.getByRole("button", { name: /update aura to v0\.2\.0/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button.textContent).toContain("Update");
    await user.click(button);
    expect(handleInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders the disabled installing state while an install is pending", () => {
    setMockState({
      data: statusPayload("available", "0.2.0"),
      installPending: true,
    });
    render(<UpdatePill />);
    const button = screen.getByRole("button", { name: /installing aura update/i });
    expect(button).toBeDisabled();
  });

  it("renders the disabled installing state when the backend reports installing", () => {
    setMockState({ data: statusPayload("installing", "0.2.0") });
    render(<UpdatePill />);
    const button = screen.getByRole("button", { name: /installing aura update v0\.2\.0/i });
    expect(button).toBeDisabled();
  });

  it("renders the disabled installing state when the backend reports downloading", () => {
    setMockState({ data: statusPayload("downloading", "0.2.0") });
    render(<UpdatePill />);
    const button = screen.getByRole("button", { name: /installing aura update v0\.2\.0/i });
    expect(button).toBeDisabled();
  });
});
