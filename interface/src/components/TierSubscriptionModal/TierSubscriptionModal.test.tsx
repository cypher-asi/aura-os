import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TierSubscriptionModal } from "./TierSubscriptionModal";
import { orgsApi } from "../../shared/api/orgs";

const state = vi.hoisted(() => ({ subscription: { plan: "mortal", is_subscribed: false } }));
vi.mock("../../stores/billing-store", () => ({ useBillingStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("../../shared/api/orgs", () => ({ orgsApi: {
  createSubscriptionCheckout: vi.fn().mockResolvedValue({ url: "https://checkout.example.test" }),
  createPortalSession: vi.fn().mockResolvedValue({ url: "https://portal.example.test" }),
} }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
  Button: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.subscription = { plan: "mortal", is_subscribed: false };
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => { delete (window as Window & { Capacitor?: unknown }).Capacitor; vi.restoreAllMocks(); });
it.each([false, true])("blocks native checkout and portal when is_subscribed=%s", (subscribed) => {
  state.subscription = { plan: subscribed ? "pro" : "mortal", is_subscribed: subscribed };
  Object.defineProperty(window, "Capacitor", { configurable: true, value: { isNativePlatform: () => true } });
  render(<TierSubscriptionModal isOpen onClose={vi.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(orgsApi.createSubscriptionCheckout).not.toHaveBeenCalled();
  expect(orgsApi.createPortalSession).not.toHaveBeenCalled();
});
it("allows the existing web subscription flow", async () => {
  render(<TierSubscriptionModal isOpen onClose={vi.fn()} />);
  await userEvent.click(screen.getAllByRole("button", { name: "Upgrade" })[0]);
  expect(orgsApi.createSubscriptionCheckout).toHaveBeenCalledWith("pro");
  expect(window.open).toHaveBeenCalledWith("https://checkout.example.test", "_blank");
});
