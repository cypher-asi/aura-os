import { useState, useEffect } from "react";
import { orgsApi } from "../../shared/api/orgs";
import { useOrgStore } from "../../stores/org-store";
import type { CreditTransaction, BillingAccount } from "../../shared/types";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";
import historyStyles from "./OrgSettingsCreditHistory.module.css";

interface SubscriptionInfo {
  plan: string;
  is_subscribed: boolean;
  monthly_credits: number;
}

const TYPE_LABELS: Record<string, string> = {
  signupgrant: "Welcome Bonus",
  dailygrant: "Daily Reward",
  monthlyallowance: "Monthly Allowance",
  referralbonus: "Referral Bonus",
  purchase: "Credit Purchase",
  usage: "Usage",
  refund: "Refund",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrgSettingsCreditHistory() {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const orgId = useOrgStore((s) => s.activeOrg?.org_id);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);

    Promise.all([
      orgsApi.getTransactions(orgId).catch(() => ({ transactions: [], has_more: false })),
      orgsApi.getAccount(orgId).catch(() => null),
      orgsApi.getSubscriptionStatus().catch(() => null),
    ]).then(([txRes, acc, sub]) => {
      setTransactions(txRes.transactions);
      setAccount(acc);
      setSubscription(sub);
      setLoading(false);
    });
  }, [orgId]);

  const planStatus = subscription?.is_subscribed
    ? "Active"
    : subscription && subscription.plan !== "mortal"
      ? "Cancelling"
      : "Free";

  return (
    <>
      <h2 className={styles.sectionTitle}>Z Credit History</h2>
      <p className={historyStyles.intro}>
        Your Z credit balance, plan details, and full transaction history.
      </p>

      {loading ? (
        <div className={historyStyles.loading}>Loading...</div>
      ) : (
        <>
          {/* Account Summary */}
          <div className={styles.settingsGroupLabel}>Account Summary</div>
          <div className={styles.settingsGroup}>
            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Current Balance</span>
              </div>
              <div className={styles.rowControl}>
                <span className={historyStyles.highlightValue}>
                  {account ? `${account.balance_cents.toLocaleString()} Z` : "---"}
                </span>
              </div>
            </div>
            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Plan</span>
              </div>
              <div className={styles.rowControl}>
                <span className={styles.roleBadge}>{subscription?.plan ?? "mortal"}</span>
                <span className={historyStyles.statusBadge}>{planStatus}</span>
              </div>
            </div>
            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Monthly Allowance</span>
              </div>
              <div className={styles.rowControl}>
                {subscription ? `${subscription.monthly_credits.toLocaleString()} Z` : "---"}
              </div>
            </div>
            {account && (
              <div className={styles.settingsRow}>
                <div className={styles.rowInfo}>
                  <span className={styles.rowLabel}>Member Since</span>
                </div>
                <div className={styles.rowControl}>
                  {new Date(account.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </div>
              </div>
            )}
          </div>

          {/* Transactions */}
          <div className={styles.settingsGroupLabel}>Transactions</div>
          <div className={styles.settingsGroup}>
            {transactions.length === 0 ? (
              <div className={historyStyles.empty}>
                No transactions yet. Z credits will appear here as you use AURA.
              </div>
            ) : (
              <div className={historyStyles.transactionList}>
                {transactions.map((tx) => (
                  <div key={tx.id} className={historyStyles.txRow}>
                    <div className={historyStyles.txInfo}>
                      <span className={historyStyles.txType}>
                        {TYPE_LABELS[tx.transaction_type] ?? tx.transaction_type}
                      </span>
                      <span className={historyStyles.txDate}>{formatDate(tx.created_at)}</span>
                    </div>
                    <div className={historyStyles.txAmounts}>
                      <span className={`${historyStyles.txAmount} ${tx.amount_cents >= 0 ? historyStyles.txPositive : historyStyles.txNegative}`}>
                        {tx.amount_cents >= 0 ? "+" : ""}{tx.amount_cents.toLocaleString()} Z
                      </span>
                      <span className={historyStyles.txBalance}>
                        bal: {tx.balance_after_cents.toLocaleString()} Z
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
