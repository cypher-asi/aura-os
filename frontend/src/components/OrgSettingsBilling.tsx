import { useState } from "react";
import { Input, Button } from "@cypher-asi/zui";
import { EmptyState } from "./EmptyState";
import type { OrgBilling, CreditTier, CreditBalance } from "../types";
import type { CheckoutPollingStatus } from "../hooks/use-checkout-polling";
import styles from "./OrgSettingsPanel.module.css";
import billingStyles from "./OrgSettingsBilling.module.css";

interface Props {
  billing: OrgBilling | null;
  billingEmail: string;
  onBillingEmailChange: (email: string) => void;
  isAdminOrOwner: boolean;
  saving: boolean;
  onSave: () => void;
  tiers: CreditTier[];
  balance: CreditBalance | null;
  tiersLoading: boolean;
  tiersError: string | null;
  balanceLoading: boolean;
  balanceError: string | null;
  checkoutError: string | null;
  pollingStatus: CheckoutPollingStatus;
  onBuyTier: (tierId: string) => void;
  onBuyCustom: (credits: number) => void;
  onRetryTiers: () => void;
  onRetryBalance: () => void;
}

function formatCreditsLong(n: number): string {
  return n.toLocaleString();
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function bestRate(tiers: CreditTier[]): number {
  if (tiers.length === 0) return 0;
  return Math.min(...tiers.map((t) => t.price_usd_cents / t.credits));
}

export function OrgSettingsBilling({
  billing,
  billingEmail,
  onBillingEmailChange,
  isAdminOrOwner,
  saving,
  onSave,
  tiers,
  balance,
  tiersLoading,
  tiersError,
  balanceLoading,
  balanceError,
  checkoutError,
  pollingStatus,
  onBuyTier,
  onBuyCustom,
  onRetryTiers,
  onRetryBalance,
}: Props) {
  const [customCredits, setCustomCredits] = useState("");
  const rate = bestRate(tiers);

  const MIN_CUSTOM_CREDITS = 10_000;
  const MAX_CUSTOM_CREDITS = 100_000_000;

  const customNum = parseInt(customCredits, 10);
  const customInRange =
    !isNaN(customNum) &&
    customNum >= MIN_CUSTOM_CREDITS &&
    customNum <= MAX_CUSTOM_CREDITS;
  const customValid = customInRange;
  const customPrice = customValid ? Math.ceil(customNum * rate) : 0;
  const customOutOfRange =
    customCredits !== "" && !isNaN(customNum) && customNum > 0 && !customInRange;

  const isPolling = pollingStatus === "polling";

  return (
    <>
      <h2 className={styles.sectionTitle}>Billing</h2>

      <div className={styles.settingsGroupLabel}>Plan</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Current Plan</span>
            <span className={styles.rowDescription}>
              Your team's active subscription
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={styles.roleBadge}>{billing?.plan ?? "free"}</span>
          </div>
        </div>
        {isAdminOrOwner && (
          <div className={styles.settingsRow}>
            <div className={styles.rowInfo}>
              <span className={styles.rowLabel}>Billing Email</span>
              <span className={styles.rowDescription}>
                Invoices and receipts will be sent here
              </span>
            </div>
            <div className={styles.rowControl}>
              <Input
                size="sm"
                value={billingEmail}
                onChange={(e) => onBillingEmailChange(e.target.value)}
                placeholder="billing@example.com"
                style={{ width: 200 }}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
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
                    ? formatCreditsLong(balance.total_credits)
                    : "---"}
            </span>
          </div>
        </div>
      </div>

      {/* Credit Tiers */}
      <div className={styles.settingsGroupLabel}>Buy Credits</div>
      {tiersLoading && tiers.length === 0 ? (
        <div className={billingStyles.loadingState}>Loading credit tiers...</div>
      ) : tiersError && tiers.length === 0 ? (
        <div className={billingStyles.errorState}>
          {tiersError}
          <button className={billingStyles.retryButton} onClick={onRetryTiers}>Retry</button>
        </div>
      ) : tiers.length === 0 ? (
        <EmptyState>No credit tiers available</EmptyState>
      ) : (
        <div className={billingStyles.tierGrid}>
          {tiers.map((tier) => (
            <div key={tier.id} className={billingStyles.tierCard}>
              <div className={billingStyles.tierCredits}>
                {formatCreditsLong(tier.credits)}
              </div>
              <div className={billingStyles.tierLabel}>{tier.label}</div>
              <div className={billingStyles.tierPrice}>
                {formatUsd(tier.price_usd_cents)}
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onBuyTier(tier.id)}
                disabled={isPolling}
                style={{ width: "100%", marginTop: "var(--space-2)" }}
              >
                {isPolling ? "Processing..." : "Buy"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Checkout Error */}
      {checkoutError && (
        <div className={billingStyles.errorState} style={{ marginBottom: "var(--space-4)" }}>
          {checkoutError}
        </div>
      )}

      {/* Custom Credits */}
      {tiers.length > 0 && isAdminOrOwner && (
        <>
          <div className={styles.settingsGroupLabel}>Custom Amount</div>
          <div className={styles.settingsGroup}>
            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Credits</span>
                <span className={styles.rowDescription}>
                  Enter a custom amount of credits to purchase
                </span>
              </div>
              <div className={styles.rowControl}>
                <Input
                  size="sm"
                  type="number"
                  min={MIN_CUSTOM_CREDITS}
                  max={MAX_CUSTOM_CREDITS}
                  value={customCredits}
                  onChange={(e) => setCustomCredits(e.target.value)}
                  placeholder="e.g. 100000"
                  style={{ width: 140 }}
                />
                {customValid && (
                  <span className={billingStyles.customPrice}>
                    {formatUsd(customPrice)}
                  </span>
                )}
                {customOutOfRange && (
                  <span className={billingStyles.errorState}>
                    Must be between {formatCreditsLong(MIN_CUSTOM_CREDITS)} and{" "}
                    {formatCreditsLong(MAX_CUSTOM_CREDITS)} credits
                  </span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => customValid && onBuyCustom(customNum)}
                  disabled={!customValid || isPolling}
                >
                  {isPolling ? "Processing..." : "Buy Custom"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Polling Status */}
      {pollingStatus !== "idle" && (
        <div className={billingStyles.pollingStatus}>
          {pollingStatus === "polling" && "Waiting for payment confirmation..."}
          {pollingStatus === "success" && "Payment confirmed! Credits updated."}
          {pollingStatus === "timeout" && "Payment not yet confirmed. Credits will appear once the payment is processed."}
        </div>
      )}

      {/* Purchase History */}
      {balance && balance.purchases.length > 0 && (
        <>
          <div className={styles.settingsGroupLabel}>Purchase History</div>
          <div className={styles.settingsGroup}>
            {balance.purchases.map((p) => (
              <div key={p.id} className={styles.settingsRow}>
                <div className={styles.rowInfo}>
                  <span className={styles.rowLabel}>
                    {formatCreditsLong(p.credits)} credits
                  </span>
                  <span className={styles.rowDescription}>
                    {new Date(p.created_at).toLocaleDateString()} &middot; {formatUsd(p.amount_cents)}
                  </span>
                </div>
                <div className={styles.rowControl}>
                  <span className={billingStyles.statusBadge} data-status={p.status}>
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
