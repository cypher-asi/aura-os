import { OrgSelector } from "./OrgSelector";
import { CreditsBadge } from "./CreditsBadge";
import styles from "./BottomTaskbar.module.css";

interface Props {
  onOpenOrgSettings: () => void;
  onBuyCredits?: () => void;
}

export function BottomTaskbar({ onOpenOrgSettings, onBuyCredits }: Props) {
  return (
    <div className={styles.bar}>
      <div className={styles.orgWrap}>
        <OrgSelector onOpenSettings={onOpenOrgSettings} />
      </div>
      <div className={styles.divider} />
      <div className={styles.creditsWrap}>
        <CreditsBadge onClick={onBuyCredits} />
      </div>
    </div>
  );
}
