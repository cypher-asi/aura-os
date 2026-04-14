import { useState, useEffect, useCallback, useRef } from "react";
import { useOrgStore } from "../../stores/org-store";
import { useBillingStore } from "../../stores/billing-store";
import { useCheckoutPolling } from "../../hooks/use-checkout-polling";
import { CREDITS_UPDATED_EVENT } from "../CreditsBadge/useCreditBalance";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { NATIVE_BILLING_MESSAGE } from "../../lib/billing";
import type { CreditBalance } from "../../types";

interface BuyCreditsData {
  balance: CreditBalance | null;
  balanceLoading: boolean;
  balanceError: string | null;
  purchaseLoading: boolean;
  checkoutError: string | null;
  pollingStatus: string;
  isPolling: boolean;
  balanceDisplay: string;
  loadBalance: () => Promise<void>;
  handlePurchase: (amountUsd: number) => Promise<void>;
}

export function useBuyCreditsData(isOpen: boolean): BuyCreditsData {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const orgId = activeOrg?.org_id;
  const { isNativeApp } = useAuraCapabilities();

  const balance = useBillingStore((s) => s.balance);
  const balanceLoading = useBillingStore((s) => s.balanceLoading);
  const purchaseLoading = useBillingStore((s) => s.purchaseLoading);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const { status: pollingStatus, settledBalance, startPolling, reset: resetPolling } =
    useCheckoutPolling(orgId);

  const isPolling = pollingStatus === "polling";

  const loadBalance = useCallback(async () => {
    if (!orgId) return;
    setBalanceError(null);
    try { await useBillingStore.getState().fetchBalance(orgId); }
    catch { setBalanceError("Unable to reach billing server"); }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    const frame = window.requestAnimationFrame(() => {
      void loadBalance();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, orgId, loadBalance]);

  useEffect(() => {
    if (pollingStatus === "success" && settledBalance) {
      useBillingStore.setState({ balance: settledBalance });
      resetPolling();
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
    if (pollingStatus === "timeout") {
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
  }, [pollingStatus, settledBalance, resetPolling]);

  // Refetch balance via HTTP whenever the modal closes so the taskbar
  // picks up any credits purchased even if the WS event was missed.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      resetPolling();
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, resetPolling]);

  const handlePurchase = useCallback(async (amountUsd: number) => {
    if (!orgId) return;
    // Guard the action at the data layer too so a future UI change cannot
    // accidentally re-enable external checkout inside the native app.
    if (isNativeApp) {
      setCheckoutError(NATIVE_BILLING_MESSAGE);
      return;
    }
    setCheckoutError(null);
    const result = await useBillingStore.getState().purchase(orgId, amountUsd);
    if (result?.checkout_url) {
      window.open(result.checkout_url, "_blank");
      const prevBalance = useBillingStore.getState().balance?.balance_cents ?? 0;
      startPolling(prevBalance);
    } else {
      setCheckoutError("Unable to start checkout");
    }
  }, [isNativeApp, orgId, startPolling]);

  const balanceDisplay = balanceLoading && balance === null
    ? "..."
    : balanceError && balance === null ? "---"
    : balance !== null ? balance.balance_formatted
    : "---";

  return {
    balance, balanceLoading, balanceError, purchaseLoading,
    checkoutError, pollingStatus, isPolling, balanceDisplay,
    loadBalance, handlePurchase,
  };
}
