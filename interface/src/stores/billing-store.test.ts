import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  CreditBalance,
  CreditTransaction,
  BillingAccount,
  CheckoutSessionResponse,
} from "../types";

const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    orgs: {
      getCreditBalance: vi.fn(),
      getTransactions: vi.fn(),
      getAccount: vi.fn(),
      createCreditCheckout: vi.fn(),
    },
  };
  return { mockApi };
});

vi.mock("../api/client", () => ({
  api: mockApi,
}));

import { useBillingStore } from "./billing-store";

const mockBalance: CreditBalance = {
  balance_cents: 5000,
  plan: "pro",
  balance_formatted: "$50.00",
};

const mockTransaction: CreditTransaction = {
  id: "tx-1",
  amount_cents: 1000,
  transaction_type: "purchase",
  balance_after_cents: 5000,
  description: "Credit purchase",
  created_at: "2025-01-01T00:00:00Z",
};

const mockAccount: BillingAccount = {
  user_id: "u1",
  balance_cents: 5000,
  balance_formatted: "$50.00",
  lifetime_purchased_cents: 10000,
  lifetime_granted_cents: 0,
  lifetime_used_cents: 5000,
  plan: "pro",
  auto_refill_enabled: false,
  created_at: "2025-01-01T00:00:00Z",
};

const mockCheckout: CheckoutSessionResponse = {
  checkout_url: "https://checkout.stripe.com/session_123",
  session_id: "sess_123",
};

beforeEach(() => {
  useBillingStore.getState().reset();
  vi.clearAllMocks();
});

describe("billing-store", () => {
  describe("initial state", () => {
    it("has null balance", () => {
      expect(useBillingStore.getState().balance).toBeNull();
    });

    it("has no transactions", () => {
      expect(useBillingStore.getState().transactions).toEqual([]);
    });

    it("has null account", () => {
      expect(useBillingStore.getState().account).toBeNull();
    });

    it("all loading flags are false", () => {
      const s = useBillingStore.getState();
      expect(s.balanceLoading).toBe(false);
      expect(s.transactionsLoading).toBe(false);
      expect(s.accountLoading).toBe(false);
      expect(s.purchaseLoading).toBe(false);
    });
  });

  describe("fetchBalance", () => {
    it("fetches and stores the balance", async () => {
      mockApi.orgs.getCreditBalance.mockResolvedValue(mockBalance);
      await useBillingStore.getState().fetchBalance("org-1");
      expect(mockApi.orgs.getCreditBalance).toHaveBeenCalledWith("org-1");
      expect(useBillingStore.getState().balance).toEqual(mockBalance);
      expect(useBillingStore.getState().balanceLoading).toBe(false);
    });

    it("clears loading on error", async () => {
      mockApi.orgs.getCreditBalance.mockRejectedValue(new Error("fail"));
      await useBillingStore.getState().fetchBalance("org-1");
      expect(useBillingStore.getState().balanceLoading).toBe(false);
    });
  });

  describe("fetchTransactions", () => {
    it("fetches and stores transactions", async () => {
      mockApi.orgs.getTransactions.mockResolvedValue({
        transactions: [mockTransaction],
        has_more: true,
      });
      await useBillingStore.getState().fetchTransactions("org-1");
      expect(useBillingStore.getState().transactions).toEqual([mockTransaction]);
      expect(useBillingStore.getState().transactionsHasMore).toBe(true);
      expect(useBillingStore.getState().transactionsLoading).toBe(false);
    });

    it("clears loading on error", async () => {
      mockApi.orgs.getTransactions.mockRejectedValue(new Error("fail"));
      await useBillingStore.getState().fetchTransactions("org-1");
      expect(useBillingStore.getState().transactionsLoading).toBe(false);
    });
  });

  describe("fetchAccount", () => {
    it("fetches and stores the account", async () => {
      mockApi.orgs.getAccount.mockResolvedValue(mockAccount);
      await useBillingStore.getState().fetchAccount("org-1");
      expect(mockApi.orgs.getAccount).toHaveBeenCalledWith("org-1");
      expect(useBillingStore.getState().account).toEqual(mockAccount);
      expect(useBillingStore.getState().accountLoading).toBe(false);
    });

    it("clears loading on error", async () => {
      mockApi.orgs.getAccount.mockRejectedValue(new Error("fail"));
      await useBillingStore.getState().fetchAccount("org-1");
      expect(useBillingStore.getState().accountLoading).toBe(false);
    });
  });

  describe("purchase", () => {
    it("creates a checkout session and returns it", async () => {
      mockApi.orgs.createCreditCheckout.mockResolvedValue(mockCheckout);
      const result = await useBillingStore.getState().purchase("org-1", 25);
      expect(mockApi.orgs.createCreditCheckout).toHaveBeenCalledWith("org-1", 25);
      expect(result).toEqual(mockCheckout);
      expect(useBillingStore.getState().purchaseLoading).toBe(false);
    });

    it("returns null on error", async () => {
      mockApi.orgs.createCreditCheckout.mockRejectedValue(new Error("fail"));
      const result = await useBillingStore.getState().purchase("org-1", 25);
      expect(result).toBeNull();
      expect(useBillingStore.getState().purchaseLoading).toBe(false);
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", async () => {
      mockApi.orgs.getCreditBalance.mockResolvedValue(mockBalance);
      await useBillingStore.getState().fetchBalance("org-1");
      useBillingStore.getState().reset();
      expect(useBillingStore.getState().balance).toBeNull();
      expect(useBillingStore.getState().transactions).toEqual([]);
      expect(useBillingStore.getState().account).toBeNull();
    });
  });
});
