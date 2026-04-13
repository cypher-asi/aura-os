import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockHandlePurchase = vi.fn();
const mockLoadBalance = vi.fn();
const mockUseAuraCapabilities = vi.fn(() => ({ isNativeApp: false }));

vi.mock("./useBuyCreditsData", () => ({
  useBuyCreditsData: () => ({
    balance: { balance_cents: 1000, plan: "free", balance_formatted: "$10.00" },
    balanceLoading: false,
    balanceError: null,
    purchaseLoading: false,
    checkoutError: null,
    pollingStatus: "idle",
    isPolling: false,
    balanceDisplay: "$10.00",
    loadBalance: mockLoadBalance,
    handlePurchase: mockHandlePurchase,
  }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Modal: ({ children, isOpen, title, footer }: { children?: React.ReactNode; isOpen: boolean; title: string; onClose: () => void; size?: string; footer?: React.ReactNode }) =>
    isOpen ? <div data-testid="modal"><h1>{title}</h1>{children}{footer}</div> : null,
  Input: ({ value, onChange, placeholder, disabled, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} {...rest} />
  ),
}));

vi.mock("./BuyCreditsModal.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { BuyCreditsModal } from "./BuyCreditsModal";

const onClose = vi.fn();

function renderModal(props: Partial<Parameters<typeof BuyCreditsModal>[0]> = {}) {
  return render(<BuyCreditsModal isOpen onClose={onClose} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BuyCreditsModal", () => {
  it("renders the modal with title", () => {
    renderModal();
    expect(screen.getByText("BUY CREDITS")).toBeInTheDocument();
  });

  it("shows the current balance", () => {
    renderModal();
    expect(screen.getByText("1,000 Z")).toBeInTheDocument();
    expect(screen.getAllByText("$10.00")).toHaveLength(2);
  });

  it("renders preset buttons", () => {
    renderModal();
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });

  it("calls handlePurchase with preset amount", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("$50"));
    await user.click(screen.getByText("Purchase $50"));
    expect(mockHandlePurchase).toHaveBeenCalledWith(50);
  });

  it("shows Billing Settings link", () => {
    renderModal({ onOpenBilling: vi.fn() });
    expect(screen.getByText("Billing Settings")).toBeInTheDocument();
  });

  it("defaults to $100 preset selected", () => {
    renderModal();
    expect(screen.getByText("Purchase $100")).toBeInTheDocument();
  });

  it("shows a web-only billing message in native apps", () => {
    mockUseAuraCapabilities.mockReturnValue({ isNativeApp: true });

    renderModal();

    expect(screen.getByText(/aren't available in the mobile app/i)).toBeInTheDocument();
    expect(screen.queryByText("$25")).not.toBeInTheDocument();
    expect(screen.queryByText("Purchase $100")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing Settings")).not.toBeInTheDocument();
  });
});
