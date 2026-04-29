import { useState, useEffect, useCallback } from "react";
import { Input, Button } from "@cypher-asi/zui";
import type { OrgBilling, CreditBalance } from "../../shared/types";
import type { CheckoutPollingStatus } from "../../hooks/use-checkout-polling";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { NATIVE_BILLING_MESSAGE } from "../../lib/billing";
import { orgsApi } from "../../shared/api/orgs";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";
import billingStyles from "./OrgSettingsBilling.module.css";

interface Props {
  billing: OrgBilling | null;
  isAdminOrOwner: boolean;
  balance: CreditBalance | null;
  balanceLoading: boolean;
  balanceError: string | null;
  checkoutError: string | null;
  pollingStatus: CheckoutPollingStatus;
  onPurchase: (amountUsd: number) => void;
  onRetryBalance: () => void;
  onUpgrade?: () => void;
}

const PRESETS = [25, 50, 100, 250];
const MIN_USD = 1;
const MAX_USD = 1000;

export function OrgSettingsBilling({
  billing,
  isAdminOrOwner,
  balance,
  balanceLoading,
  balanceError,
  checkoutError,
  pollingStatus,
  onPurchase,
  onRetryBalance,
  onUpgrade,
}: Props) {
  const { isNativeApp } = useAuraCapabilities();
  const [customAmount, setCustomAmount] = useState("");
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [isPaidPlan, setIsPaidPlan] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const fetchSubscription = useCallback(() => {
    setPeriodLoading(true);
    orgsApi.getSubscriptionStatus()
      .then((s) => {
        if (s.current_period_end) setPeriodEnd(s.current_period_end);
        setIsPaidPlan(s.plan !== "mortal");
        setIsActive(s.is_subscribed);
      })
      .catch(() => {})
      .finally(() => setPeriodLoading(false));
  }, []);

  useEffect(() => { fetchSubscription(); }, [fetchSubscription]);

  // Auto-refresh when user returns to tab (e.g. after Stripe checkout/portal)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") fetchSubscription();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [fetchSubscription]);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);

  const customNum = parseFloat(customAmount);
  const customValid = !isNaN(customNum) && customNum >= MIN_USD && customNum <= MAX_USD;
  const customOutOfRange =
    customAmount !== "" && !isNaN(customNum) && customNum > 0 && !customValid;

  const effectiveAmount = selectedPreset ?? (customValid ? customNum : null);
  const isPolling = pollingStatus === "polling";

  const handlePresetClick = (amount: number) => {
    setSelectedPreset(amount);
    setCustomAmount("");
  };

  const handleCustomChange = (value: string) => {
    setCustomAmount(value);
    setSelectedPreset(null);
  };

  const handlePurchaseClick = () => {
    if (effectiveAmount !== null) onPurchase(effectiveAmount);
  };

  return (
    <>
      <h2 className={styles.sectionTitle}>Billing</h2>
      <p className={billingStyles.billingIntro}>
        Subscribe to a tier for monthly Z credit allowances and enhanced rewards, or purchase Z credits as you go.
      </p>

      {/* Credit Balance — shown first */}
      <div className={styles.settingsGroupLabel}>Z Credits</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Current Balance</span>
            <span className={styles.rowDescription}>
              Z credits available for AI usage
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={billingStyles.balanceValue}>
              {balanceLoading && balance === null
                ? "Loading..."
                : balanceError && balance === null
                  ? <span className={billingStyles.errorState}>
                      {balanceError}{" "}
                      <button className={billingStyles.retryLink} onClick={onRetryBalance}>Retry</button>
                    </span>
                  : balance !== null
                    ? `${balance.balance_cents.toLocaleString()} Z credits`
                    : "---"}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.settingsGroupLabel}>Plan</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Current Plan</span>
            <span className={styles.rowDescription}>
              {isPaidPlan && !isActive ? "Cancels at end of period" : "Your active subscription"}
            </span>
          </div>
          <div className={styles.rowControl} style={{ marginLeft: "auto" }}>
            <span className={styles.roleBadge}>{periodLoading ? "..." : balance?.plan ?? billing?.plan ?? "mortal"}</span>
            {onUpgrade && (
              <Button variant="ghost" size="sm" onClick={onUpgrade} style={{ padding: 0, display: "flex", justifyContent: "flex-end" }}>
                Change Plan
              </Button>
            )}
          </div>
        </div>
        {isPaidPlan && (
          <div className={styles.settingsRow}>
            <div className={styles.rowInfo}>
              <span className={styles.rowLabel}>{isActive ? "Next Billing Date" : "Plan Ends"}</span>
              <span className={styles.rowDescription}>
                {isActive ? "Next monthly Z credit top-up" : "Your plan will revert to Mortal"}
              </span>
            </div>
            <div className={styles.rowControl}>
              {periodLoading ? "Loading..." : periodEnd
                ? new Date(periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                : "---"}
            </div>
          </div>
        )}
      </div>

      {/* Purchase Credits */}
      {isAdminOrOwner && !isNativeApp && (
        <>
          <div className={styles.settingsGroupLabel}>Buy Z Credits</div>
          <div className={styles.settingsGroup}>
            <div className={billingStyles.presetRow}>
              {PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`${billingStyles.presetButton} ${selectedPreset === amount ? billingStyles.presetSelected : ""}`}
                  onClick={() => handlePresetClick(amount)}
                  disabled={isPolling}
                >
                  ${amount} <span style={{ fontSize: "0.75em", opacity: 0.6 }}>({(amount * 100).toLocaleString()})</span>
                </button>
              ))}
            </div>

            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Custom Amount</span>
                <span className={styles.rowDescription}>
                  Enter a USD amount (${MIN_USD}–${MAX_USD})
                </span>
              </div>
              <div className={styles.rowControl}>
                <Input
                  size="sm"
                  type="number"
                  min={MIN_USD}
                  max={MAX_USD}
                  step="1"
                  value={customAmount}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  placeholder="e.g. 15"
                  className={billingStyles.inputWidth140}
                  disabled={isPolling}
                />
              </div>
            </div>

            {customOutOfRange && (
              <div className={billingStyles.errorState}>
                Amount must be between ${MIN_USD} and ${MAX_USD}
              </div>
            )}

            <div className={billingStyles.purchaseAction}>
              <Button
                variant="primary"
                size="sm"
                onClick={handlePurchaseClick}
                disabled={effectiveAmount === null || isPolling}
              >
                {isPolling ? "Processing..." : effectiveAmount !== null ? `Purchase $${effectiveAmount}` : "Purchase"}
              </Button>
            </div>
          </div>
        </>
      )}

      {isAdminOrOwner && isNativeApp && (
        <>
          <div className={styles.settingsGroupLabel}>Credit Purchases</div>
          <div className={styles.settingsGroup}>
            <div className={billingStyles.infoState}>{NATIVE_BILLING_MESSAGE}</div>
          </div>
        </>
      )}

      {/* Checkout Error */}
      {!isNativeApp && checkoutError && (
        <div className={`${billingStyles.errorState} ${billingStyles.checkoutErrorMargin}`}>
          {checkoutError}
        </div>
      )}

      {/* Polling Status */}
      {!isNativeApp && pollingStatus !== "idle" && (
        <div className={billingStyles.pollingStatus}>
          {pollingStatus === "polling" && "Waiting for payment confirmation..."}
          {pollingStatus === "success" && "Payment confirmed! Z credits updated."}
          {pollingStatus === "timeout" && "Payment not yet confirmed. Z credits will appear once the payment is processed."}
        </div>
      )}
    </>
  );
}
