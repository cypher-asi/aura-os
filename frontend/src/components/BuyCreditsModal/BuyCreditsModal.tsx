import { useState, useEffect } from "react";
import { Modal, Button, Input } from "@cypher-asi/zui";
import { useBuyCreditsData } from "./useBuyCreditsData";
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
  const {
    balanceError, checkoutError,
    pollingStatus, isPolling, balanceDisplay,
    loadBalance, handlePurchase, balance,
  } = useBuyCreditsData(isOpen);

  const [selectedPreset, setSelectedPreset] = useState<number | null>(100);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSelectedPreset(100);
      setCustomAmount("");
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
          onClick={handlePurchaseClick}
          disabled={effectiveAmount === null || isPolling}
        >
          {isPolling ? "Processing..." : effectiveAmount !== null ? `Purchase $${effectiveAmount}` : "Select an amount"}
        </Button>

        {checkoutError && (
          <div className={styles.errorState}>{checkoutError}</div>
        )}

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
