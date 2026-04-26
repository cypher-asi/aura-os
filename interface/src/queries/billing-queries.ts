import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryClient } from "../shared/lib/query-client";
import type {
  BillingAccount,
  CheckoutSessionResponse,
  CreditBalance,
  TransactionsResponse,
} from "../shared/types";

export const billingQueryKeys = {
  root: ["billing"] as const,
  balance: (orgId: string) => ["billing", "balance", orgId] as const,
  transactions: (orgId: string) => ["billing", "transactions", orgId] as const,
  account: (orgId: string) => ["billing", "account", orgId] as const,
};

export function billingBalanceQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: billingQueryKeys.balance(orgId),
    queryFn: (): Promise<CreditBalance> => api.orgs.getCreditBalance(orgId),
  });
}

export function billingTransactionsQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: billingQueryKeys.transactions(orgId),
    queryFn: (): Promise<TransactionsResponse> => api.orgs.getTransactions(orgId),
  });
}

export function billingAccountQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: billingQueryKeys.account(orgId),
    queryFn: (): Promise<BillingAccount> => api.orgs.getAccount(orgId),
  });
}

export function useBillingBalance(orgId: string | null | undefined) {
  return useQuery({
    ...billingBalanceQueryOptions(orgId ?? ""),
    enabled: Boolean(orgId),
  });
}

export function useBillingTransactions(orgId: string | null | undefined) {
  return useQuery({
    ...billingTransactionsQueryOptions(orgId ?? ""),
    enabled: Boolean(orgId),
  });
}

export function useBillingAccount(orgId: string | null | undefined) {
  return useQuery({
    ...billingAccountQueryOptions(orgId ?? ""),
    enabled: Boolean(orgId),
  });
}

export function usePurchaseCredits() {
  return useMutation({
    mutationFn: ({
      orgId,
      amountUsd,
    }: {
      orgId: string;
      amountUsd: number;
    }): Promise<CheckoutSessionResponse> =>
      api.orgs.createCreditCheckout(orgId, amountUsd),
    onSuccess: (_result, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.balance(orgId) });
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.transactions(orgId) });
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.account(orgId) });
    },
  });
}
