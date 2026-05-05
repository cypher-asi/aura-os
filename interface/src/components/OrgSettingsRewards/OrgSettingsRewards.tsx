import { useEffect, useState } from "react";
import { Button } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import { useInviteCodeStore } from "../../stores/invite-code-store";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";
import rewardStyles from "./OrgSettingsRewards.module.css";

interface Props {
  onUpgrade?: () => void;
}

export function OrgSettingsRewards({ onUpgrade }: Props) {
  const { user } = useAuth();
  const userId = user?.user_id ?? null;
  const inviteCode = useInviteCodeStore((s) => s.code);
  const inviteLoading = useInviteCodeStore((s) => s.loading);
  const inviteError = useInviteCodeStore((s) => s.error);
  const ensureInviteCode = useInviteCodeStore((s) => s.ensure);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void ensureInviteCode(userId);
  }, [userId, ensureInviteCode]);

  const handleCopy = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    void import("../../lib/analytics").then(({ track }) => track("invite_code_copied"));
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
              Share with others. When they subscribe, you both earn bonus Z credits for compute.
            </span>
          </div>
          <div className={styles.rowControl}>
            {inviteCode ? (
              <code className={rewardStyles.codeClickable} onClick={handleCopy}>
                {copied ? "Copied!" : inviteCode}
              </code>
            ) : inviteLoading ? (
              <span className={rewardStyles.codeLoading}>Loading...</span>
            ) : inviteError ? (
              <span className={rewardStyles.codeLoading}>Unavailable</span>
            ) : (
              <span className={rewardStyles.codeLoading}>Loading...</span>
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
              Earned each day you use AURA. Upgrade for more.
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
              Earned when someone you invited subscribes.
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
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Upgrade your plan</span>
            <span className={styles.rowDescription}>
              Upgrade to earn more monthly Z credits and increase your daily bonus.
            </span>
          </div>
          <div className={styles.rowControl}>
            {onUpgrade && (
              <Button variant="primary" size="sm" onClick={onUpgrade}>
                Upgrade
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
