import { useState, useEffect, useRef } from "react";
import { Modal, Button, Input } from "@cypher-asi/zui";
import { useBuyCreditsData } from "./useBuyCreditsData";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { NATIVE_BILLING_MESSAGE } from "../../lib/billing";
import { formatCredits } from "../../utils/format";
import styles from "./BuyCreditsModal.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenBilling?: () => void;
}

const PRESETS = [25, 50, 100, 250];
const MIN_USD = 1;
const MAX_USD = 1000;

export function BuyCreditsModal({ isOpen, onClose, onOpenBilling }: Props) {
  const { isNativeApp } = useAuraCapabilities();
  const {
    balanceError, checkoutError,
    pollingStatus, isPolling, balanceDisplay,
    loadBalance, handlePurchase, balance,
  } = useBuyCreditsData(isOpen);

  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(100);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSelectedPreset(100);
      setCustomAmount("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const customNum = parseFloat(customAmount);
  const customValid = !isNaN(customNum) && customNum >= MIN_USD && customNum <= MAX_USD;
  const effectiveAmount = selectedPreset ?? (customValid ? customNum : null);

  const handlePresetClick = (amount: number) => {
    setSelectedPreset(amount);
    setCustomAmount("");
  };

  const handleCustomChange = (value: string) => {
    setCustomAmount(value);
    setSelectedPreset(null);
  };

  const handlePurchaseClick = () => {
    if (effectiveAmount !== null) handlePurchase(effectiveAmount);
  };

  const handleOpenBilling = () => {
    onClose();
    onOpenBilling?.();
  };

  const footerZCredits = balance !== null
    ? formatCredits(balance.balance_cents)
    : balanceDisplay === "..." ? "..." : "---";

  const footerCashCredits = balance !== null ? balance.balance_formatted : balanceDisplay;

  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerCredits}>
        <span>{footerZCredits}</span>
        <span className={styles.footerSeparator}>•</span>
        <span>{footerCashCredits}</span>
      </div>
      {onOpenBilling && !isNativeApp && (
        <button className={styles.billingLink} onClick={handleOpenBilling} type="button">
          Billing Settings
        </button>
      )}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="BUY CREDITS" size="md" footer={footer}>
      <div className={styles.content}>
        <div className={styles.balanceRow}>
          <div className={styles.balanceValue}>{balanceDisplay}</div>
          <span className={styles.balanceLabel}>current balance</span>
        </div>

        {balanceError && balance === null && (
          <div className={styles.errorState}>
            {balanceError}
            <button className={styles.retryButton} onClick={loadBalance} type="button">
              Retry
            </button>
          </div>
        )}

        {isNativeApp ? (
          // Native mobile keeps the balance visible but removes all purchase
          // calls to action to stay aligned with the companion-app policy.
          <div className={styles.infoState}>{NATIVE_BILLING_MESSAGE}</div>
        ) : (
          <>
            <div className={styles.presetGrid}>
              {PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`${styles.presetCard} ${selectedPreset === amount ? styles.presetSelected : ""}`}
                  onClick={() => handlePresetClick(amount)}
                  disabled={isPolling}
                >
                  <div className={styles.presetPrice}>${amount}</div>
                </button>
              ))}
            </div>

            <div className={styles.customRow}>
              <Input
                ref={inputRef}
                size="sm"
                type="number"
                min={MIN_USD}
                max={MAX_USD}
                step="1"
                value={customAmount}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="Custom amount ($)"
                disabled={isPolling}
              />
            </div>

            <Button
              variant="primary"
              className={styles.purchaseButton}
              onClick={handlePurchaseClick}
              disabled={effectiveAmount === null || isPolling}
            >
              {isPolling ? "Processing..." : effectiveAmount !== null ? `Purchase $${effectiveAmount}` : "Select an amount"}
            </Button>
          </>
        )}

        {checkoutError && (
          <div className={styles.errorState}>{checkoutError}</div>
        )}

        {!isNativeApp && pollingStatus !== "idle" && (
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
