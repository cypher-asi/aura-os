import { CreditsBadge } from "../CreditsBadge";
import { useUIModalStore } from "../../stores/ui-modal-store";
import styles from "./BottomTaskbar.module.css";

export function BottomTaskbar() {
  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);

  return (
    <div className={styles.bar}>
      <div className={styles.creditsWrap}>
        <CreditsBadge onClick={openBuyCredits} />
      </div>
    </div>
  );
}
