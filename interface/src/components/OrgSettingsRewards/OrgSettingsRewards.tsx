import { useState, useEffect } from "react";
import { Gift } from "lucide-react";
import { authApi } from "../../shared/api/auth";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";
import rewardStyles from "./OrgSettingsRewards.module.css";

export function OrgSettingsRewards() {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authApi
      .getMyInviteCode()
      .then((data) => {
        if (!cancelled) setInviteCode(data.slug);
      })
      .catch(() => {
        if (!cancelled) setInviteCode(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Mortal tier defaults — will update dynamically when tier system is wired up
  const dailyCredits = 50;
  const referralBonus = 5000;

  return (
    <>
      <h2 className={styles.sectionTitle}>Rewards</h2>

      {/* Invite Code */}
      <div className={styles.settingsGroupLabel}>Your Invite Code</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Invite Code</span>
            <span className={styles.rowDescription}>
              Share with others. When they subscribe, you both earn bonus Z credits.
            </span>
          </div>
          <div className={styles.rowControl}>
            {loading ? (
              <span className={rewardStyles.codeLoading}>Loading...</span>
            ) : inviteCode ? (
              <code className={rewardStyles.codeClickable} onClick={handleCopy}>
                {copied ? "Copied!" : inviteCode}
              </code>
            ) : (
              <span className={rewardStyles.codeLoading}>Unavailable</span>
            )}
          </div>
        </div>
      </div>

      {/* Free Credits Info */}
      <div className={styles.settingsGroupLabel}>Free Z Credits</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Welcome Bonus</span>
            <span className={styles.rowDescription}>
              One-time grant on your first AURA login
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={rewardStyles.creditAmount}>5,000 Z credits</span>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Daily Active Reward</span>
            <span className={styles.rowDescription}>
              Earned each day you use AURA. Upgrade your tier for more.
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={rewardStyles.creditAmount}>
              {dailyCredits.toLocaleString()} Z credits/day
            </span>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Referral Bonus</span>
            <span className={styles.rowDescription}>
              Earned when someone you invited subscribes to a paid plan.
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={rewardStyles.creditAmount}>
              {referralBonus.toLocaleString()} Z credits
            </span>
          </div>
        </div>
      </div>

      <div className={styles.settingsGroupLabel}>Earn More</div>
      <div className={styles.settingsGroup}>
        <div className={rewardStyles.proPromo}>
          <Gift size={16} />
          <span>
            Upgrade your tier to earn more daily Z credits and monthly
            credit allowances.
          </span>
        </div>
      </div>
    </>
  );
}
