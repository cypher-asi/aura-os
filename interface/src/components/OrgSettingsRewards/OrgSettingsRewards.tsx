import { useState, useEffect } from "react";
import { Button } from "@cypher-asi/zui";
import { Copy, Check, Gift } from "lucide-react";
import { authApi } from "../../api/auth";
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
        <div className={rewardStyles.inviteCodeSection}>
          <p className={rewardStyles.description}>
            Share your invite code with others. When someone signs up using your
            code, you both earn bonus credits.
          </p>
          <div className={rewardStyles.codeRow}>
            {loading ? (
              <span className={rewardStyles.codeLoading}>Loading...</span>
            ) : inviteCode ? (
              <>
                <code className={rewardStyles.codeValue}>{inviteCode}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copied ? <Check size={14} /> : <Copy size={14} />}
                  onClick={handleCopy}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </>
            ) : (
              <span className={rewardStyles.codeLoading}>
                Unable to load invite code
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Free Credits Info */}
      <div className={styles.settingsGroupLabel}>Free Credits</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Welcome Bonus</span>
            <span className={styles.rowDescription}>
              One-time grant on your first AURA login
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={rewardStyles.creditAmount}>5,000 credits</span>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Daily Credits</span>
            <span className={styles.rowDescription}>
              Earned on first use each day. Upgrade your tier for more.
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={rewardStyles.creditAmount}>
              {dailyCredits.toLocaleString()} credits/day
            </span>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Referral Bonus</span>
            <span className={styles.rowDescription}>
              Earned when someone signs up with your invite code. Higher tiers earn more.
            </span>
          </div>
          <div className={styles.rowControl}>
            <span className={rewardStyles.creditAmount}>
              {referralBonus.toLocaleString()} credits
            </span>
          </div>
        </div>
      </div>

      <div className={styles.settingsGroupLabel}>Earn More</div>
      <div className={styles.settingsGroup}>
        <div className={rewardStyles.proPromo}>
          <Gift size={16} />
          <span>
            Upgrade your tier to earn more daily credits, higher referral
            bonuses, and monthly credit allowances.
          </span>
        </div>
      </div>
    </>
  );
}
