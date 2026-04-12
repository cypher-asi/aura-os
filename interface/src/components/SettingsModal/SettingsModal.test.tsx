import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogout = vi.fn();
const mockHandleChannelChange = vi.fn();
const mockOpen = vi.fn();

vi.mock("../../stores/auth-store", () => ({
  useAuth: () => ({ logout: mockLogout }),
}));

vi.mock("./useSettingsData", () => ({
  useSettingsData: () => ({
    loading: false,
    updateChannel: "stable",
    currentVersion: "1.2.3",
    showUpdater: true,
    privacyPolicyUrl: "https://example.com/privacy",
    supportUrl: "https://example.com/support",
    handleChannelChange: mockHandleChannelChange,
  }),
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ children, isOpen, title }: { children?: React.ReactNode; isOpen: boolean; title: string }) =>
    isOpen ? <div data-testid="modal"><h1>{title}</h1>{children}</div> : null,
  Heading: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Spinner: () => <div>Loading...</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../Select", () => ({
  Select: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="stable">Stable</option>
      <option value="nightly">Nightly</option>
    </select>
  ),
}));

vi.mock("./SettingsModal.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { SettingsModal } from "./SettingsModal";

describe("SettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("open", mockOpen);
  });

  it("renders support and privacy links when configured", async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText("Support & Privacy")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Privacy Policy/i }));
    expect(mockOpen).toHaveBeenCalledWith("https://example.com/privacy", "_blank", "noopener,noreferrer");

    await user.click(screen.getByRole("button", { name: /Support/i }));
    expect(mockOpen).toHaveBeenCalledWith("https://example.com/support", "_blank", "noopener,noreferrer");
  });

  it("renders logout action", async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Logout/i }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
