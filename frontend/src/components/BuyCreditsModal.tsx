import { useState, useEffect, useCallback } from "react";
import { Modal, Button } from "@cypher-asi/zui";
import { useOrg } from "../context/OrgContext";
import { api, ApiClientError } from "../api/client";
import { useCheckoutPolling } from "../hooks/use-checkout-polling";
import { CREDITS_UPDATED_EVENT } from "./CreditsBadge";
import type { CreditTier, CreditBalance } from "../types";
import styles from "./BuyCreditsModal.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenBilling?: () => void;
}

function formatCredits(n: number): string {
  return n.toLocaleString();
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BuyCreditsModal({ isOpen, onClose, onOpenBilling }: Props) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.org_id;

  const [tiers, setTiers] = useState<CreditTier[]>([]);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const {
    status: pollingStatus,
    settledBalance,
    startPolling,
    reset: resetPolling,
  } = useCheckoutPolling(orgId);

  const isPolling = pollingStatus === "polling";

  const loadTiers = useCallback(async () => {
    if (!orgId) return;
    setTiersLoading(true);
    setTiersError(null);
    try {
      setTiers(await api.orgs.getCreditTiers(orgId));
    } catch (err) {
      setTiersError(
        err instanceof ApiClientError
          ? `Billing server error (${err.status})`
          : "Unable to reach billing server",
      );
    } finally {
      setTiersLoading(false);
    }
  }, [orgId]);

  const loadBalance = useCallback(async () => {
    if (!orgId) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      setBalance(await api.orgs.getCreditBalance(orgId));
    } catch (err) {
      setBalanceError(
        err instanceof ApiClientError
          ? `Billing server error (${err.status})`
          : "Unable to reach billing server",
      );
    } finally {
      setBalanceLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    loadTiers();
    loadBalance();
  }, [isOpen, orgId, loadTiers, loadBalance]);

  useEffect(() => {
    if (pollingStatus === "success" && settledBalance) {
      setBalance(settledBalance);
      resetPolling();
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
  }, [pollingStatus, settledBalance, resetPolling]);

  const handleBuyTier = async (tierId: string) => {
    if (!orgId) return;
    setCheckoutError(null);
    try {
      const prevBalance = balance?.total_credits ?? 0;
      const { checkout_url } = await api.orgs.createCreditCheckout(orgId, tierId);
      window.open(checkout_url, "_blank");
      startPolling(prevBalance);
    } catch (err) {
      setCheckoutError(
        err instanceof ApiClientError
          ? `Checkout failed (${err.status})`
          : "Unable to start checkout",
      );
    }
  };

  const handleOpenBilling = () => {
    onClose();
    onOpenBilling?.();
  };

  const balanceDisplay = balanceLoading && balance === null
    ? "..."
    : balanceError && balance === null
      ? "---"
      : balance !== null
        ? formatCredits(balance.total_credits)
        : "---";

  const footer = (
    <div className={styles.footer}>
      <div>
        {onOpenBilling && (
          <button className={styles.billingLink} onClick={handleOpenBilling} type="button">
            Billing Settings
          </button>
        )}
      </div>
      <div className={styles.footerEnd}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Buy More Credits" size="md" footer={footer}>
      <div className={styles.content}>
        {/* Current balance */}
        <div className={styles.balanceRow}>
          <div className={styles.balanceValue}>{balanceDisplay}</div>
          <span className={styles.balanceLabel}>credits remaining</span>
        </div>

        {balanceError && balance === null && (
          <div className={styles.errorState}>
            {balanceError}
            <button className={styles.retryButton} onClick={loadBalance} type="button">
              Retry
            </button>
          </div>
        )}

        {/* Tier grid */}
        {tiersLoading && tiers.length === 0 ? (
          <div className={styles.loadingState}>Loading credit tiers...</div>
        ) : tiersError && tiers.length === 0 ? (
          <div className={styles.errorState}>
            {tiersError}
            <button className={styles.retryButton} onClick={loadTiers} type="button">
              Retry
            </button>
          </div>
        ) : tiers.length > 0 ? (
          <div className={styles.tierGrid}>
            {tiers.map((tier) => (
              <button
                key={tier.id}
                className={styles.tierCard}
                onClick={() => handleBuyTier(tier.id)}
                disabled={isPolling}
                type="button"
              >
                <div className={styles.tierPrice}>{formatUsd(tier.price_usd_cents)}</div>
                <div className={styles.tierCredits}>{formatCredits(tier.credits)}</div>
                <div className={styles.tierLabel}>{tier.label}</div>
              </button>
            ))}
          </div>
        ) : null}

        {/* Checkout error */}
        {checkoutError && (
          <div className={styles.errorState}>{checkoutError}</div>
        )}

        {/* Polling status */}
        {pollingStatus !== "idle" && (
          <div className={styles.pollingStatus}>
            {pollingStatus === "polling" && "Waiting for payment confirmation..."}
            {pollingStatus === "success" && "Payment confirmed! Credits updated."}
            {pollingStatus === "timeout" &&
              "Payment not yet confirmed. Credits will appear once the payment is processed."}
          </div>
        )}
      </div>
    </Modal>
  );
}
