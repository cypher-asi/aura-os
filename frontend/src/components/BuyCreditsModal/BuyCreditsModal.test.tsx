import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockHandlePurchase = vi.fn();
const mockLoadBalance = vi.fn();

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
    expect(screen.getByText("Buy More Credits")).toBeInTheDocument();
  });

  it("shows the current balance", () => {
    renderModal();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
  });

  it("renders preset buttons", () => {
    renderModal();
    expect(screen.getByText("$5")).toBeInTheDocument();
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(screen.getByText("$50")).toBeInTheDocument();
  });

  it("calls handlePurchase with preset amount", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("$25"));
    await user.click(screen.getByText("Purchase $25"));
    expect(mockHandlePurchase).toHaveBeenCalledWith(25);
  });

  it("shows Billing Settings link", () => {
    renderModal({ onOpenBilling: vi.fn() });
    expect(screen.getByText("Billing Settings")).toBeInTheDocument();
  });

  it("disables purchase when no amount selected", () => {
    renderModal();
    expect(screen.getByText("Select an amount")).toBeDisabled();
  });
});
