import { LogOut, Pencil } from "lucide-react";
import { FollowEditButton } from "../../../components/FollowEditButton";
import type { ProfileSummaryModel } from "./profileShared";
import styles from "./ProfileActionGroup.module.css";

interface ProfileActionGroupProps {
  summary: ProfileSummaryModel;
  variant: "floating" | "stacked";
}

export function ProfileActionGroup({ summary, variant }: ProfileActionGroupProps) {
  if (!summary.isOwnProfile) {
    if (variant === "floating" || !summary.followTargetId) return null;

    return (
      <div className={styles.stackedWrap}>
        <FollowEditButton
          isOwner={false}
          targetProfileId={summary.followTargetId}
          size="touch"
          className={styles.touchFollowButton}
        />
      </div>
    );
  }

  if (variant === "floating") {
    return (
      <div className={styles.floatingWrap}>
        <button
          type="button"
          className={styles.floatingButton}
          onClick={summary.openEditor}
          aria-label="Edit profile"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className={styles.floatingButton}
          onClick={summary.logout}
          aria-label="Log out"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.stackedWrap}>
      <div className={styles.stackedRow}>
        <button
          type="button"
          className={`${styles.stackedButton} ${styles.primaryButton}`}
          onClick={summary.openEditor}
        >
          <Pencil size={16} />
          Edit profile
        </button>
        <button
          type="button"
          className={`${styles.stackedButton} ${styles.secondaryButton}`}
          onClick={summary.logout}
        >
          <LogOut size={16} />
          Log out
        </button>
      </div>
    </div>
  );
}
