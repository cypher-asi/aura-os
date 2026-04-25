import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type { CreditBalance, CreditTransaction, BillingAccount, CheckoutSessionResponse } from "../shared/types";

interface BillingState {
  balance: CreditBalance | null;
  balanceLoading: boolean;
  transactions: CreditTransaction[];
  transactionsLoading: boolean;
  transactionsHasMore: boolean;
  account: BillingAccount | null;
  accountLoading: boolean;
  purchaseLoading: boolean;

  fetchBalance: (orgId: string) => Promise<void>;
  fetchTransactions: (orgId: string) => Promise<void>;
  fetchAccount: (orgId: string) => Promise<void>;
  purchase: (orgId: string, amountUsd: number) => Promise<CheckoutSessionResponse | null>;
  reset: () => void;
}

const INITIAL: Pick<
  BillingState,
  | "balance"
  | "balanceLoading"
  | "transactions"
  | "transactionsLoading"
  | "transactionsHasMore"
  | "account"
  | "accountLoading"
  | "purchaseLoading"
> = {
  balance: null,
  balanceLoading: false,
  transactions: [],
  transactionsLoading: false,
  transactionsHasMore: false,
  account: null,
  accountLoading: false,
  purchaseLoading: false,
};

export const useBillingStore = create<BillingState>()((set) => ({
  ...INITIAL,

  fetchBalance: async (orgId) => {
    set({ balanceLoading: true });
    try {
      const balance = await api.orgs.getCreditBalance(orgId);
      set({ balance, balanceLoading: false });
    } catch {
      set({ balanceLoading: false });
    }
  },

  fetchTransactions: async (orgId) => {
    set({ transactionsLoading: true });
    try {
      const resp = await api.orgs.getTransactions(orgId);
      set({
        transactions: resp.transactions,
        transactionsHasMore: resp.has_more,
        transactionsLoading: false,
      });
    } catch {
      set({ transactionsLoading: false });
    }
  },

  fetchAccount: async (orgId) => {
    set({ accountLoading: true });
    try {
      const account = await api.orgs.getAccount(orgId);
      set({ account, accountLoading: false });
    } catch {
      set({ accountLoading: false });
    }
  },

  purchase: async (orgId, amountUsd) => {
    set({ purchaseLoading: true });
    try {
      const result = await api.orgs.createCreditCheckout(orgId, amountUsd);
      set({ purchaseLoading: false });
      return result;
    } catch {
      set({ purchaseLoading: false });
      return null;
    }
  },

  reset: () => set({ ...INITIAL }),
}));

export function useBilling() {
  return useBillingStore(
    useShallow((s) => ({
      balance: s.balance,
      balanceLoading: s.balanceLoading,
      transactions: s.transactions,
      transactionsLoading: s.transactionsLoading,
      transactionsHasMore: s.transactionsHasMore,
      account: s.account,
      accountLoading: s.accountLoading,
      purchaseLoading: s.purchaseLoading,
      fetchBalance: s.fetchBalance,
      fetchTransactions: s.fetchTransactions,
      fetchAccount: s.fetchAccount,
      purchase: s.purchase,
      reset: s.reset,
    })),
  );
}
