import { Modal, Button } from "@cypher-asi/zui";
import { useBuyCreditsData } from "./useBuyCreditsData";
import styles from "./BuyCreditsModal.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenBilling?: () => void;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCredits(n: number): string {
  return n.toLocaleString();
}

export function BuyCreditsModal({ isOpen, onClose, onOpenBilling }: Props) {
  const {
    tiers, tiersLoading, tiersError, balanceError, checkoutError,
    pollingStatus, isPolling, balanceDisplay,
    loadTiers, loadBalance, handleBuyTier, balance,
  } = useBuyCreditsData(isOpen);

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
