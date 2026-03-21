import { useState, useEffect, useCallback } from "react";
import { useOrgStore } from "../../stores/org-store";
import { api, ApiClientError } from "../../api/client";
import { useCheckoutPolling } from "../../hooks/use-checkout-polling";
import { CREDITS_UPDATED_EVENT } from "../CreditsBadge/useCreditBalance";
import type { CreditTier, CreditBalance } from "../../types";

interface BuyCreditsData {
  tiers: CreditTier[];
  balance: CreditBalance | null;
  tiersLoading: boolean;
  tiersError: string | null;
  balanceLoading: boolean;
  balanceError: string | null;
  checkoutError: string | null;
  pollingStatus: string;
  isPolling: boolean;
  balanceDisplay: string;
  loadTiers: () => Promise<void>;
  loadBalance: () => Promise<void>;
  handleBuyTier: (tierId: string) => Promise<void>;
}

function formatCredits(n: number): string {
  return n.toLocaleString();
}

export function useBuyCreditsData(isOpen: boolean): BuyCreditsData {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const orgId = activeOrg?.org_id;

  const [tiers, setTiers] = useState<CreditTier[]>([]);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const { status: pollingStatus, settledBalance, startPolling, reset: resetPolling } =
    useCheckoutPolling(orgId);

  const isPolling = pollingStatus === "polling";

  const loadTiers = useCallback(async () => {
    if (!orgId) return;
    setTiersLoading(true); setTiersError(null);
    try { setTiers(await api.orgs.getCreditTiers(orgId)); }
    catch (err) {
      setTiersError(err instanceof ApiClientError ? `Billing server error (${err.status})` : "Unable to reach billing server");
    } finally { setTiersLoading(false); }
  }, [orgId]);

  const loadBalance = useCallback(async () => {
    if (!orgId) return;
    setBalanceLoading(true); setBalanceError(null);
    try { setBalance(await api.orgs.getCreditBalance(orgId)); }
    catch (err) {
      setBalanceError(err instanceof ApiClientError ? `Billing server error (${err.status})` : "Unable to reach billing server");
    } finally { setBalanceLoading(false); }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    loadTiers(); loadBalance();
  }, [isOpen, orgId, loadTiers, loadBalance]);

  useEffect(() => {
    if (pollingStatus === "success" && settledBalance) {
      setBalance(settledBalance);
      resetPolling();
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
  }, [pollingStatus, settledBalance, resetPolling]);

  const handleBuyTier = useCallback(async (tierId: string) => {
    if (!orgId) return;
    setCheckoutError(null);
    try {
      const prevBalance = balance?.total_credits ?? 0;
      const { checkout_url } = await api.orgs.createCreditCheckout(orgId, tierId);
      window.open(checkout_url, "_blank");
      startPolling(prevBalance);
    } catch (err) {
      setCheckoutError(err instanceof ApiClientError ? `Checkout failed (${err.status})` : "Unable to start checkout");
    }
  }, [orgId, balance, startPolling]);

  const balanceDisplay = balanceLoading && balance === null
    ? "..."
    : balanceError && balance === null ? "---"
    : balance !== null ? formatCredits(balance.total_credits)
    : "---";

  return {
    tiers, balance, tiersLoading, tiersError, balanceLoading, balanceError,
    checkoutError, pollingStatus, isPolling, balanceDisplay,
    loadTiers, loadBalance, handleBuyTier,
  };
}
