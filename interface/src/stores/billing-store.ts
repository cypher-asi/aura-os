import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import {
  billingAccountQueryOptions,
  billingBalanceQueryOptions,
  billingQueryKeys,
  billingTransactionsQueryOptions,
} from "../queries/billing-queries";
import { queryClient } from "../shared/lib/query-client";
import { orgsApi } from "../shared/api/orgs";
import type { CreditBalance, CreditTransaction, BillingAccount, CheckoutSessionResponse } from "../shared/types";

export interface SubscriptionInfo {
  plan: string;
  is_subscribed: boolean;
  monthly_credits: number;
  current_period_end?: string;
}

interface BillingState {
  balance: CreditBalance | null;
  balanceLoading: boolean;
  transactions: CreditTransaction[];
  transactionsLoading: boolean;
  transactionsHasMore: boolean;
  account: BillingAccount | null;
  accountLoading: boolean;
  purchaseLoading: boolean;
  subscription: SubscriptionInfo | null;
  subscriptionLoading: boolean;

  fetchBalance: (orgId: string) => Promise<void>;
  fetchTransactions: (orgId: string) => Promise<void>;
  fetchAccount: (orgId: string) => Promise<void>;
  fetchSubscription: () => Promise<void>;
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
  | "subscription"
  | "subscriptionLoading"
> = {
  balance: null,
  balanceLoading: false,
  transactions: [],
  transactionsLoading: false,
  transactionsHasMore: false,
  account: null,
  accountLoading: false,
  purchaseLoading: false,
  subscription: null,
  subscriptionLoading: false,
};

export const useBillingStore = create<BillingState>()((set) => ({
  ...INITIAL,

  fetchBalance: async (orgId) => {
    set({ balanceLoading: true });
    try {
      const balance = await queryClient.fetchQuery({
        ...billingBalanceQueryOptions(orgId),
        staleTime: 0,
      });
      set({ balance, balanceLoading: false });
    } catch {
      set({ balanceLoading: false });
    }
  },

  fetchTransactions: async (orgId) => {
    set({ transactionsLoading: true });
    try {
      const resp = await queryClient.fetchQuery({
        ...billingTransactionsQueryOptions(orgId),
        staleTime: 0,
      });
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
      const account = await queryClient.fetchQuery({
        ...billingAccountQueryOptions(orgId),
        staleTime: 0,
      });
      set({ account, accountLoading: false });
    } catch {
      set({ accountLoading: false });
    }
  },

  fetchSubscription: async () => {
    set({ subscriptionLoading: true });
    try {
      const sub = await orgsApi.getSubscriptionStatus();
      set({ subscription: sub, subscriptionLoading: false });
    } catch {
      set({ subscriptionLoading: false });
    }
  },

  purchase: async (orgId, amountUsd) => {
    set({ purchaseLoading: true });
    try {
      const result = await api.orgs.createCreditCheckout(orgId, amountUsd);
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.balance(orgId) });
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.transactions(orgId) });
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.account(orgId) });
      set({ purchaseLoading: false });
      return result;
    } catch {
      set({ purchaseLoading: false });
      return null;
    }
  },

  reset: () => {
    queryClient.removeQueries({ queryKey: billingQueryKeys.root });
    set({ ...INITIAL });
  },
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
      subscription: s.subscription,
      subscriptionLoading: s.subscriptionLoading,
      fetchBalance: s.fetchBalance,
      fetchTransactions: s.fetchTransactions,
      fetchAccount: s.fetchAccount,
      fetchSubscription: s.fetchSubscription,
      purchase: s.purchase,
      reset: s.reset,
    })),
  );
}
