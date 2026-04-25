import { useState } from "react";
import { Input, Button } from "@cypher-asi/zui";
import type { OrgBilling, CreditBalance } from "../../shared/types";
import type { CheckoutPollingStatus } from "../../hooks/use-checkout-polling";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { NATIVE_BILLING_MESSAGE } from "../../lib/billing";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";
import billingStyles from "./OrgSettingsBilling.module.css";

interface Props {
  billing: OrgBilling | null;
  billingEmail: string;
  isAdminOrOwner: boolean;
  balance: CreditBalance | null;
  balanceLoading: boolean;
  balanceError: string | null;
  checkoutError: string | null;
  pollingStatus: CheckoutPollingStatus;
  onPurchase: (amountUsd: number) => void;
  onRetryBalance: () => void;
}

const PRESETS = [25, 50, 100, 250];
const MIN_USD = 1;
const MAX_USD = 1000;

export function OrgSettingsBilling({
  billing,
  billingEmail,
  isAdminOrOwner,
  balance,
  balanceLoading,
  balanceError,
  checkoutError,
  pollingStatus,
  onPurchase,
  onRetryBalance,
}: Props) {
  const { isNativeApp } = useAuraCapabilities();
  const [customAmount, setCustomAmount] = useState("");
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

      <div className={styles.settingsGroupLabel}>Plan</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Current Plan</span>
            <span className={styles.rowDescription}>
              Your active subscription
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={styles.roleBadge}>{billing?.plan ?? "mortal"}</span>
          </div>
        </div>
        {isAdminOrOwner && (
          <div className={billingStyles.billingEmailSection}>
            <div className={styles.rowInfo}>
              <span className={styles.rowLabel}>Billing Email</span>
              <span className={styles.rowDescription}>
                Tied to your ZERO account. Invoices and receipts are sent here.
              </span>
            </div>
            <div className={billingStyles.billingEmailRow}>
              <span className={billingStyles.billingEmailValue}>
                {billingEmail || "—"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Credit Balance */}
      <div className={styles.settingsGroupLabel}>Credits</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Current Balance</span>
            <span className={styles.rowDescription}>
              Credits available for AI usage
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
                    ? balance.balance_formatted
                    : "---"}
            </span>
          </div>
        </div>
      </div>

      {/* Purchase Credits */}
      {isAdminOrOwner && !isNativeApp && (
        <>
          <div className={styles.settingsGroupLabel}>Buy Credits</div>
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
                  ${amount}
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
          {pollingStatus === "success" && "Payment confirmed! Credits updated."}
          {pollingStatus === "timeout" && "Payment not yet confirmed. Credits will appear once the payment is processed."}
        </div>
      )}
    </>
  );
}
