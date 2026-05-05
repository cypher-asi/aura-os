import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUseAuraCapabilities = vi.fn(() => ({ isNativeApp: false }));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Input: ({ value, onChange, placeholder, disabled, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} {...rest} />
  ),
}));

vi.mock("../OrgSettingsPanel/OrgSettingsPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("./OrgSettingsBilling.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../stores/billing-store", () => {
  const state = {
    subscription: null as { plan: string; is_subscribed: boolean; monthly_credits: number } | null,
    subscriptionLoading: false,
    fetchSubscription: vi.fn().mockResolvedValue(undefined),
  };
  const store = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state, setState: vi.fn() },
  );
  return { useBillingStore: store };
});

import { OrgSettingsBilling } from "./OrgSettingsBilling";
import type { CheckoutPollingStatus } from "../../hooks/use-checkout-polling";

const defaultProps = {
  billing: { billing_email: "test@example.com", plan: "free" },
  billingEmail: "test@example.com",
  isAdminOrOwner: true,
  balance: { balance_cents: 500, plan: "free", balance_formatted: "$5.00" },
  balanceLoading: false,
  balanceError: null,
  checkoutError: null,
  pollingStatus: "idle" as CheckoutPollingStatus,
  onPurchase: vi.fn(),
  onRetryBalance: vi.fn(),
};

function renderBilling(overrides: Partial<typeof defaultProps> = {}) {
  return render(<OrgSettingsBilling {...defaultProps} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrgSettingsBilling", () => {
  it("renders the current balance formatted", () => {
    renderBilling();
    expect(screen.getByText("500 credits")).toBeInTheDocument();
  });

  it("renders preset buttons", () => {
    renderBilling();
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });

  it("calls onPurchase with preset amount", async () => {
    const onPurchase = vi.fn();
    const user = userEvent.setup();
    renderBilling({ onPurchase });

    await user.click(screen.getByText("$25"));
    await user.click(screen.getByText("Purchase $25"));
    expect(onPurchase).toHaveBeenCalledWith(25);
  });

  it("calls onPurchase with custom amount", async () => {
    const onPurchase = vi.fn();
    const user = userEvent.setup();
    renderBilling({ onPurchase });

    await user.type(screen.getByPlaceholderText("e.g. 15"), "15");
    await user.click(screen.getByText("Purchase $15"));
    expect(onPurchase).toHaveBeenCalledWith(15);
  });

  it("disables purchase button when no amount selected", () => {
    renderBilling();
    expect(screen.getByText("Purchase")).toBeDisabled();
  });

  it("hides purchase section for non-admin users", () => {
    renderBilling({ isAdminOrOwner: false });
    expect(screen.queryByText("Buy Credits")).not.toBeInTheDocument();
    expect(screen.queryByText("$5")).not.toBeInTheDocument();
  });

  it("shows balance loading state", () => {
    renderBilling({ balance: null, balanceLoading: true });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows balance error with retry", () => {
    renderBilling({ balance: null, balanceError: "Server error" });
    expect(screen.getByText(/Server error/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows checkout error", () => {
    renderBilling({ checkoutError: "Checkout failed" });
    expect(screen.getByText("Checkout failed")).toBeInTheDocument();
  });

  it("shows polling status", () => {
    renderBilling({ pollingStatus: "polling" });
    expect(screen.getByText("Waiting for payment confirmation...")).toBeInTheDocument();
  });

  it("disables buttons during polling", () => {
    renderBilling({ pollingStatus: "polling" });
    const presetButtons = screen.getAllByRole("button").filter(b => b.textContent?.startsWith("$"));
    presetButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("shows plan badge", () => {
    renderBilling();
    expect(screen.getByText("free")).toBeInTheDocument();
  });

  it("renders the billing email as read-only text (no input, no save button)", () => {
    renderBilling();
    expect(screen.getByText("Billing Email")).toBeInTheDocument();
    expect(screen.getByText(/Tied to your ZERO account/i)).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("billing@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
  });

  it("hides the billing email row for non-admin users", () => {
    renderBilling({ isAdminOrOwner: false });
    expect(screen.queryByText("Billing Email")).not.toBeInTheDocument();
  });

  it("shows an em-dash fallback when billing email is missing", () => {
    renderBilling({ billingEmail: "" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a web-only message in native apps", () => {
    mockUseAuraCapabilities.mockReturnValue({ isNativeApp: true });

    renderBilling();

    expect(screen.getByText(/aren't available in the mobile app/i)).toBeInTheDocument();
    expect(screen.getByText("Credit Purchases")).toBeInTheDocument();
    expect(screen.queryByText("$5")).not.toBeInTheDocument();
    expect(screen.queryByText("Purchase")).not.toBeInTheDocument();
  });
});
